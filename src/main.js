import { parseDocuments, THEMES } from './parser.js';
import { classifyCard, summarize, makeReport } from './rules.js';
import { splitCardEffects } from './effects.js';
import { createReader } from './reader.js';

const state = { documents: [], warnings: [], theme: '전체', search: '', keyword: '', selected: null };
let lastRenderedCardKey = null;
const $ = (id) => document.getElementById(id);
const byId = {
  input: $('file-input'), drop: $('dropzone'), message: $('message'), tabs: $('theme-tabs'),
  list: $('card-list'), detail: $('card-detail'), notes: $('document-notes'),
  search: $('search'), keyword: $('keyword-filter'), count: $('result-count'),
  export: $('export-report')
};
const MAX_ZIP = 12 * 1024 * 1024;
const MAX_TEXT = 2 * 1024 * 1024;
const MAX_ENTRIES = 100;

function el(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}

function setMessage(message, type = '') {
  byId.message.textContent = message;
  byId.message.className = 'message' + (type ? ' ' + type : '');
}

async function readImports(fileList) {
  const texts = [];
  const warnings = [];
  for (const file of Array.from(fileList)) {
    try {
      if (/\.txt$/i.test(file.name)) {
        if (file.size > MAX_TEXT) throw new Error('TXT 크기 제한(2MB) 초과');
        texts.push({ name: file.name, text: await file.text() });
      } else if (/\.zip$/i.test(file.name)) {
        if (file.size > MAX_ZIP) throw new Error('ZIP 크기 제한(12MB) 초과');
        if (!globalThis.JSZip) throw new Error('ZIP 해제 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하거나 TXT를 직접 선택하세요.');
        const zip = await globalThis.JSZip.loadAsync(file, { checkCRC32: true });
        const entries = Object.values(zip.files).filter((item) => !item.dir);
        if (entries.length > MAX_ENTRIES) throw new Error('압축 항목 100개 초과');
        for (const entry of entries) {
          if (!/\.txt$/i.test(entry.name)) continue;
          const path = entry.name.replace(/\\/g, '/');
          if (path.startsWith('/') || path.split('/').includes('..')) {
            warnings.push('안전하지 않은 ZIP 경로 건너뜀: ' + entry.name);
            continue;
          }
          // JSZip does not offer a public streaming size limit. Check metadata before expanding.
          if (entry._data && entry._data.uncompressedSize > MAX_TEXT) {
            warnings.push('압축 해제 크기 2MB 초과: ' + entry.name);
            continue;
          }
          const text = await entry.async('string');
          if (text.length > MAX_TEXT) {
            warnings.push('추출된 텍스트 2MB 초과: ' + entry.name);
            continue;
          }
          texts.push({ name: entry.name.split('/').pop(), text });
        }
      } else {
        warnings.push('지원하지 않는 파일: ' + file.name);
      }
    } catch (error) {
      warnings.push(file.name + ' — ' + error.message);
    }
  }
  return { texts, warnings };
}

async function loadFiles(files) {
  if (!files || !files.length) return;
  byId.input.disabled = true;
  setMessage('원문 파일을 분석하고 있습니다...');
  try {
    const result = await readImports(files);
    const parsed = parseDocuments(result.texts);
    state.documents = parsed.documents;
    state.warnings = [...result.warnings, ...parsed.warnings];
    state.theme = '전체';
    state.search = '';
    state.keyword = '';
    state.selected = null;
    byId.search.value = '';
    rebuildKeywordFilter();
    renderNotes();
    render();
    const count = summarize(state.documents).cardCount;
    setMessage(
      count ? (state.documents.length + '개 테마, 카드 ' + count + '종을 읽었습니다.' +
        (state.warnings.length ? ' 확인할 메시지 ' + state.warnings.length + '건.' : ''))
        : '읽을 수 있는 테마 원문이 없습니다. ZIP 안의 TXT 구조를 확인해 주세요.' +
        (state.warnings.length ? ' ' + state.warnings.join(' / ') : ''),
      count ? 'success' : 'error'
    );
  } catch (error) {
    setMessage('파일 처리 실패: ' + error.message, 'error');
  } finally {
    byId.input.disabled = false;
    byId.input.value = '';
  }
}

function allCards() { return state.documents.flatMap((doc) => doc.cards); }

