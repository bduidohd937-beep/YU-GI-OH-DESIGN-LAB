// V0.5 — Lua 코드를 실행하지 않고 함수 패턴과 줄번호를 정적 분석합니다.
// 일반 주석과 긴 주석을 제거하되 원문 줄바꿈은 보존합니다.
export function stripLuaComments(source = '') {
  const s = String(source);
  let out = '', i = 0, quote = '', longString = null;
  while (i < s.length) {
    const c = s[i], next = s[i + 1];
    if (quote) {
      out += c;
      if (c === '\\' && i + 1 < s.length) out += s[++i];
      else if (c === quote) quote = '';
      i++; continue;
    }
    if (longString !== null) {
      const end = ']' + '='.repeat(longString) + ']';
      if (s.startsWith(end, i)) { out += end; i += end.length; longString = null; continue; }
      out += c; i++; continue;
    }
    if (c === "'" || c === '"') { quote = c; out += c; i++; continue; }
    const longOpen = s.slice(i).match(/^\[(=*)\[/);
    if (longOpen) { longString = longOpen[1].length; out += longOpen[0]; i += longOpen[0].length; continue; }
    if (c === '-' && next === '-') {
      const block = s.slice(i + 2).match(/^\[(=*)\[/);
      if (block) {
        const stop = ']' + '='.repeat(block[1].length) + ']';
        const found = s.indexOf(stop, i + 2 + block[0].length);
        const end = found < 0 ? s.length : found + stop.length;
        out += s.slice(i, end).replace(/[^\n]/g, ' ');
        i = end; continue;
      }
      const found = s.indexOf('\n', i);
      const end = found < 0 ? s.length : found;
      out += ' '.repeat(end - i); i = end; continue;
    }
    out += c; i++;
  }
  return out;
}
export function lineAt(text, index) {
  return text.slice(0, Math.max(0, index)).split('\n').length;
}
function finding(script, source, index, severity, confidence, code, title, detail) {
  const line = lineAt(source, index);
  const snippet = String(script.text).split(/\r?\n/)[line - 1]?.trim().slice(0, 220) || '';
  return { severity, confidence, code, title, detail, file: script.origin || script.name, line, snippet };
}
function eachMatch(source, expression, onMatch) {
  const re = new RegExp(expression.source, expression.flags.includes('g') ? expression.flags : expression.flags + 'g');
  for (const m of source.matchAll(re)) onMatch(m);
}
function callArguments(source, offset) {
  const start = source.indexOf('(', offset);
  if (start < 0) return null;
  let depth = 0, quote = '', parts = [], current = '';
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      current += c;
      if (c === '\\' && i + 1 < source.length) current += source[++i];
      else if (c === quote) quote = '';
      continue;
    }
    if (c === "'" || c === '"') { quote = c; current += c; continue; }
    if (c === '(') { depth++; if (depth > 1) current += c; continue; }
    if (c === ')') {
      depth--;
      if (depth === 0) { parts.push(current.trim()); return parts; }
      current += c; continue;
    }
    if (depth === 1 && c === ',') { parts.push(current.trim()); current = ''; continue; }
    current += c;
  }
  return null;
}
function inheritsDelay(source, variable, offset) {
  const before = source.slice(Math.max(0, offset - 1600), offset + 180);
  const own = new RegExp('\\b' + variable + ':SetProperty\\s*\\([^)]*EFFECT_FLAG_DELAY', 's');
  if (own.test(before)) return true;
  const clone = before.match(new RegExp('\\b(?:local\\s+)?' + variable + '\\s*=\\s*(\\w+):Clone\\s*\\(\\s*\\)'));
  return !!(clone && new RegExp('\\b' + clone[1] + ':SetProperty\\s*\\([^)]*EFFECT_FLAG_DELAY', 's').test(before));
}

export function scanLuaFile(script, { card = null, availableLuaNames = [] } = {}) {
  const source = stripLuaComments(script.text);
  const results = [];
  const add = (offset, severity, confidence, code, title, detail) =>
    results.push(finding(script, source, offset, severity, confidence, code, title, detail));

  if (/^c\d{6,10}\.lua$/i.test(script.name.split('/').pop()) &&
    !/\bfunction\s+[\w.]+\.initial_effect\s*\(/.test(source)) {
    add(0, 'error', 'static', 'NO_INITIAL_EFFECT', '카드 초기화 함수가 보이지 않음',
      '이 카드 Lua에서 initial_effect 정의를 찾지 못했습니다. 특수한 등록 방식을 사용했는지 확인하세요.');
  }
  eachMatch(source, /\baux\.AddLinkProcedure\s*\(/g, m =>
    add(m.index, 'warning', 'static', 'LEGACY_LINK_HELPER', '구형 링크 소환 헬퍼 사용',
      '현재 Project Ignis의 Link.AddProcedure와 비교하고 사용 엔진에서 지원하는지 확인하세요.'));
  eachMatch(source, /\bXyz\.AddProcedure\s*\(/g, m => {
    const args = callArguments(source, m.index + m[0].length - 1);
    if (args?.some((x, i) => i >= 3 && x === '99'))
      add(m.index, 'warning', 'static', 'XYZ_99_SENTINEL', '엑시즈 소재 수 인수 99',
        '구형 무한 소재 지정 방식일 수 있습니다. Xyz.InfiniteMats 지원 여부를 확인하세요.');
  });
  eachMatch(source, /(?:\:|\.)GetOriginalAttack\s*\(/g, m =>
    add(m.index, 'warning', 'review', 'ATTACK_API_COMPAT', '원래 공격력 API 호환성 확인',
      '해당 메서드의 현재 엔진 지원 여부를 확인하세요. 실제 nil 메서드 오류가 발생할 수 있습니다.'));
  eachMatch(source, /\b(\w+):SetCode\s*\(\s*EVENT_SPSUMMON_SUCCESS\s*\)/g, m => {
    const before = source.slice(Math.max(0, m.index - 1300), m.index + 200);
    if (!/\bEFFECT_TYPE_TRIGGER_O\b/.test(before) || inheritsDelay(source, m[1], m.index)) return;
    add(m.index, 'warning', 'review', 'OPTIONAL_TRIGGER_TIMING', '특수 소환 선택 유발 효과 타이밍 검토',
      '선택 유발 효과의 EFFECT_FLAG_DELAY가 확인되지 않습니다. 효과 처리 중 다른 행동이 이어지면 발동 타이밍을 놓칠 수 있습니다. Clone/공용 헬퍼도 확인하세요.');
  });
  eachMatch(source, /\br\s*(?:==|~=)\s*REASON_(?:LINK|XYZ|SYNCHRO|FUSION)\b/g, m =>
    add(m.index, 'warning', 'review', 'REASON_BITMASK_COMPARE', '소환 소재 사유의 단순 비교',
      'r에 여러 REASON 플래그가 결합되면 단순 비교가 실패할 수 있습니다. 비트 연산 검사가 필요한지 확인하세요.'));
  eachMatch(source, /\baux\.Stringid\s*\(\s*id\s*,\s*(\d+)\s*\)/g, m => {
    if (!card || !Array.isArray(card.strings)) return;
    const index = Number(m[1]);
    if (index >= 0 && index < 16 && !String(card.strings[index] || '').trim())
      add(m.index, 'warning', 'static', 'DESCRIPTION_MISSING', 'CDB 선택지 설명 문자열 누락',
        'aux.Stringid(id,' + index + ') 사용 중 CDB str' + (index + 1) + '가 비어 있습니다. 게임에서 ???로 보일 수 있습니다.');
  });
  const names = new Set(availableLuaNames.map((x) => String(x).split('/').pop().toLowerCase()));
  eachMatch(source, /\bDuel\.LoadScript\s*\(\s*["']([^"']+\.lua)["']\s*\)/g, m => {
    const filename = m[1].split('/').pop();
    if (/(?:_common|_shared|common_|shared_)\.lua$/i.test(filename) && !names.has(filename.toLowerCase()))
      add(m.index, 'warning', 'review', 'SHARED_SCRIPT_NOT_IMPORTED', '참조한 공용 Lua가 입력 자료에 없음',
        filename + '이 입력 자료에 없습니다. 실제 EDOPro 설치 폴더에 존재한다면 정상일 수 있습니다.');
  });
  eachMatch(source, /\b\w+:SetRange\s*\(\s*0x10\s*\)/g, m => {
    if (source.includes('LOCATION_PZONE'))
      add(m.index, 'info', 'review', 'PENDULUM_RANGE_LITERAL', '펜듈럼 존의 위치 상수 점검',
        'SetRange(0x10)의 의도가 P존인지 확인하세요. 실제 엔진 상수값과 비교해야 합니다.');
  });
  return results.sort((a, b) => a.line - b.line || a.code.localeCompare(b.code));
}
