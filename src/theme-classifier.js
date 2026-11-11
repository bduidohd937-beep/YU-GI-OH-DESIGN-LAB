// V0.6 — 테마 분류와 입력 범위 판정. ID 접두부는 보조 단서일 뿐 카드군의 공식 정의가 아닙니다.
import { THEMES } from './parser.js';

export const THEME_ID_PREFIXES = Object.freeze({
  '990470': '천망성역',
  '990480': '파계잔영',
  '990490': '혈성',
  '990500': '영각시계'
});

export function themeFromName(name = '') {
  const value = String(name).normalize('NFKC').replace(/[－—–−]/g, '-').replace(/\s/g, '');
  return THEMES.find((theme) => value.includes(theme)) || null;
}

export function themeFromId(id) {
  const value = String(id ?? '');
  return /^\d{9}$/.test(value) ? THEME_ID_PREFIXES[value.slice(0, 6)] || null : null;
}

export function themeFromOrigin(origin = '') {
  const normalized = String(origin).normalize('NFKC').toLocaleLowerCase('ko');
  const named = THEMES.find((theme) => normalized.includes(theme));
  if (named) return named;
  // 오해를 줄이기 위해 영문 파일명은 확실한 경우만 단서로 사용.
  for (const [word, theme] of [
    ['cheon_', '천망성역'], ['pagye_', '파계잔영'], ['blood_', '혈성'],
    ['clock_', '영각시계'], ['grave_', '심연묘역']
  ]) if (normalized.includes(word)) return theme;
  return null;
}

export function classifyCdbCard(card) {
  const explicit = themeFromName(card.name);
  if (explicit) return { theme: explicit, reason: '카드명' };
  const idMatch = themeFromId(card.id);
  if (idMatch) return { theme: idMatch, reason: 'ID 접두부(보조)' };
  const fileMatch = themeFromOrigin(card.origin);
  if (fileMatch) return { theme: fileMatch, reason: '파일명(보조)' };
  return { theme: null, reason: '미분류' };
}

export function classifyLuaFile(file, cdbById = new Map()) {
  const basename = String(file.name).split(/[\\/]/).pop();
  const id = basename.match(/^c(\d{6,10})\.lua$/i)?.[1] || null;
  if (id && cdbById.has(id)) {
    const linked = classifyCdbCard(cdbById.get(id));
    if (linked.theme) return { theme: linked.theme, reason: 'CDB 카드 ID 연결', id };
  }
  if (id && themeFromId(id)) return { theme: themeFromId(id), reason: 'ID 접두부(보조)', id };
  const fromOrigin = themeFromOrigin(file.origin || file.name);
  return { theme: fromOrigin, reason: fromOrigin ? '파일명(보조)' : '미분류', id };
}

export function getAssetCoverage(documents = [], cdbCards = [], luaFiles = []) {
  const cdbById = new Map(cdbCards.map((card) => [String(card.id), card]));
  const sets = Object.fromEntries(THEMES.map((theme) => [theme, {
    theme, hasSource: false, hasCdb: false, hasLua: false,
    sourceCards: 0, cdbCards: 0, cardLua: 0
  }]));
  for (const doc of documents) if (sets[doc.theme]) {
    sets[doc.theme].hasSource = true;
    sets[doc.theme].sourceCards += doc.cards.length;
  }
  const unknownCdb = [];
  const unknownLua = [];
  const cdbIds = new Set(), luaIds = new Set();
  for (const card of cdbCards) {
    const {theme} = classifyCdbCard(card);
    if (!theme) { unknownCdb.push(card); continue; }
    sets[theme].hasCdb = true;
    const key = theme + ':' + card.id;
    if (!cdbIds.has(key)) { cdbIds.add(key); sets[theme].cdbCards++; }
  }
  for (const file of luaFiles) {
    const {theme,id} = classifyLuaFile(file, cdbById);
    if (!theme) { unknownLua.push(file); continue; }
    if (id) {
      sets[theme].hasLua = true;
      // V0.9.1 + V0.9.2 패치 파일은 하나의 카드 ID로 집계합니다.
      const key = theme + ':' + id;
      if (!luaIds.has(key)) { luaIds.add(key); sets[theme].cardLua++; }
    }
  }
  return { themes: sets, unknownCdb, unknownLua };
}
