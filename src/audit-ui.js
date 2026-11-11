import { readCardDatabase } from './cdb.js';
import { buildAudit, auditMarkdown } from './audit.js';

const BASE = 'https://cdn.jsdelivr.net/npm/sql.js@1.13.0/dist/';
const BYTES_ZIP = 20 * 1024 * 1024;
const BYTES_CDB = 16 * 1024 * 1024;
const BYTES_TEXT = 2 * 1024 * 1024;
const MAX_FILES = 120;

const $ = (id) => document.getElementById(id);
let result = null;
let selectedKey = null;
let filter = 'all';

function dom(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}

function notify(text, bad = false) {
  $('audit-message').textContent = text;
  $('audit-message').className = bad ? 'audit-message is-error' : 'audit-message';
}

let sqlPromise;
function loadSQL() {
  if (!sqlPromise) {
    if (typeof globalThis.initSqlJs !== 'function') {
      throw new Error('sql.js를 불러올 수 없습니다. 인터넷 연결을 확인해 주세요.');
    }
    sqlPromise = globalThis.initSqlJs({ locateFile: (name) => BASE + name })
      .catch((err) => { sqlPromise = null; throw err; });
  }
  return sqlPromise;
}

function suffix(name) {
  return (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
}

function kind(name) {
  const ext = suffix(name);
  return ['txt', 'lua', 'cdb'].includes(ext) ? ext : null;
}

async function readImportFiles(files) {
  const texts = [];
  const luaFiles = [];
  const cdbBins = [];
  const warnings = [];
  let entriesSeen = 0;
  async function store(filename, origin, data, type) {
    if (type === 'txt') {
      const text = typeof data === 'string' ? data : new TextDecoder('utf-8').decode(data);
      texts.push({ name: filename.split('/').pop(), text });
    } else if (type === 'lua') {
      const text = typeof data === 'string' ? data : new TextDecoder('utf-8').decode(data);
      luaFiles.push({ name: filename, origin, text });
    } else if (type === 'cdb') {
      cdbBins.push({ origin, bytes: data });
    }
  }

  for (const file of [...files]) {
    const ext = suffix(file.name);
    if (ext === 'zip') {
      if (file.size > BYTES_ZIP) { warnings.push(file.name + ' : ZIP 20MB 제한 초과'); continue; }
      if (!globalThis.JSZip) {
        warnings.push(file.name + ' : JSZip 로딩 실패. TXT·CDB·Lua 파일을 직접 선택해 주세요.');
        continue;
      }
      let archive;
      try { archive = await globalThis.JSZip.loadAsync(file, { checkCRC32: true }); }
      catch (error) { warnings.push(file.name + ' : ZIP을 열 수 없음 — ' + error.message); continue; }
      const entries = Object.values(archive.files).filter((e) => !e.dir);
      entriesSeen += entries.length;
      if (entriesSeen > MAX_FILES) {
        warnings.push('파일 항목이 120개를 초과했습니다. 해당 ZIP 분석을 건너뜁니다.');
        continue;
      }
      for (const entry of entries) {
        const name = entry.name.replace(/\\/g, '/');
        const type = kind(name);
        if (!type) continue;
        if (name.startsWith('/') || name.split('/').includes('..')) {
          warnings.push('위험한 ZIP 경로 건너뜀: ' + name);
          continue;
        }
        const cap = type === 'cdb' ? BYTES_CDB : BYTES_TEXT;
        if (entry._data?.uncompressedSize > cap) {
          warnings.push('압축 해제 크기 제한 초과: ' + name);
          continue;
        }
        try {
          const bytes = await entry.async('uint8array');
          if (bytes.byteLength > cap) { warnings.push('파일 크기 제한 초과: ' + name); continue; }
          await store(name, file.name + ' / ' + name, bytes, type);
        } catch (error) { warnings.push(name + ' 읽기 실패: ' + error.message); }
      }
    } else {
      const type = kind(file.name);
      if (!type) { warnings.push('지원하지 않는 파일: ' + file.name); continue; }
      entriesSeen++;
      const cap = type === 'cdb' ? BYTES_CDB : BYTES_TEXT;
      if (file.size > cap) { warnings.push(file.name + ' : 크기 제한 초과'); continue; }
      const bytes = new Uint8Array(await file.arrayBuffer());
      await store(file.name, file.name, bytes, type);
    }
  }
  const cdbCards = [];
  if (cdbBins.length) {
    const SQL = await loadSQL();
    for (const item of cdbBins) {
      try {
        const db = readCardDatabase(SQL, item.bytes, item.origin);
        cdbCards.push(...db.cards);
        warnings.push(...db.warnings);
      } catch (error) {
        warnings.push(item.origin + ' : CDB 읽기 실패 — ' + error.message);
      }
    }
  }
  return { textFiles: texts, cdbCards, luaFiles, loadingWarnings: warnings };
}

function rankIssue(issues) {
  return issues.some((x) => x.severity === 'error') ? 'error' :
    issues.some((x) => x.severity === 'warning') ? 'warning' : 'info';
}

function render() {
  const summary = result?.counts || { source: 0, cdb: 0, lua: 0, error: 0, warning: 0, info: 0 };
  $('audit-stat-source').textContent = summary.source;
  $('audit-stat-cdb').textContent = summary.cdb;
  $('audit-stat-lua').textContent = summary.lua;
  $('audit-stat-issues').textContent = summary.error + summary.warning;
  $('audit-export').disabled = !result?.cards?.length;
  const list = $('audit-results');
  const previousScroll = list.scrollTop;
  list.replaceChildren();
  if (!result) {
    list.append(dom('p', 'audit-empty', '원문 ZIP과 패키지 ZIP을 함께 올려 비교 검사를 시작하세요.'));
    $('audit-detail').replaceChildren(dom('p', 'audit-empty', '검사 후 카드를 선택하면 발견된 항목과 근거를 확인할 수 있어요.'));
    return;
  }

  const rows = result.cards.filter((c) => filter === 'all' || (filter === 'issues'
    ? c.issues.some((i) => i.severity === 'warning' || i.severity === 'error')
    : c.status === filter));
  if (!rows.length) list.append(dom('p', 'audit-empty', '해당 조건의 카드가 없습니다.'));
  for (const card of rows) {
    const button = dom('button', 'audit-card' + (card.key === selectedKey ? ' selected' : ''));
    button.type = 'button';
    const status = rankIssue(card.issues);
    const label = status === 'error' ? '오류 후보' : status === 'warning' ? '검토 필요' : '정보 / 미확인';
    const line = dom('span', 'audit-card-title', card.name);
    const note = dom('span', 'audit-card-meta', card.theme + ' · ' + (card.id || 'ID 미연결') + ' · ' + card.issues.length + '건');
    button.append(line, note, dom('span', 'audit-status ' + status, label));
    button.addEventListener('click', () => { if (selectedKey !== card.key) $('audit-detail').scrollTop = 0; selectedKey = card.key; render(); });
    list.append(button);
  }
  list.scrollTop = previousScroll;
  const card = rows.find((c) => c.key === selectedKey) || rows[0] || null;
  const previousKey = selectedKey;
  if (card) selectedKey = card.key;
  const panel = $('audit-detail');
  panel.replaceChildren();
  if (previousKey !== (card?.key || null)) panel.scrollTop = 0;
  if (!card) { panel.append(dom('p', 'audit-empty', '표시할 카드가 없습니다.')); return; }
  panel.append(dom('div', 'audit-detail-heading', card.theme + ' / ' + (card.id || 'ID 미연결')));
  panel.append(dom('h3', 'audit-detail-name', card.name));
  const mapping = dom('div', 'audit-mapping');
  for (const [name, text] of [['원문', card.source], ['CDB', card.cdb || '입력 없음 / 연결 실패'], ['Lua', card.lua || '입력 없음 / 연결 실패']]) {
    const line = dom('div', 'audit-mapping-line');
    line.append(dom('strong', '', name), dom('span', '', text));
    mapping.append(line);
  }
  panel.append(mapping, dom('h4', 'audit-subhead', '정적 검사 항목'));
  if (!card.issues.length) panel.append(dom('p', 'audit-noissue', '현재 정적 비교에서 문제 후보 없음. 실제 듀얼 정상 작동을 보증하지 않습니다.'));
  for (const item of card.issues) {
    const block = dom('div', 'audit-issue issue-' + item.severity);
    block.append(dom('strong', '', '[' + item.code + '] ' + item.title), dom('p', '', item.detail));
    panel.append(block);
  }
  panel.append(dom('h4', 'audit-subhead', '원문과 CDB 효과 보기'));
  const compare = dom('div', 'audit-text-compare');
  const orig = dom('div');
  orig.append(dom('h5', '', '설계 원문'), dom('pre', '', card.description || '없음'));
  const cdb = dom('div');
  cdb.append(dom('h5', '', 'CDB 설명'), dom('pre', '', card.cdbDescription || '없음'));
  compare.append(orig, cdb);
  panel.append(compare);
  const warnings = $('audit-warnings');
  warnings.replaceChildren();
  if (result.warnings.length) {
    const summary = dom('details', 'audit-warning-list');
    summary.append(dom('summary', '', '파일 범위·중복·가져오기 경고 ' + result.warnings.length + '건'),
      dom('pre', '', result.warnings.join('\n')));
    warnings.append(summary);
  }
}

$('audit-input').addEventListener('change', async (event) => {
  const files = [...event.target.files];
  event.target.value = '';
  if (!files.length) return;
  $('audit-input').disabled = true;
  notify('CDB·Lua·원문을 분석하는 중입니다...');
  try {
    const data = await readImportFiles(files);
    result = buildAudit(data);
    selectedKey = result.cards[0]?.key || null;
    filter = 'all';
    $('audit-filter').value = 'all';
    render();
    notify('정적 검사 완료. 원문 ' + result.counts.source + '종 · CDB ' + result.counts.cdb +
      '종 · Lua ' + result.counts.lua + '개 / 오류 후보 ' + result.counts.error +
      '건 · 검토 필요 ' + result.counts.warning + '건. 실제 듀얼 검증은 별도입니다.');
  } catch (error) {
    notify('검사 실패: ' + error.message, true);
  } finally {
    $('audit-input').disabled = false;
  }
});
$('audit-filter').addEventListener('change', (event) => { filter = event.target.value; render(); });
$('audit-export').addEventListener('click', () => {
  if (!result?.cards?.length) return;
  const blob = new Blob([auditMarkdown(result)], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = dom('a');
  link.href = url;
  link.download = '종언성서_원문_CDB_Lua_정적검수_V0.2.md';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});
render();