function filteredCards() {
  const query = state.search.trim().toLocaleLowerCase('ko');
  return allCards().filter((card) => (
    (state.theme === '전체' || card.theme === state.theme) &&
    (!query || [card.name, card.description, card.id || ''].join(' ').toLocaleLowerCase('ko').includes(query)) &&
    (!state.keyword || classifyCard(card).keywords.includes(state.keyword))
  ));
}

function rebuildKeywordFilter() {
  const current = state.keyword;
  byId.keyword.replaceChildren();
  const blank = el('option', '', '모든 키워드');
  blank.value = '';
  byId.keyword.append(blank);
  const counts = summarize(state.documents).keywords;
  for (const item of counts) {
    const option = el('option', '', item.name + ' (' + item.count + ')');
    option.value = item.name;
    byId.keyword.append(option);
  }
  byId.keyword.value = current;
}

function renderTabs() {
  byId.tabs.replaceChildren();
  const counts = new Map(THEMES.map((name) => [name, 0]));
  for (const doc of state.documents) counts.set(doc.theme, doc.cards.length);
  const choices = [{ name: '전체', count: allCards().length }, ...THEMES.map((name) => ({ name, count: counts.get(name) }))];
  for (const choice of choices) {
    const button = el('button', 'theme-button');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(state.theme === choice.name));
    button.append(el('span', '', choice.name), el('span', 'count', String(choice.count)));
    button.addEventListener('click', () => { state.theme = choice.name; render(); });
    byId.tabs.append(button);
  }
}

function renderList(cards) {
  byId.list.replaceChildren();
  if (!cards.length) {
    byId.list.append(el('div', 'empty-list', state.documents.length ? '검색 결과가 없습니다.' : '원문을 불러오면 카드 목록이 여기에 나타납니다.'));
    return;
  }
  for (const card of cards) {
    const button = el('button', 'card-entry' + (state.selected === card.key ? ' active' : ''));
    button.type = 'button';
    button.setAttribute('aria-label', card.name + ' 원문 열람');
    button.append(el('div', 'card-entry-title', card.name));
    const meta = el('div', 'card-entry-meta');
    meta.append(el('span', '', card.theme + ' · ' + card.version));
    if (card.id) meta.append(el('span', '', '#' + card.id));
    for (const tag of classifyCard(card).keywords.slice(0, 2)) meta.append(el('span', 'mini-chip', tag));
    button.append(meta);
    button.addEventListener('click', () => { state.selected = card.key; render(); });
    byId.list.append(button);
  }
}

function renderDetail(card) {
  byId.detail.replaceChildren();
  if (!card) {
    const blank = el('div', 'empty-detail');
    blank.append(el('div', 'detail-symbol', '✧'), el('h3', '', '카드를 선택하세요'),
      el('p', '', '원문, 카드 ID, 자동 분류 및 추가 확인 사항을 표시합니다.'));
    byId.detail.append(blank);
    return;
  }
  const result = classifyCard(card);
  byId.detail.append(el('div', 'detail-kicker', card.theme + ' / ' + card.version));
  byId.detail.append(el('h3', 'detail-name', card.name));
  const readButton = el('button', 'detail-reader-button', '⤢ 이 카드 원문 크게 보기');
  readButton.type = 'button';
  readButton.addEventListener('click', () => reader.open());
  byId.detail.append(readButton);
  const meta = el('div', 'detail-meta');
  meta.append(el('span', '', card.id ? 'CARD ID ' + card.id : 'ID 원문 미기재'));
  meta.append(el('span', '', '출처 ' + card.fileName));
  byId.detail.append(meta);
  byId.detail.append(el('div', 'detail-kicker', 'CARD TEXT · SOURCE'));
  const effectParts = splitCardEffects(card.description);
  if (!effectParts.blocks.length) {
    byId.detail.append(el('div', 'effect-text', card.description));
  } else {
    if (effectParts.prefix) byId.detail.append(el('div', 'detail-prefix', effectParts.prefix));
    const stack = el('div', 'detail-effect-stack');
    const bar = el('div', 'effect-toolbar');
    bar.append(el('div', 'detail-section', '카드 효과 · 선택해서 펼치기'));
    const expand = el('button', 'effect-expand-all', '모두 접기');
    expand.type = 'button';
    bar.append(expand);
    byId.detail.append(bar);
    const disclosures = [];
    for (const part of effectParts.blocks) {
      const section = el('details', 'effect-disclosure');
      section.open = true;
      const heading = el('summary', '', part.section + ' ' + part.label);
      const content = el('pre', '', part.text);
      section.append(heading, content);
      disclosures.push(section);
      stack.append(section);
    }
    expand.addEventListener('click', () => {
      const opening = disclosures.some((item) => !item.open);
      for (const item of disclosures) item.open = opening;
      expand.textContent = opening ? '모두 접기' : '모두 펼치기';
    });
    byId.detail.append(stack);
  }
  byId.detail.append(el('div', 'detail-section', '키워드 기반 분류 · 효과 성능 판정 아님'));
  const tags = el('div', 'tag-list');
  if (!result.keywords.length) tags.append(el('span', 'tag', '분류 없음'));
  for (const tag of result.keywords) tags.append(el('span', 'tag', tag));
  byId.detail.append(tags);
  if (result.notices.length) {
    byId.detail.append(el('div', 'detail-section', '추가 확인 필요'));
    for (const notice of result.notices) byId.detail.append(el('div', 'notice', '[' + notice.type + '] ' + notice.message));
  }
}

