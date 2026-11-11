import { readCardDatabase } from './cdb.js';
import { buildAudit, auditMarkdown } from './audit.js';
import { buildCardPlan, cardPlanMarkdown, fixPlanMarkdown } from './fix-planner.js';
import { createAuditReader } from './audit-reader.js';
import { createImplementationPanel } from './effect-implementation-ui.js';
import { implementationMarkdown } from './effect-implementation.js';
import { isOptionalInstallPath } from './package-versions.js';
import { createImportNoticeViewer, categorizeImportNotices } from './import-notice-ui.js';
import { createTestRecorder } from './test-recorder-ui.js';
import { buildThemeDashboard, themeAuditMarkdown, buildManualTestPlan, manualTestMarkdown } from './smart-audit.js';

const BASE = 'https://cdn.jsdelivr.net/npm/sql.js@1.13.0/dist/';
const BYTES_ZIP = 20 * 1024 * 1024;
const BYTES_CDB = 16 * 1024 * 1024;
const BYTES_TEXT = 2 * 1024 * 1024;
const MAX_FILES = 120;

const $ = (id) => document.getElementById(id);
let result = null;
let selectedKey = null;
let filter = 'all';
let themeFilter = '전체';
const importNotices = createImportNoticeViewer();
const testRecorder = createTestRecorder({
  getResult:()=>result, getThemeFilter:()=>themeFilter, getSelectedKey:()=>selectedKey
});

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
      // 선택 설치용 부가 CDB·Lua는 본체와 섞지 않습니다. 명시적으로 개별 업로드하면 분석합니다.
      const optional = entries.filter((e) => kind(e.name) && isOptionalInstallPath(e.name));
      if (optional.length) warnings.push(file.name + ' : 별도 선택 설치용 TXT/CDB/Lua ' +
        optional.length + '개는 본체 자동 검수에서 제외했습니다. 개별 파일로 추가하면 분석할 수 있습니다.');
      // ZIP 내부 이미지·문서·선택 설치 파일은 분석 항목 수에 포함하지 않습니다.
      const analyzable = entries.filter((e) => kind(e.name) && !isOptionalInstallPath(e.name));
      entriesSeen += analyzable.length;
      if (entriesSeen > MAX_FILES) {
        warnings.push('검사 대상 TXT/CDB/Lua가 총 120개를 초과했습니다. 일부 ZIP을 나누어 불러오세요.');
        continue;
      }
      for (const entry of analyzable) {
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

function renderSmartDashboard() {
  const dashboard = buildThemeDashboard(result);
  const list = $('smart-theme-list');
  list.replaceChildren();
  const buttons = [
    {theme:'전체',source:dashboard.totals.source,cdb:dashboard.totals.cdb,lua:dashboard.totals.lua,status:'전체'},
    ...dashboard.themes
  ];
  for (const theme of buttons) {
    const button = dom('button','smart-theme-button' + (themeFilter === theme.theme ? ' active':''));
    button.type = 'button';
    button.setAttribute('aria-pressed', String(themeFilter === theme.theme));
    const dot = dom('span','smart-dot ' + (theme.cdb && theme.lua ? 'ready' : theme.source || theme.cdb || theme.lua ? 'partial' : ''));
    const counts = dom('span','smart-tiny','원문 '+theme.source+' · DB '+theme.cdb+' · Lua '+theme.lua);
    button.append(dot,dom('strong','',theme.theme),counts);
    button.addEventListener('click',()=>{
      if (themeFilter === theme.theme) return;
      themeFilter = theme.theme;
      selectedKey = null;
      $('audit-detail').scrollTop = 0;
      render();
    });
    list.append(button);
  }
  const item = dashboard.themes.find((x)=>x.theme===themeFilter);
  const status = item
    ? item.theme+' · '+item.status+' · CDB 연결 '+item.withCdb+'종 · Lua 연결 '+item.withLua+'종 · 정적 문제 후보 '+item.codeCandidates+'건 · 실전 미검증'
    : '전체 '+dashboard.totals.listed+'종 · 자료 연결 '+dashboard.totals.ready+'종(CDB+Lua) · 정적 문제 후보 '+dashboard.totals.candidates+'건 · 실전 미검증';
  const unknown = dashboard.unknownCdb || dashboard.unknownLua
    ? ' · 미분류 자료: CDB '+dashboard.unknownCdb+'종/Lua '+dashboard.unknownLua+'개' : '';
  $('smart-status').textContent = status + unknown;
  $('smart-report-export').disabled = !result?.cards?.length;
  $('smart-test-export').disabled = !buildManualTestPlan(result,{theme:themeFilter}).cases.length;
  $('effect-export').disabled = !result?.cards?.some((card) =>
    (themeFilter === '전체' || card.theme === themeFilter) && card.effectImplementation?.scriptAvailable);
  testRecorder.sync();
}

function render() {
  const summary = result?.counts || { source: 0, cdb: 0, lua: 0, error: 0, warning: 0, info: 0 };
  $('audit-stat-source').textContent = summary.source;
  $('audit-stat-cdb').textContent = summary.cdb;
  $('audit-stat-lua').textContent = summary.lua;
  $('audit-stat-issues').textContent = summary.error + summary.warning;
  $('audit-export').disabled = !result?.cards?.length;
  $('fix-export').disabled = !result?.cards?.length;
  renderSmartDashboard();
  const panelRoot = $('검수실');
  panelRoot.classList.toggle('audit-has-results', !!result?.cards?.length);
  panelRoot.classList.toggle('audit-no-implementation', !!result?.cards?.length && !result.coverage.hasCdb && !result.coverage.hasLua);
  const coverage = $('audit-coverage-notice');
  const lacksCdb = !!result?.cards?.length && !result.coverage.hasCdb;
  const lacksLua = !!result?.cards?.length && !result.coverage.hasLua;
  coverage.hidden = !(lacksCdb || lacksLua);
  if (!coverage.hidden) coverage.textContent = (lacksCdb && lacksLua
    ? '현재 카드 원문만 ' + result.counts.source + '종 등록됐습니다. CDB·Lua 검사는 아직 진행되지 않았습니다.'
    : lacksCdb ? 'CDB 카드가 확인되지 않아 원문·CDB 대조를 할 수 없습니다.'
    : 'Lua가 확인되지 않아 코드 심층 검사를 할 수 없습니다.') +
    ' 상단 파일 추가에서 해당 테마의 CDB 및 Lua 시험패키지를 등록하세요. 자료 부족은 카드 오류가 아닙니다.';
  const list = $('audit-results');
  const previousScroll = list.scrollTop;
  list.replaceChildren();
  if (!result) {
    importNotices.render(null);
    list.append(dom('p', 'audit-empty', '원문 ZIP과 패키지 ZIP을 함께 올려 비교 검사를 시작하세요.'));
    $('audit-detail').replaceChildren(dom('p', 'audit-empty', '검사 후 카드를 선택하면 발견된 항목과 근거를 확인할 수 있어요.'));
    reader.sync();
    return;
  }

  importNotices.render(result);

  const rows = result.cards.filter((c) => (themeFilter === '전체' || c.theme === themeFilter) && (filter === 'all' ||
    (filter === 'issues' ? c.issues.some((i) => i.severity === 'warning' || i.severity === 'error') :
      filter === 'lua' ? c.issues.some((i) => Number.isInteger(i.line)) :
      filter === 'implementation' ? ['count_review','no_direct_registration','helper_review'].includes(c.effectImplementation?.state) :
      filter === 'fix' ? buildCardPlan(c).steps.some((step) => step.priority <= 2) : c.status === filter)));
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
  if (!card) { panel.append(dom('p', 'audit-empty', '표시할 카드가 없습니다.')); reader.sync(); return; }
  panel.append(dom('div', 'audit-detail-heading', card.theme + ' / ' + (card.id || 'ID 미연결')));
  panel.append(dom('h3', 'audit-detail-name', card.name));
  const mapping = dom('div', 'audit-mapping');
  for (const [name, text] of [['원문', card.source], ['CDB', card.cdb || '입력 없음 / 연결 실패'], ['Lua', card.lua || '입력 없음 / 연결 실패']]) {
    const line = dom('div', 'audit-mapping-line');
    line.append(dom('strong', '', name), dom('span', '', text));
    mapping.append(line);
  }
  panel.append(mapping);
  if (card.effectImplementation && (card.cdb || card.lua)) {
    panel.append(createImplementationPanel(card.effectImplementation));
  }
  if (!result.coverage.hasCdb && !result.coverage.hasLua) {
    const note = dom('section','audit-no-code-note');
    note.append(
      dom('h4','','아직 CDB·Lua를 검수하지 않았습니다'),
      dom('p','','현재 카드 원문만 등록된 상태입니다. 표시된 자료 보강 항목은 개별 카드의 코드 오류가 아닙니다. 최신 테마 CDB와 Lua 패키지를 추가하면 실제 검수 후보가 나타납니다.')
    );
    panel.append(note);
    if (card.description) {
      const details = dom('details','audit-source-preview');
      details.open = true; // 코드 자료가 없을 때는 중요한 카드 원문을 기본적으로 보여줍니다.
      details.append(dom('summary','','카드 원문 · 접기/펼치기'),dom('pre','',card.description));
      panel.append(details);
    }
    reader.sync();
    return;
  }

  const plan = buildCardPlan(card);
  const planBox = dom('details', 'fix-plan-drawer');
  const planSummary = dom('summary', '', '수정 검토안 · ' + plan.steps.length + '건 · 펼쳐보기');
  planBox.append(planSummary);
  const planBody = dom('div', 'fix-plan-body');
  if (!plan.steps.length) {
    planBody.append(dom('p', 'fix-no-action', '이번 정적 검사에서는 수정 검토 항목이 없습니다. EDOPro 정상 작동을 보증하지는 않습니다.'));
  }
  for (const step of plan.steps) {
    const block = dom('section', 'fix-step fix-level-' + step.priority);
    const heading = dom('h5', 'fix-step-title', step.priorityLabel + ' · ' + step.problem);
    block.append(heading);
    block.append(dom('div', 'fix-step-meta', step.group + ' / ' + step.code + ' / ' + step.basis));
    const lines = [
      ['관찰된 내용', step.detail],
      ['권장 조치', step.suggestedAction],
      ['확인 방법', step.verify]
    ];
    for (const [label, text] of lines) {
      const row = dom('p', 'fix-step-line');
      row.append(dom('strong', '', label + ': '), document.createTextNode(text));
      block.append(row);
    }
    for (const evidence of step.evidence) {
      block.append(dom('div', 'fix-step-source', evidence.file + ':' + evidence.line));
      if (evidence.snippet) block.append(dom('code', 'audit-evidence-code', evidence.snippet));
    }
    planBody.append(block);
  }
  if (plan.steps.length) {
    const copy = dom('button', 'fix-copy', '현재 카드 수정안 복사');
    copy.type = 'button';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(cardPlanMarkdown(plan));
        copy.textContent = '복사 완료 ✓';
      } catch {
        copy.textContent = '복사 실패 — 보고서 저장을 이용하세요';
      }
    });
    planBody.append(copy);
  }
  planBody.append(dom('p', 'fix-notice', '이 제안은 규칙 기반 검토 목록입니다. Lua·CDB를 자동 수정하거나 EDOPro에서 시험하지 않습니다.'));
  planBox.append(planBody);
  panel.append(planBox, dom('h4', 'audit-subhead', '정적 검사 항목'));
  if (!card.issues.length) panel.append(dom('p', 'audit-noissue', '현재 정적 비교에서 문제 후보 없음. 실제 듀얼 정상 작동을 보증하지 않습니다.'));
  for (const item of card.issues) {
    const block = dom('div', 'audit-issue issue-' + item.severity);
    const level = item.confidence === 'static' ? '정적 코드 패턴 확인' :
      item.confidence === 'review' ? '엔진 동작 검토 필요' : '기초 비교';
    block.append(dom('strong', '', '[' + item.code + '] ' + item.title));
    const evidence = item.line ? ' · ' + (item.file || card.lua || 'Lua') + ':' + item.line : '';
    block.append(dom('div', 'audit-evidence-meta', level + evidence));
    block.append(dom('p', '', item.detail));
    if (item.snippet) block.append(dom('code', 'audit-evidence-code', item.snippet));
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
  reader.sync();
}

