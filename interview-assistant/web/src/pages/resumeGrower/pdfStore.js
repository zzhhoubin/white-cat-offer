/** 原 PDF 存 IndexedDB（与 localStorage 元数据分离，避免撑爆配额） */

const DB_NAME = "resume_grower_pdf_v1";
const STORE = "pdfs";
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

export async function putResumePdf(resumeId, blob) {
  if (!resumeId || !blob) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, resumeId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("putResumePdf failed"));
  });
}

export async function getResumePdf(resumeId) {
  if (!resumeId) return null;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(resumeId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error("getResumePdf failed"));
  });
}

export async function deleteResumePdf(resumeId) {
  if (!resumeId) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(resumeId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("deleteResumePdf failed"));
  });
}