function renderNotes() {
  byId.notes.replaceChildren();
  if (!state.documents.length && !state.warnings.length) {
    byId.notes.textContent = '파일을 불러오면 원문 메모가 표시됩니다.';
    return;
  }
  for (const doc of state.documents) {
    const item = el('details', 'note-card');
    const heading = el('summary', '', doc.theme + ' — ' + doc.version);
    const pre = el('pre', '', doc.notes || '별도 변경 및 검증 메모 없음');
    item.append(heading, pre);
    byId.notes.append(item);
  }
  if (state.warnings.length) {
    const item = el('details', 'note-card');
    item.open = true;
    item.append(el('summary', '', '가져오기 경고 (' + state.warnings.length + ')'),
      el('pre', '', state.warnings.join('\n')));
    byId.notes.append(item);
  }
}

function render() {
  const summary = summarize(state.documents);
  $('view-library').classList.toggle('has-library-data', summary.cardCount > 0);
  $('stat-themes').replaceChildren(document.createTextNode(String(summary.themeCount) + ' '));
  $('stat-themes').append(el('small', '', '/ 5'));
  $('stat-cards').textContent = String(summary.cardCount);
  $('stat-keywords').textContent = String(summary.keywords.length);
  renderTabs();
  const cards = filteredCards();
  const scrollTop = byId.list.scrollTop;
  if (!cards.some((card) => card.key === state.selected)) state.selected = cards[0]?.key || null;
  byId.count.textContent = cards.length + '종';
  renderList(cards);
  byId.list.scrollTop = scrollTop;
  const activeCard = cards.find((card) => card.key === state.selected);
  renderDetail(activeCard);
  const key = activeCard?.key || null;
  if (key !== lastRenderedCardKey) byId.detail.scrollTop = 0;
  lastRenderedCardKey = key;
  byId.export.disabled = !summary.cardCount;
  reader.sync();
}

const reader = createReader({
  getCards: filteredCards,
  getActiveKey: () => state.selected,
  onSelect: (key) => { state.selected = key; render(); }
});

byId.input.addEventListener('change', (event) => loadFiles(event.target.files));
byId.drop.addEventListener('click', () => byId.input.click());
byId.drop.addEventListener('dragover', (event) => { event.preventDefault(); byId.drop.classList.add('dragover'); });
byId.drop.addEventListener('dragleave', () => byId.drop.classList.remove('dragover'));
byId.drop.addEventListener('drop', (event) => { event.preventDefault(); byId.drop.classList.remove('dragover'); loadFiles(event.dataTransfer.files); });
byId.drop.addEventListener('keydown', (event) => {
  if (event.target === byId.drop && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); byId.input.click(); }
});
byId.search.addEventListener('input', (event) => { state.search = event.target.value; render(); });
byId.keyword.addEventListener('change', (event) => { state.keyword = event.target.value; render(); });
byId.export.addEventListener('click', () => {
  if (!state.documents.length) return;
  const report = makeReport(state.documents, state.warnings);
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([report], { type: 'text/markdown;charset=utf-8' }));
  link.href = url;
  link.download = '종언성서_원문기초진단_V0.1.md';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});
render();
