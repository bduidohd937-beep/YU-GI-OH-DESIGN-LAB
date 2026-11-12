import {
  addAssets, listAssets, assetFiles, removeAsset, clearAssets,
  currentStorageMode, detectFileConflicts, fileSize
} from './storage.js';
import { refreshLibrary } from './main.js';
import { refreshAudit } from './audit-ui.js';
import { refreshDeck } from './deck-lab-ui.js';

const $ = (id) => document.getElementById(id);
const dialog = $('assets-dialog');
const inputs = [$('assets-input'), $('assets-modal-input'), $('file-input'), $('audit-input'), $('deck-import')];
let busy = false;
let lastNotice = '';

function make(tag, className = '', text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}
function notice(text, error = false) {
  lastNotice = text;
  $('assets-message').textContent = text;
  $('assets-message').classList.toggle('is-error', error);
}
async function refreshAll() {
  const files = await assetFiles();
  const outcomes = await Promise.allSettled([refreshLibrary(files), refreshAudit(files), refreshDeck(files)]);
  const errors = outcomes.filter((r) => r.status === 'rejected').map((r) => r.reason?.message || String(r.reason));
  if (errors.length) notice('일부 검사 새로고침 실패: ' + errors.join(' / '), true);
}

async function draw() {
  const rows = await listAssets();
  const conflicts = detectFileConflicts(rows);
  const mode = await currentStorageMode();
  const bytes = rows.reduce((sum, row) => sum + row.size, 0);
  $('assets-count').textContent = String(rows.length);
  $('assets-total').textContent = rows.length + '개 · ' + fileSize(bytes) + ' · ' +
    (mode === 'persistent' ? '브라우저에 저장됨' : '임시 세션(지속 저장 불가)');
  $('assets-clear').disabled = !rows.length || busy;
  const list = $('assets-list');
  list.replaceChildren();
  if (!rows.length) {
    list.append(make('div', 'assets-empty', '아직 보관한 파일이 없습니다. 원문 ZIP부터 추가해 보세요.'));
    return;
  }
  for (const row of rows) {
    const item = make('div', 'assets-item');
    const info = make('div', 'assets-item-main');
    const headline = make('div', 'assets-item-name', row.name);
    const meta = make('div', 'assets-item-meta', fileSize(row.size) + ' · SHA256 ' + row.sha256.slice(0, 10));
    info.append(headline, meta);
    if (conflicts.has(row.id)) {
      info.append(make('div', 'assets-conflict', '같은 파일명의 다른 버전 있음 — 검수 기준을 확인하세요'));
    }
    if (/\.ydk$/i.test(row.name)) info.append(make('div', 'assets-muted', '덱 연구소에서 구성·초동 확률 분석 지원'));
    const actions = make('div', 'assets-item-actions');
    const download = make('button', 'assets-download', '원본 저장');
    download.type = 'button';
    download.addEventListener('click', () => {
      const url = URL.createObjectURL(row.blob);
      const link = make('a');
      link.href = url;
      link.download = row.name;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    });
    const button = make('button', 'assets-remove', '삭제');
    button.type = 'button';
    button.disabled = busy;
    button.setAttribute('aria-label', row.name + ' 삭제');
    button.addEventListener('click', async () => {
      if (busy || !window.confirm('다음 파일을 브라우저 보관함에서 삭제할까요?\n' + row.name)) return;
      busy = true;
      try {
        await removeAsset(row.id);
        await refreshAll();
        notice(row.name + ' — 삭제했습니다.');
      } catch (error) { notice('삭제 실패: ' + error.message, true); }
      finally { busy = false; await draw(); }
    });
    actions.append(download, button);
    item.append(info, actions);
    list.append(item);
  }
}

async function addFiles(files) {
  const selected = [...(files || [])];
  if (!selected.length || busy) return;
  busy = true;
  notice('파일 ' + selected.length + '개의 내용을 확인하고 로컬 보관함에 저장하는 중...');
  try {
    const added = await addAssets(selected);
    await refreshAll();
    const mode = await currentStorageMode();
    const report = '신규 ' + added.added.length + '개 등록 · 중복 ' + added.skipped.length +
      '개 건너뜀' + (added.errors.length ? ' · 오류 ' + added.errors.length + '건: ' + added.errors.join(' / ') : '') +
      (mode === 'persistent' ? ' · 브라우저 저장됨' : ' · 임시 세션: 새로고침 후 복원 불가');
    notice(report, !!added.errors.length || mode !== 'persistent');
  } catch (error) {
    notice('파일 처리 오류: ' + (error?.message || String(error)), true);
  } finally {
    busy = false;
    await draw();
  }
}

window.addEventListener('designlab:import-files', (event) => {
  addFiles(event.detail?.files || []);
});

for (const input of inputs) {
  if (!input) continue;
  input.addEventListener('change', async () => {
    const files = [...input.files];
    input.value = '';
    await addFiles(files);
  });
}

$('assets-open').addEventListener('click', () => {
  draw().then(() => { if (!dialog.open) dialog.showModal(); })
    .catch((error) => notice('파일 목록 불러오기 실패: ' + error.message, true));
});
$('assets-close').addEventListener('click', () => dialog.close());
$('assets-clear').addEventListener('click', async () => {
  if (busy) return;
  if (!window.confirm('보관된 원문·CDB·Lua·덱 파일을 모두 삭제할까요?\n원본 ZIP은 별도로 보관되어 있어야 합니다.')) return;
  busy = true;
  try {
    await clearAssets();
    await refreshAll();
    notice('등록 파일을 모두 삭제했습니다.');
  } catch (error) { notice('전체 삭제 실패: ' + error.message, true); }
  finally { busy = false; await draw(); }
});

// 새로고침 직후 IndexedDB 자료를 복원하여 자료실·검수실에 연결합니다.
(async () => {
  try {
    const mode = await currentStorageMode();
    const rows = await listAssets();
    await refreshAll();
    notice(mode === 'persistent'
      ? '브라우저 저장소 준비 완료 · 등록 자료 ' + rows.length + '개를 복원했습니다.'
      : '브라우저의 지속 저장을 사용할 수 없습니다. 파일은 이번 탭에서만 임시 보관합니다.', mode !== 'persistent');
    await draw();
  } catch (error) {
    notice('기존 자료 복원 실패: ' + (error?.message || String(error)), true);
  }
})();
