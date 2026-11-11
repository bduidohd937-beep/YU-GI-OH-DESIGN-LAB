import { splitCardEffects } from './effects.js';

const $ = (id) => document.getElementById(id);

function node(tag, className = '', value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = value;
  return element;
}

export function createReader({ getCards, getActiveKey, onSelect }) {
  const overlay = $('reader-overlay');
  const list = $('reader-list');
  const article = $('reader-content');
  const search = $('reader-search');
  const openButton = $('reader-open');
  const closeButton = $('reader-close');
  if (!overlay || !list || !article || !search || !openButton || !closeButton) {
    throw new Error('원문 집중 읽기 UI를 찾지 못했습니다.');
  }

  let expanded = false;
  let query = '';
  let fontSize = 18;
  let lastKey = null;
  let previousFocus = null;
  article.style.setProperty('--reading-font-size', fontSize + 'px');

  function visibleCards() {
    return getCards();
  }

  function activeCard(cards) {
    return cards.find((card) => card.key === getActiveKey()) || cards[0] || null;
  }

  function sync() {
    const cards = visibleCards();
    openButton.disabled = !cards.length;
    if (!expanded) return;
    const active = activeCard(cards);
    const currentKey = active?.key || null;
    const index = cards.findIndex((card) => card.key === currentKey);
    $('reader-position').textContent = active ? (index + 1) + ' / ' + cards.length : '0 / 0';
    $('reader-prev').disabled = index <= 0;
    $('reader-next').disabled = index < 0 || index >= cards.length - 1;
    $('reader-copy').disabled = !active;
    const oldScroll = list.scrollTop;
    list.replaceChildren();

    const q = query.trim().toLocaleLowerCase('ko');
    const matching = cards.filter((card) => !q || card.name.toLocaleLowerCase('ko').includes(q));
    $('reader-list-count').textContent = matching.length + '종';
    if (!matching.length) list.append(node('div', 'reader-no-result', '검색 결과가 없습니다.'));
    for (const card of matching) {
      const button = node('button', 'reader-card' + (card.key === currentKey ? ' selected' : ''));
      button.type = 'button';
      if (card.key === currentKey) button.setAttribute('aria-current', 'true');
      button.append(node('span', 'reader-card-name', card.name), node('span', 'reader-card-theme', card.theme + ' · ' + card.version));
      button.addEventListener('click', () => select(card));
      list.append(button);
    }
    list.scrollTop = oldScroll;

    if (lastKey === currentKey) return;
    lastKey = currentKey;
    article.replaceChildren();
    article.scrollTop = 0;
    if (!active) {
      article.append(node('div', 'reader-empty', '카드를 선택해 주세요.'));
      return;
    }

    const wrapper = node('div', 'reader-document');
    const header = node('div', 'reader-document-head');
    header.append(node('span', 'reader-theme', active.theme + ' · ' + active.version));
    const title = node('h1', 'reader-card-title', active.name);
    title.id = 'reader-title';
    header.append(title);
    const meta = node('div', 'reader-meta');
    meta.append(node('span', '', active.id ? 'CARD ID ' + active.id : '원문에 카드 ID 미기재'));
    meta.append(node('span', '', '출처: ' + active.fileName));
    header.append(meta);
    wrapper.append(header);

    const parts = splitCardEffects(active.description);
    if (!parts.blocks.length) {
      wrapper.append(node('div', 'reader-prose', active.description));
    } else {
      if (parts.prefix) wrapper.append(node('div', 'reader-intro', parts.prefix));
      const effects = node('div', 'reader-effects');
      for (const effect of parts.blocks) {
        const section = node('section', 'reader-effect');
        section.append(node('h2', '', effect.section + ' ' + effect.label));
        section.append(node('div', 'reader-prose', effect.text));
        effects.append(section);
      }
      wrapper.append(effects);
    }
    wrapper.append(node('p', 'reader-source-note', '표시된 문구는 업로드한 원문 그대로입니다. 게임 엔진 작동을 검증한 결과가 아닙니다.'));
    article.append(wrapper);
  }

  function select(card) {
    if (!card || card.key === getActiveKey()) return;
    onSelect(card.key);
    sync();
  }

  function shift(delta) {
    const cards = visibleCards();
    const index = cards.findIndex((card) => card.key === getActiveKey());
    const next = cards[index + delta];
    if (next) select(next);
  }

  function open() {
    if (!visibleCards().length) return;
    previousFocus = document.activeElement;
    expanded = true;
    lastKey = null;
    overlay.hidden = false;
    document.body.classList.add('reader-is-open');
    sync();
    closeButton.focus();
  }

  function close() {
    if (!expanded) return;
    expanded = false;
    overlay.hidden = true;
    document.body.classList.remove('reader-is-open');
    previousFocus?.focus?.();
  }

  openButton.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  $('reader-prev').addEventListener('click', () => shift(-1));
  $('reader-next').addEventListener('click', () => shift(1));
  search.addEventListener('input', (event) => {
    query = event.target.value;
    sync();
  });
  $('reader-font-down').addEventListener('click', () => {
    fontSize = Math.max(14, fontSize - 2);
    article.style.setProperty('--reading-font-size', fontSize + 'px');
  });
  $('reader-font-up').addEventListener('click', () => {
    fontSize = Math.min(26, fontSize + 2);
    article.style.setProperty('--reading-font-size', fontSize + 'px');
  });
  $('reader-copy').addEventListener('click', async () => {
    const card = activeCard(visibleCards());
    if (!card) return;
    try {
      await navigator.clipboard.writeText(card.name + '\n\n' + card.description);
      $('reader-copy').textContent = '복사 완료 ✓';
      $('reader-copy').setAttribute('aria-label', '원문 복사 완료');
    } catch {
      $('reader-copy').textContent = '복사 실패';
    }
  });
  // 키보드 이동과 닫기는 집중 읽기 모드에서만 동작합니다.
  document.addEventListener('keydown', (event) => {
    if (!expanded) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    const isTyping = event.target instanceof HTMLElement && !!event.target.closest('input,textarea,[contenteditable]');
    if (isTyping) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      shift(event.key === 'ArrowLeft' ? -1 : 1);
    }
    if (event.key === 'Tab') {
      const focusables = [...overlay.querySelectorAll('button:not([disabled]),input:not([disabled])')].filter((element) => element.getClientRects().length > 0);
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    }
  });
  return { open, close, sync };
}
