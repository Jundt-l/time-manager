// Маленькая очередь в IndexedDB: сюда service worker кладёт ответы из уведомлений,
// а приложение забирает их при следующем открытии. Файл используется и в sw.js, и в приложении.
const DB = 'time-manager', STORE = 'inbox';

function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { autoIncrement: true });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function inboxPut(entry) {
  const db = await open();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(entry);
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function inboxTake() {
  try {
    const db = await open();
    const list = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const st = tx.objectStore(STORE);
      const req = st.getAll();
      req.onsuccess = () => { st.clear(); };
      tx.oncomplete = () => resolve(req.result || []);
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return list;
  } catch (e) { return []; }
}
