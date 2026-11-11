// 로컬 파일 보관소. 카드 원본은 서버로 전송하지 않습니다.
const DB_NAME = '유희왕_DESIGN_LAB_자료실';
const STORE = 'files';
const DB_VERSION = 1;
export const MAX_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 96 * 1024 * 1024;
export const MAX_FILE_COUNT = 120;
let openPromise;
const sessionFiles = new Map();
let mode = 'unknown';

export function fileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export function detectFileConflicts(rows) {
  const byName = new Map();
  const conflicts = new Set();
  for (const row of rows) {
    const name = row.name.normalize('NFKC').toLocaleLowerCase('ko');
    const existing = byName.get(name);
    if (existing && existing.sha256 !== row.sha256) {
      conflicts.add(existing.id);
      conflicts.add(row.id);
    } else if (!existing) {
      byName.set(name, row);
    }
  }
  return conflicts;
}

function openingError(error) {
  return error instanceof Error ? error : new Error('브라우저 저장소를 열지 못했습니다.');
}

export function openStore() {
  if (openPromise) return openPromise;
  if (typeof indexedDB === 'undefined') {
    mode = 'session';
    return Promise.resolve(null);
  }
  openPromise = new Promise((resolve, reject) => {
    let request;
    try { request = indexedDB.open(DB_NAME, DB_VERSION); }
    catch (error) { reject(openingError(error)); return; }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => {
      mode = 'persistent';
      const db = request.result;
      db.onversionchange = () => { db.close(); openPromise = null; };
      resolve(db);
    };
    request.onerror = () => reject(openingError(request.error));
    request.onblocked = () => reject(new Error('다른 탭에서 저장소를 사용하고 있습니다. 다른 DESIGN LAB 탭을 닫으세요.'));
  }).catch((error) => {
    mode = 'session';
    openPromise = null;
    return null;
  });
  return openPromise;
}

export async function currentStorageMode() {
  await openStore();
  return mode === 'persistent' ? 'persistent' : 'session';
}

function transact(db, modeName, callback) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, modeName);
    const store = transaction.objectStore(STORE);
    let result;
    try { result = callback(store); }
    catch (e) { transaction.abort(); reject(e); return; }
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB 트랜잭션 실패'));
    transaction.onabort = () => reject(transaction.error || new Error('저장 공간 부족 또는 브라우저 저장 차단'));
  });
}
async function requestResult(db, method, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, method === 'getAll' ? 'readonly' : 'readwrite');
    const request = method === 'getAll' ? tx.objectStore(STORE).getAll()
      : method === 'put' ? tx.objectStore(STORE).put(value)
      : method === 'delete' ? tx.objectStore(STORE).delete(value)
      : tx.objectStore(STORE).clear();
    let result;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error || new Error('파일 저장 실패'));
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('파일 저장 트랜잭션 실패'));
    tx.onabort = () => reject(tx.error || new Error('파일 저장 취소'));
  });
}

export async function listAssets() {
  const db = await openStore();
  const rows = db ? await requestResult(db, 'getAll') : [...sessionFiles.values()];
  return rows.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}
export async function assetFiles() {
  const rows = await listAssets();
  return rows.map((row) => new File([row.blob], row.name, { type: row.type || 'application/octet-stream', lastModified: row.lastModified || Date.now() }));
}

async function checksum(buffer) {
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256 해시 기능을 이용할 수 없습니다. 보안 연결(HTTPS)에서 열어 주세요.');
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('');
}

// 동일 SHA256은 중복으로 두지 않습니다. 동일 파일명의 서로 다른 SHA256은 버전 충돌로 보존합니다.
export async function addAssets(files) {
  const db = await openStore();
  const result = { added: [], skipped: [], errors: [] };
  const current = await listAssets();
  const ids = new Set(current.map((row) => row.id));
  let bytes = current.reduce((sum, row) => sum + row.size, 0);
  for (const file of files) {
    try {
      if (!/\.(zip|txt|cdb|lua|ydk)$/i.test(file.name)) throw new Error('지원하지 않는 확장자');
      if (file.size > MAX_FILE_BYTES) throw new Error('파일당 32MB 초과');
      if (!file.size) throw new Error('빈 파일');
      const buffer = await file.arrayBuffer();
      const sha256 = await checksum(buffer);
      const id = sha256;
      if (ids.has(id)) {
        result.skipped.push(file.name + ' — 동일 내용 이미 보관');
        continue;
      }
      if (ids.size >= MAX_FILE_COUNT) throw new Error('등록 파일 120개 제한 초과');
      if (bytes + file.size > MAX_TOTAL_BYTES) throw new Error('전체 보관 용량 96MB 제한 초과');
      const row = {
        id, name: file.name, sha256, size: file.size, type: file.type || '',
        createdAt: Date.now(), lastModified: file.lastModified || 0, blob: new Blob([buffer])
      };
      if (db) await requestResult(db, 'put', row);
      else sessionFiles.set(id, row);
      ids.add(id);
      bytes += file.size;
      result.added.push(file.name);
    } catch (error) {
      result.errors.push(file.name + ' — ' + (error?.message || String(error)));
    }
  }
  return result;
}
export async function removeAsset(id) {
  const db = await openStore();
  if (db) await requestResult(db, 'delete', id);
  else sessionFiles.delete(id);
}
export async function clearAssets() {
  const db = await openStore();
  if (db) await requestResult(db, 'clear');
  else sessionFiles.clear();
}
