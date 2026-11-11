import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { File as NodeFile } from 'node:buffer';
import * as storage from '../src/storage.js';

globalThis.crypto ||= webcrypto;
globalThis.File ||= NodeFile;

// 브라우저의 IndexedDB 비동기 트랜잭션 모델을 흉내내어 별도 모듈 재로드를 검증합니다.
function fakeIndexedDB() {
  const rows = new Map();
  let created = false;
  const database = {
    objectStoreNames: { contains: () => created },
    createObjectStore: () => { created = true; },
    close() {},
    transaction: () => {
      const tx = {
        objectStore() {
          function requestWith(action) {
            const req = {};
            queueMicrotask(() => {
              try {
                req.result = action();
                req.onsuccess?.();
                queueMicrotask(() => tx.oncomplete?.());
              } catch (error) {
                req.error = error;
                req.onerror?.();
                tx.onerror?.();
              }
            });
            return req;
          }
          return {
            getAll: () => requestWith(() => [...rows.values()]),
            put: (value) => requestWith(() => { rows.set(value.id, value); return value.id; }),
            delete: (key) => requestWith(() => rows.delete(key)),
            clear: () => requestWith(() => rows.clear())
          };
        }
      };
      return tx;
    }
  };
  return {
    open() {
      const request = { result: database };
      queueMicrotask(() => {
        if (!created) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    }
  };
}
globalThis.indexedDB = fakeIndexedDB();

const make = (content, name) => new File([content], name, { type: 'text/plain' });

test('IndexedDB에 추가한 ZIP/TXT를 새 모듈(새로고침 상황)에서 다시 읽을 수 있다', async () => {
  assert.equal(await storage.currentStorageMode(), 'persistent');
  await storage.clearAssets();
  const added = await storage.addAssets([make('카드 A', '종언성서_원문.txt'), make('PK\x03\x04', '파계잔영.zip')]);
  assert.equal(added.added.length, 2);
  const restoredModule = await import('../src/storage.js?reload-simulation');
  const rows = await restoredModule.listAssets();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.name), ['종언성서_원문.txt', '파계잔영.zip']);
  const files = await restoredModule.assetFiles();
  assert.equal(await files[0].text(), '카드 A');
});

test('동일 내용 중복 추가는 건너뛰고 같은 파일명의 변경본은 별도 보관', async () => {
  await storage.clearAssets();
  const first = await storage.addAssets([make('원문 V1', '혈성_원문.txt')]);
  const duplicate = await storage.addAssets([make('원문 V1', '혈성_원문.txt')]);
  const changed = await storage.addAssets([make('원문 V2', '혈성_원문.txt')]);
  assert.equal(first.added.length, 1);
  assert.equal(duplicate.skipped.length, 1);
  assert.equal(changed.added.length, 1);
  const rows = await storage.listAssets();
  assert.equal(rows.length, 2);
  assert.equal(storage.detectFileConflicts(rows).size, 2);
  assert.deepEqual((await storage.assetFiles()).map((f) => f.name), ['혈성_원문.txt', '혈성_원문.txt']);
  assert.equal(await (await storage.assetFiles())[1].text(), '원문 V2');
});

test('개별 삭제와 전체 삭제가 보관 자료를 실제로 비운다', async () => {
  const files = await storage.listAssets();
  assert.equal(files.length, 2);
  await storage.removeAsset(files[0].id);
  assert.equal((await storage.listAssets()).length, 1);
  await storage.clearAssets();
  assert.equal((await storage.listAssets()).length, 0);
});

test('허용하지 않는 파일·32MB 초과 파일은 저장하지 않고 오류 표시', async () => {
  const invalid = {
    name: '거대_원문.txt', size: 33 * 1024 * 1024,
    async arrayBuffer() { throw new Error('여기까지 도달하면 안 됩니다.'); }
  };
  const result = await storage.addAssets([make('실행 파일', '프로그램.exe'), invalid]);
  assert.equal(result.errors.length, 2);
  assert.equal((await storage.listAssets()).length, 0);
});

test('상단 UI와 두 분석 화면이 공용 보관소에 연결됨', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const ui = readFileSync(new URL('../src/storage-ui.js', import.meta.url), 'utf8');
  const library = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const audit = readFileSync(new URL('../src/audit-ui.js', import.meta.url), 'utf8');
  for (const id of ['assets-dialog','assets-open','assets-count','assets-input','assets-modal-input',
    'assets-list','assets-clear','assets-message','assets-close']) {
    assert.match(html, new RegExp('id="' + id + '"'), id);
  }
  assert.match(ui, /addAssets\(/);
  assert.match(ui, /assetFiles\(/);
  assert.match(ui, /refreshAll\(/);
  assert.match(library, /export async function refreshLibrary/);
  assert.match(audit, /export async function refreshAudit/);
  assert.doesNotMatch(library, /byId\.input\.addEventListener\('change'/);
  assert.doesNotMatch(audit, /\$\('audit-input'\)\.addEventListener\('change'/);
});

test('지속 저장 불가 시 성공이라고 말하지 않고 임시 모드로 구분', async () => {
  delete globalThis.indexedDB;
  const standalone = await import('../src/storage.js?session-only');
  assert.equal(await standalone.currentStorageMode(), 'session');
  const r = await standalone.addAssets([make('임시 파일', '임시.txt')]);
  assert.equal(r.added.length, 1);
  assert.equal((await standalone.listAssets()).length, 1);
  await standalone.clearAssets();
});
