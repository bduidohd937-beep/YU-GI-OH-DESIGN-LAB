// V0.7 — 원문/CDB의 번호 효과와 Lua 효과 등록 흔적을 정적으로 대조합니다.
// 효과 번호 ↔ Lua 변수의 의미 매핑, 실제 EDOPro 효과 성공 여부는 추론하지 않습니다.
import { stripLuaComments, lineAt } from './lua-inspector.js';

function maskStringLiterals(text) {
  const source = String(text);
  let out = '', i = 0;
  const blank = (slice) => slice.replace(/[^\n]/g, ' ');
  while (i < source.length) {
    const first = source[i];
    if (first === "'" || first === '"') {
      const start = i, quote = first;
      i++;
      while (i < source.length) {
        if (source[i] === '\\') { i += Math.min(2, source.length - i); continue; }
        if (source[i++] === quote) break;
      }
      out += blank(source.slice(start, i));
      continue;
    }
    const long = source.slice(i).match(/^\[(=*)\[/);
    if (long) {
      const start = i;
      const ending = ']' + '='.repeat(long[1].length) + ']';
      const pos = source.indexOf(ending, i + long[0].length);
      i = pos < 0 ? source.length : pos + ending.length;
      out += blank(source.slice(start, i));
      continue;
    }
    out += first;
    i++;
  }
  return out;
}

const NUMBERED_LIMIT = 100;
const REGISTER_RE = /\b(?:[a-zA-Z_]\w*)\s*:\s*RegisterEffect\s*\(\s*([a-zA-Z_]\w*)\b/g;
const SETTER_RE = /\b([a-zA-Z_]\w*)\s*:\s*(SetType|SetCode|SetOperation|SetCondition|SetTarget|SetProperty)\s*\(/g;
const HELPER_RE = /\b(?:Fusion|Synchro|Xyz|Link|Pendulum|Ritual|aux)\s*\.\s*(?:AddProcedure|AddProc\w*|AddLinkProcedure|EnablePendulumAttribute|RegisterEffect)\s*\(/g;

export function scanEffectRegistrations(script) {
  if (!script || typeof script.text !== 'string') {
    return { registrations: [], helpers: [], scriptAvailable: false, file: null };
  }
  const original = String(script.text).replace(/\r\n?/g, '\n');
  const normalized = maskStringLiterals(stripLuaComments(original));
  const file = script.origin || script.name || 'Lua';
  const lines = original.split('\n');
  const setters = new Map();
  for (const match of normalized.matchAll(SETTER_RE)) {
    const variable = match[1];
    if (!setters.has(variable)) setters.set(variable, new Set());
    setters.get(variable).add(match[2]);
  }
  const registrations = [];
  for (const match of normalized.matchAll(REGISTER_RE)) {
    const line = lineAt(normalized, match.index);
    registrations.push({
      variable: match[1], file, line,
      snippet: (lines[line - 1] || '').trim().slice(0, 200),
      methods: [...(setters.get(match[1]) || [])].sort()
    });
  }
  const helpers = [];
  for (const match of normalized.matchAll(HELPER_RE)) {
    const line = lineAt(normalized, match.index);
    helpers.push({
      line, file, snippet: (lines[line - 1] || '').trim().slice(0, 200)
    });
  }
  return { registrations, helpers, scriptAvailable: true, file };
}

export function inspectEffectImplementation({
  sourceEffects = [], cdbEffects = [], script = null
} = {}) {
  const source = sourceEffects.slice(0, NUMBERED_LIMIT).map((effect, index) => ({
    index: index + 1, section: effect.section, label: effect.label, text: effect.text
  }));
  const cdb = cdbEffects.slice(0, NUMBERED_LIMIT).map((effect, index) => ({
    index: index + 1, section: effect.section, label: effect.label, text: effect.text
  }));
  const lua = scanEffectRegistrations(script);
  const expected = source.length ? source : cdb;
  const textBasis = source.length ? '원문' : cdb.length ? 'CDB' : '번호 효과 없음';
  let state, message;
  if (!lua.scriptAvailable) {
    state = 'lua_unavailable';
    message = 'Lua 파일이 연결되지 않아 효과 구현 구조를 비교하지 않았습니다.';
  } else if (!expected.length) {
    state = 'no_numbered_text';
    message = '원문/CDB에서 ①②③ 번호 효과를 찾지 못했습니다. Lua 등록 흔적만 표시합니다.';
  } else if (!lua.registrations.length && lua.helpers.length) {
    state = 'helper_review';
    message = '직접 등록 호출은 없지만 소환·효과 보조 함수가 있습니다. 구현 누락을 단정할 수 없습니다.';
  } else if (!lua.registrations.length) {
    state = 'no_direct_registration';
    message = 'Lua에서 카드 효과 직접 등록 흔적을 찾지 못했습니다. 공용 함수·특수 구현 여부를 검토하세요.';
  } else if (expected.length > lua.registrations.length) {
    state = 'count_review';
    message = '번호 효과 수가 직접 등록 호출 수보다 많습니다. 1개 효과가 여러 처리를 구현하거나 보조 함수를 사용할 수 있으므로 누락 확정은 아닙니다.';
  } else {
    state = 'evidence_found';
    message = 'Lua 효과 등록 흔적을 확인했습니다. 번호 효과와 등록 함수의 의미적 대응 및 실제 작동은 미검증입니다.';
  }
  return {
    state, message, textBasis, source, cdb,
    registrations: lua.registrations, helpers: lua.helpers,
    scriptAvailable: lua.scriptAvailable, file: lua.file,
    expectedCount: expected.length, registrationCount: lua.registrations.length,
    notes: '원문 ① ↔ Lua e1 같은 자동 대응은 하지 않습니다. 호출 개수의 일치도 효과 구현·룰 적법성·실전 성공을 증명하지 않습니다.'
  };
}

export function implementationIssues(coverage) {
  if (!coverage?.scriptAvailable || !coverage.expectedCount) return [];
  if (coverage.state === 'no_direct_registration') return [{
    severity: 'warning', confidence: 'review', code: 'NO_DIRECT_EFFECT_REGISTRATION',
    title: '번호 효과 대비 Lua 직접 등록 흔적 없음',
    detail: coverage.message + ' Lua 전체 또는 공용 함수 구현을 확인해야 합니다.'
  }];
  if (coverage.state === 'count_review') return [{
    severity: 'info', confidence: 'review', code: 'EFFECT_REGISTRATION_COUNT_REVIEW',
    title: '번호 효과와 Lua 직접 등록 호출 수 차이',
    detail: coverage.textBasis + ' 번호 효과 ' + coverage.expectedCount +
      '개 / Lua 등록 호출 ' + coverage.registrationCount + '건. ' + coverage.message
  }];
  return [];
}

export function implementationMarkdown(result, { theme = '전체' } = {}) {
  const cards = (result?.cards || []).filter((card) => theme === '전체' || card.theme === theme);
  const inspected = cards.filter((card) => card.effectImplementation?.scriptAvailable);
  const flagged = inspected.filter((card) =>
    ['count_review', 'no_direct_registration', 'helper_review'].includes(card.effectImplementation.state));
  const out = [
    '# DESIGN LAB V0.7 — 효과 구현 구조 대조 보고서', '',
    '테마: ' + theme,
    '카드: ' + cards.length + '종 / Lua 연결: ' + inspected.length + '종 / 구조 검토 대상: ' + flagged.length + '종', '',
    '> 이 보고서는 Lua 코드의 효과 등록 흔적만 확인합니다. 원문 효과와 Lua 효과가 실제로 동일하다는 증거가 아닙니다.', ''
  ];
  if (!inspected.length) out.push('Lua가 연결된 카드가 없습니다. 해당 테마 CDB·Lua 파일을 등록하세요.', '');
  for (const card of inspected) {
    const data = card.effectImplementation;
    out.push('## ' + card.theme + ' / ' + card.name + (card.id ? ' (' + card.id + ')' : ''), '',
      '- 판정: ' + data.message,
      '- 문구 근거: ' + data.textBasis,
      '- 원문 효과: ' + data.source.length + '개 / CDB 효과: ' + data.cdb.length +
      '개 / Lua 직접 등록: ' + data.registrationCount + '건 / 보조 호출: ' + data.helpers.length + '건', '');
    for (const effect of (data.source.length ? data.source : data.cdb)) {
      out.push('### ' + effect.section + ' ' + effect.label + ' — 대응 Lua 미확정',
        effect.text, '');
    }
    for (const reg of data.registrations) {
      out.push('- Lua 등록 위치: ' + reg.file + ':' + reg.line +
        ' (' + reg.variable + ', ' + (reg.methods.length ? reg.methods.join(', ') : '구조 미확인') + ')');
      if (reg.snippet) out.push('  - 코드: ' + reg.snippet.replace(/[\r\n]/g, ' '));
    }
    out.push('', data.notes, '');
  }
  return out.join('\n');
}
