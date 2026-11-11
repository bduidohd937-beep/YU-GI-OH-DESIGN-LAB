// V0.5.2: 전체 화면으로 근거·수정안을 읽는 검수 UI. 읽기 전용이며 파일은 변경하지 않습니다.
import { buildCardPlan, cardPlanMarkdown } from './fix-planner.js';

const $ = (id) => document.getElementById(id);
const INFO_ONLY = new Set(['CDB_NOT_IMPORTED','LUA_NOT_IMPORTED','SOURCE_ID_UNSPECIFIED','SOURCE_NOT_IMPORTED','SOURCE_EFFECT_UNSTRUCTURED']);
const element = (tag, className = '', value) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
};
const actionSteps = (card) => buildCardPlan(card).steps.filter((step) => step.priority < 3);
const cardStatus = (card) => actionSteps(card).some((step) => step.priority === 1) ? '즉시 확인' :
  actionSteps(card).length ? '수정 검토' : '원문 / 미검증';

function infoRow(label, value) {
  const row = element('div', 'audit-reader-meta-row');
  row.append(element('strong','',label), element('span','',value || '미등록'));
  return row;
}
function labelledText(label, value) {
  const row = element('p','audit-reader-step-line');
  row.append(element('strong','',label + ' · '), document.createTextNode(value || '표시할 내용 없음'));
  return row;
}
function emptyCoverage(result) {
  return !result?.coverage?.hasCdb && !result?.coverage?.hasLua;
}

