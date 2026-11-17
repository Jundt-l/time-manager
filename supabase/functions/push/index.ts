// Рассылка напоминаний «Вы сделали…?».
// GET  — отдаёт открытый ключ для подписки на уведомления (ключи создаются при первом запросе).
// POST — вызывается базой раз в минуту с секретом, отправляет напоминания, время которых пришло.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const SITE = 'https://jundt-l.github.io/time-manager/';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function secret(name: string): Promise<string | null> {
  const { data } = await db.from('app_secrets').select('value').eq('name', name).maybeSingle();
  return data?.value ?? null;
}

async function vapid() {
  let pub = await secret('vapid_public'), priv = await secret('vapid_private');
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    // если два запроса пришли одновременно, остаются ключи первого
    await db.from('app_secrets').upsert(
      [{ name: 'vapid_public', value: k.publicKey }, { name: 'vapid_private', value: k.privateKey }],
      { onConflict: 'name', ignoreDuplicates: true },
    );
    pub = await secret('vapid_public'); priv = await secret('vapid_private');
  }
  return { pub: pub!, priv: priv! };
}

type Reminder = { user_id: string; key: string; day: string; due_at: string; title: string; body: string };

async function send() {
  const { pub, priv } = await vapid();
  webpush.setVapidDetails(SITE, pub, priv);
  const { data, error } = await db.rpc('claim_due_reminders');
  if (error) throw error;
  // напоминания, опоздавшие больше чем на 3 часа (например, сервер спал), уже не нужны
  const due = ((data ?? []) as Reminder[]).filter(r => Date.now() - Date.parse(r.due_at) < 3 * 3600e3);
  if (!due.length) return { sent: 0 };

  const users = [...new Set(due.map(r => r.user_id))];
  const [{ data: subs }, { data: states }, { data: profiles }] = await Promise.all([
    db.from('push_subscriptions').select('*').in('user_id', users),
    db.from('user_state').select('user_id, data').in('user_id', users),
    db.from('profiles').select('id, couple_id').in('id', users),
  ]);
  const couples = [...new Set((profiles ?? []).map(p => p.couple_id).filter(Boolean))];
  const { data: shared } = couples.length
    ? await db.from('shared_state').select('couple_id, data').in('couple_id', couples)
    : { data: [] };
  const mine = new Map((states ?? []).map(s => [s.user_id, s.data ?? {}]));
  const coupleOf = new Map((profiles ?? []).map(p => [p.id, p.couple_id]));
  const ours = new Map((shared ?? []).map(s => [s.couple_id, s.data ?? {}]));

  let sent = 0;
  for (const r of due) {
    // если дело уже отметили (на другом телефоне или партнёр), не спрашиваем
    const mark = 'mark:' + r.day + ':' + r.key;
    const a = mine.get(r.user_id)?.[mark], b = ours.get(coupleOf.get(r.user_id))?.[mark];
    if ((a && a.v) || (b && b.v)) continue;
    const payload = JSON.stringify({ title: r.title, body: r.body, key: r.key, day: r.day });
    for (const s of (subs ?? []).filter(s => s.user_id === r.user_id)) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: 'high' });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
        else console.error('push failed', code);
      }
    }
  }
  return { sent };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (req.method === 'GET') return json({ publicKey: (await vapid()).pub });
    if (req.method === 'POST') {
      const s = await secret('cron_secret');
      if (!s || req.headers.get('x-cron-secret') !== s) return json({ error: 'forbidden' }, 403);
      return json(await send());
    }
    return json({ error: 'method' }, 405);
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