// 파일 선택은 공용 자료 관리자가 처리하며, 새로고침 시 저장된 자료를 재검사합니다.
export async function refreshAudit(files) {
  $('audit-input').disabled = true;
  notify('저장된 원문·CDB·Lua를 교차 검사하고 있습니다...');
  try {
    const relevant = [...(files || [])].filter((file) => /\.(zip|txt|cdb|lua)$/i.test(file.name));
    if (!relevant.length) {
      result = null;
      selectedKey = null;
      render();
      notify('아직 등록된 검수 자료가 없습니다. 원문 또는 CDB·Lua 파일을 추가해 주세요.');
      return;
    }
    const data = await readImportFiles(relevant);
    result = buildAudit(data);
    if (!result.cards.some((card) => card.key === selectedKey)) selectedKey = result.cards[0]?.key || null;
    render();
    const diagnostics = categorizeImportNotices(result);
    notify((!result.coverage.hasCdb && !result.coverage.hasLua
      ? '원문 등록됨 · CDB/Lua 심층 검수는 자료 추가 대기 중 · 원문 '
      : '정적 검사 완료 · 원문 ') + result.counts.source + '종 / CDB ' + result.counts.cdb +
      '종 / Lua ' + result.counts.lua + '개 · 오류 후보 ' + result.counts.error +
      '건, 경고 ' + result.counts.warning + '건' +
      (diagnostics.reviewCount ? ' · 입력 확인 필요 ' + diagnostics.reviewCount + '건' : '') +
      (diagnostics.infoCount ? ' · 처리 안내 ' + diagnostics.infoCount + '건' : '') +
      (diagnostics.skipped.length ? ' · 참고 TXT ' + diagnostics.skipped.length + '개 자동 제외' : '') +
      ' (실제 EDOPro 테스트 아님)');
  } catch (error) {
    notify('교차 검수 실패: ' + (error?.message || String(error)), true);
    throw error;
  } finally {
    $('audit-input').disabled = false;
  }
}
const reader = createAuditReader({
  getResult: () => result,
  getSelectedKey: () => selectedKey,
  getThemeFilter: () => themeFilter,
  onSelect: (key) => { selectedKey = key; render(); }
});
function saveTextFile(text, filename) {
  const url = URL.createObjectURL(new Blob([text], {type:'text/markdown;charset=utf-8'}));
  const a = dom('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
}
$('smart-report-export').addEventListener('click',()=>{
  if (!result?.cards?.length) return;
  saveTextFile(themeAuditMarkdown(buildThemeDashboard(result)),'종언성서_테마별_스마트검수현황_V0.6.md');
});
$('smart-test-export').addEventListener('click',()=>{
  if (!result?.cards?.length) return;
  const plan = buildManualTestPlan(result,{theme:themeFilter});
  if (!plan.cases.length) return;
  saveTextFile(manualTestMarkdown(plan),'종언성서_'+(themeFilter==='전체'?'전체':themeFilter)+'_EDOPro_수동시험목록_V0.6.md');
});
$('effect-export').addEventListener('click',()=>{
  if (!result?.cards?.some((card)=>card.effectImplementation?.scriptAvailable)) return;
  saveTextFile(implementationMarkdown(result,{theme:themeFilter}),
    '종언성서_'+(themeFilter==='전체'?'전체':themeFilter)+'_효과구현구조_대조_V0.7.md');
});
$('audit-filter').addEventListener('change', (event) => { filter = event.target.value; render(); });
$('audit-export').addEventListener('click', () => {
  if (!result?.cards?.length) return;
  const blob = new Blob([auditMarkdown(result)], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = dom('a');
  link.href = url;
  link.download = '종언성서_원문_CDB_Lua_심층검수_V0.5.md';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});
$('fix-export').addEventListener('click', () => {
  if (!result?.cards?.some((c) => c.issues.length)) return;
  const report = fixPlanMarkdown(result);
  const url = URL.createObjectURL(new Blob([report], { type: 'text/markdown;charset=utf-8' }));
  const link = dom('a');
  link.href = url;
  link.download = '종언성서_카드별_수정검토안_V0.5.2.md';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});
render();