export function createAuditReader({ getResult, getSelectedKey, onSelect }) {
  const overlay = $('audit-reader-overlay');
  const list = $('audit-reader-list');
  const content = $('audit-reader-content');
  const queryInput = $('audit-reader-search');
  const filterInput = $('audit-reader-filter');
  const openButton = $('audit-reader-open');
  const closeButton = $('audit-reader-close');
  if (![overlay,list,content,queryInput,filterInput,openButton,closeButton].every(Boolean))
    throw new Error('검수 집중 읽기 UI 일부를 찾을 수 없습니다.');

  let opened = false, fontSize = 18, query = '', viewFilter = 'all';
  let activeKey = null, lastResult = null, returnFocus = null;
  content.style.setProperty('--audit-reader-size', fontSize + 'px');

  function visibleCards() {
    const result = getResult();
    const cards = result?.cards || [];
    return cards.filter((card) =>
      (viewFilter === 'all' || actionSteps(card).length > 0) &&
      (!query || (card.name + ' ' + (card.id || '')).toLocaleLowerCase('ko').includes(query))
    );
  }
  function renderCard(card, result) {
    const wrap = element('div', 'audit-reader-document');
    const small = element('div','audit-reader-category', card.theme + ' / ' + cardStatus(card));
    const title = element('h1','audit-reader-title',card.name);
    title.id = 'audit-reader-title';
    wrap.append(small, title);

    const meta = element('div','audit-reader-meta');
    meta.append(
      infoRow('카드 ID',card.id || '원문 ID 미기재'),
      infoRow('원문',card.source),
      infoRow('CDB',card.cdb),
      infoRow('Lua',card.lua)
    );
    wrap.append(meta);

    const steps = actionSteps(card);
    const missingCdb = !result.coverage?.hasCdb;
    const missingLua = !result.coverage?.hasLua;

    if (missingCdb || missingLua) {
      const banner = element('section','audit-reader-coverage');
      const h = element('h2','', '검사에 필요한 자료가 부족합니다');
      const info = missingCdb && missingLua
        ? '현재 카드 원문만 등록되어 있습니다. CDB·Lua 기반 오류 검사는 아직 시작되지 않았습니다.'
        : missingCdb ? 'CDB가 연결되지 않았습니다. 원문·CDB 대조는 아직 수행할 수 없습니다.'
        : 'Lua가 연결되지 않았습니다. Lua 효과 구현 검사는 아직 수행할 수 없습니다.';
      banner.append(h,element('p','',info),element('p','audit-reader-coverage-help','상단의 저장 자료 → 파일 추가로 해당 테마의 최신 .cdb 및 Lua 시험 패키지를 등록하세요. 자료가 없는 것은 카드 오류가 아닙니다.'));
      wrap.append(banner);
    }

    if (steps.length) {
      wrap.append(element('h2','audit-reader-section-title','수정 검토 · ' + steps.length + '건'));
      const group = element('div','audit-reader-steps');
      for (const [i,step] of steps.entries()) {
        const block = element('section','audit-reader-step audit-reader-priority-' + step.priority);
        block.append(element('div','audit-reader-step-eyebrow',step.priorityLabel + ' / ' + step.group + ' / ' + step.code));
        block.append(element('h3','', (i+1) + '. ' + step.problem));
        block.append(labelledText('발견 사항',step.detail));
        block.append(labelledText('수정 방향',step.suggestedAction));
        block.append(labelledText('검증 방법',step.verify));
        block.append(element('div','audit-reader-evidence-level','판정: ' + step.basis));
        for (const evidence of step.evidence) {
          block.append(element('div','audit-reader-location',evidence.file + ':' + evidence.line));
          if (evidence.snippet) block.append(element('pre','audit-reader-code',evidence.snippet));
        }
        group.append(block);
      }
      wrap.append(group);
    } else {
      const clear = element('section','audit-reader-no-finding');
      clear.append(
        element('h2','',emptyCoverage(result)?'아직 코드 검사를 시작하지 않았습니다':'즉시 수정할 문제 후보가 표시되지 않았습니다'),
        element('p','',emptyCoverage(result)
          ? '이 화면에서 보이는 카드별 자료 미제공 안내는 실제 구현 오류가 아닙니다. 원문을 읽거나 CDB·Lua를 추가해 검사하세요.'
          : '현재 입력 자료로 발견한 정적 수정 후보가 없습니다. 실제 EDOPro 정상 작동을 보증하지는 않습니다.')
      );
      wrap.append(clear);
    }

    const other = (card.issues || []).filter((issue) => issue.severity === 'info' || INFO_ONLY.has(issue.code));
    if (other.length && !emptyCoverage(result)) {
      const details = element('details','audit-reader-secondary');
      details.append(element('summary','', '자료 범위·참고 사항 ' + other.length + '건'));
      const ul = element('ul');
      for (const issue of other) ul.append(element('li','',issue.title));
      details.append(ul);wrap.append(details);
    }

    if (card.description || card.cdbDescription) {
      const compare = element('details','audit-reader-compare');
      compare.open = !steps.length && !card.cdbDescription;
      compare.append(element('summary','',card.cdbDescription ? '승인 원문과 CDB 문구 대조' : '등록된 카드 원문 보기'));
      if (card.description) compare.append(element('h3','', '설계 원문'), element('div','audit-reader-card-text',card.description));
      if (card.cdbDescription) compare.append(element('h3','', 'CDB 문구'), element('div','audit-reader-card-text',card.cdbDescription));
      wrap.append(compare);
    }

    wrap.append(element('p','audit-reader-note','이 화면은 정적 코드 검토를 돕는 읽기 전용 화면입니다. 엔진 실행·성능 검증은 별도입니다.'));
    content.replaceChildren(wrap);
  }

  function sync() {
    const result = getResult();
    openButton.disabled = !result?.cards?.length;
    if (!opened) return;
    if (!result?.cards?.length) {
      content.replaceChildren(element('div','audit-reader-empty','검수 자료를 등록해 주세요.'));
      list.replaceChildren();
      $('audit-reader-position').textContent = '0 / 0';
      return;
    }
    if (lastResult !== result) {
      const relevant = result.cards.some((card) => actionSteps(card).length);
      viewFilter = relevant ? 'action' : 'all';
      filterInput.value = viewFilter;
      lastResult = result;
    }
    const rows = visibleCards();
    const requestedKey = getSelectedKey();
    const selected = rows.find((card) => card.key === requestedKey) || rows[0] || null;
    const index = rows.indexOf(selected);
    $('audit-reader-position').textContent = selected ? (index+1) + ' / ' + rows.length : '0 / 0';
    $('audit-reader-count').textContent = rows.length + '종';
    $('audit-reader-prev').disabled = index <= 0;
    $('audit-reader-next').disabled = index < 0 || index === rows.length - 1;
    $('audit-reader-copy').disabled = !selected;

    const previousScroll = list.scrollTop;
    list.replaceChildren();
    let prevTheme = null;
    for (const card of rows) {
      if (card.theme !== prevTheme) {
        list.append(element('div','audit-reader-theme-heading',card.theme));
        prevTheme = card.theme;
      }
      const btn = element('button','audit-reader-item' + (card.key === selected?.key ? ' selected':''),card.name);
      btn.type = 'button';
      if (card.key === selected?.key) btn.setAttribute('aria-current','true');
      btn.append(element('small','',cardStatus(card)));
      btn.addEventListener('click', () => { onSelect(card.key); sync(); });
      list.append(btn);
    }
    list.scrollTop = previousScroll;

    if (!selected) {
      activeKey = null;
      content.replaceChildren(element('div','audit-reader-empty','조건에 맞는 카드가 없습니다. 필터를 전체 카드로 바꿔 보세요.'));
      return;
    }
    if (activeKey !== selected.key) content.scrollTop = 0;
    activeKey = selected.key;
    renderCard(selected,result);
  }
  function shift(delta) {
    const rows = visibleCards();
    const index = rows.findIndex((card) => card.key === (getSelectedKey() || activeKey));
    const candidate = rows[index + delta];
    if (candidate) { onSelect(candidate.key); sync(); }
  }
  function open() {
    if (!getResult()?.cards?.length) return;
    returnFocus = document.activeElement;
    opened = true;
    lastResult = null;
    overlay.hidden = false;
    document.body.classList.add('audit-reader-is-open');
    sync();
    closeButton.focus();
  }
  function close() {
    if (!opened) return;
    opened = false;
    overlay.hidden = true;
    document.body.classList.remove('audit-reader-is-open');
    returnFocus?.focus?.();
  }
  openButton.addEventListener('click',open);
  closeButton.addEventListener('click',close);
  $('audit-reader-prev').addEventListener('click',()=>shift(-1));
  $('audit-reader-next').addEventListener('click',()=>shift(1));
  queryInput.addEventListener('input',(e)=>{query=e.target.value.toLocaleLowerCase('ko').trim();sync();});
  filterInput.addEventListener('change',(e)=>{viewFilter=e.target.value;activeKey=null;sync();});
  $('audit-reader-font-down').addEventListener('click',()=>{
    fontSize = Math.max(14,fontSize-2);content.style.setProperty('--audit-reader-size',fontSize+'px');
  });
  $('audit-reader-font-up').addEventListener('click',()=>{
    fontSize = Math.min(26,fontSize+2);content.style.setProperty('--audit-reader-size',fontSize+'px');
  });
  $('audit-reader-copy').addEventListener('click', async()=>{
    const card = visibleCards().find((entry)=>entry.key===getSelectedKey()) || visibleCards()[0];
    if (!card) return;
    try {
      await navigator.clipboard.writeText(cardPlanMarkdown(buildCardPlan(card)));
      $('audit-reader-copy').textContent = '복사 완료 ✓';
    } catch {
      $('audit-reader-copy').textContent = '복사 실패';
    }
  });
  document.addEventListener('keydown',(event)=>{
    if (!opened) return;
    if (event.key==='Escape'){event.preventDefault();close();return;}
    const editing = event.target instanceof HTMLElement && !!event.target.closest('input,textarea,select,[contenteditable]');
    if (editing) return;
    if (event.key==='ArrowLeft'||event.key==='ArrowRight'){
      event.preventDefault();shift(event.key==='ArrowLeft'?-1:1);return;
    }
    if (event.key==='Tab'){
      const focusables=[...overlay.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled])')]
        .filter((e)=>e.getClientRects().length>0);
      if (!focusables.length) return;
      const first=focusables[0],last=focusables[focusables.length-1];
      if (event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if (!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
  return {sync,open,close};
}
