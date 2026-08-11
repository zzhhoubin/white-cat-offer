/** 资料库原文件存 IndexedDB（与 localStorage 元数据分离） */

const DB_NAME = "resume_grower_library_files_v1";
const STORE = "files";
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
  });
}

export async function putLibraryFileBlob(fileId, blob) {
  if (!fileId || !blob) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, fileId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("putLibraryFileBlob failed"));
  });
}

export async function getLibraryFileBlob(fileId) {
  if (!fileId) return null;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(fileId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error("getLibraryFileBlob failed"));
  });
}

export async function deleteLibraryFileBlob(fileId) {
  if (!fileId) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(fileId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("deleteLibraryFileBlob failed"));
  });
}

export async function deleteLibraryFileBlobs(ids) {
  for (const id of ids || []) {
    try {
      await deleteLibraryFileBlob(id);
    } catch {
      /* ignore */
    }
  }
}
