import { parseDocuments } from './parser.js';

export function normalizeCardName(value = '') {
  return String(value).normalize('NFKC')
    .replace(/[－—–−]/g, '-')
    .replace(/[「」『』《》“”"'`]/g, '')
    .replace(/[\s·・]/g, '')
    .toLocaleLowerCase('ko');
}

function normalizeEffect(value = '') {
  return String(value).normalize('NFKC')
    .replace(/[「」『』《》“”"']/g, '')
    .replace(/\s+/g, '')
    .replace(/[.,，。:：;；\/]/g, '');
}

export function getNumberedEffects(text = '') {
  const results = [];
  let section = '기본';
  let current = null;
  for (const line of String(text).replace(/\r/g, '').split('\n')) {
    if (line.includes('【펜듈럼 효과】')) { section = '펜듈럼'; current = null; continue; }
    if (line.includes('【몬스터 효과】')) { section = '몬스터'; current = null; continue; }
    const match = line.match(/^\s*([①②③④⑤⑥⑦⑧⑨⑩])\s*[:：]/);
    if (match) {
      current = { section, label: match[1], text: line.trim() };
      results.push(current);
      continue;
    }
    if (/^\s*(?:\[처리 기준\]|\[검수 메모\]|역할:)/.test(line)) current = null;
    if (current && line.trim()) current.text += '\n' + line.trim();
  }
  return results;
}

function issue(severity, code, title, detail = '') {
  return { severity, code, title, detail };
}

function countStatuses(rows) {
  return rows.reduce((o, r) => {
    for (const i of r.issues) o[i.severity] = (o[i.severity] || 0) + 1;
    return o;
  }, { error: 0, warning: 0, info: 0 });
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function textSignature(c) {
  return [c.name, c.desc, Number(c.type), ...(c.strings || [])].join('\u241f');
}

function verifyText(original, cdbText) {
  const source = getNumberedEffects(original);
  const target = getNumberedEffects(cdbText);
  if (!source.length) return issue('info', 'SOURCE_EFFECT_UNSTRUCTURED', '구조화 효과 비교 보류', '원문에서 ①: 형태의 효과를 찾지 못했습니다.');
  if (!target.length) return issue('warning', 'CDB_EFFECT_EMPTY', 'CDB 효과 항목 확인 필요', 'CDB 설명란에서 번호가 붙은 효과를 찾지 못했습니다.');
  if (source.length !== target.length) {
    return issue('warning', 'EFFECT_COUNT_MISMATCH', '원문·CDB 효과 항목 수 불일치',
      '원문 ' + source.length + '개 / CDB ' + target.length + '개. 양쪽의 효과 설명을 직접 비교하세요.');
  }
  for (let i = 0; i < source.length; i++) {
    const a = source[i];
    const b = target[i];
    if (a.section !== b.section || a.label !== b.label) {
      return issue('warning', 'EFFECT_ORDER_MISMATCH', '원문·CDB 효과 구분 불일치',
        '순번 ' + (i + 1) + '의 효과 번호 또는 펜듈럼/몬스터 구분이 다릅니다.');
    }
  }
  const changed = source.map((e, i) => ({ a: e, b: target[i], index: i }))
    .filter(({ a, b }) => normalizeEffect(a.text) !== normalizeEffect(b.text));
  if (changed.length) {
    const examples = changed.slice(0, 3).map(({ a, index }) => a.section + ' ' + a.label + ' (' + (index + 1) + '번째)').join(', ');
    return issue('warning', 'EFFECT_TEXT_DIFFERENCE', '원문·CDB 효과 문구 차이',
      changed.length + '개 항목이 정확히 일치하지 않습니다: ' + examples + '. 단순 표기 차이일 수 있으므로 자동 오류 확정은 하지 않습니다.');
  }
  return null;
}

function hasRelevantSharedScript(name) {
  return /(?:_common|_shared|common_|shared_)\.lua$/i.test(name);
}

function checkLua(script, card) {
  const warnings = [];
  if (!/function\s+\w+\.initial_effect\s*\(/.test(script.text)) {
    warnings.push(issue('warning', 'NO_INITIAL_EFFECT', '초기 효과 등록 함수 확인 필요',
      'Lua에 initial_effect 함수 정의가 보이지 않습니다.'));
  }
  if (/\baux\.AddLinkProcedure\s*\(/.test(script.text)) {
    warnings.push(issue('warning', 'LEGACY_LINK_HELPER', '구형 링크 소환 헬퍼 사용 가능성',
      'aux.AddLinkProcedure 호출을 발견했습니다. 대상 EDOPro 버전의 Link.AddProcedure와 대조하세요.'));
  }
  if (/Xyz\.AddProcedure\s*\([^)]*,\s*99\s*\)/.test(script.text)) {
    warnings.push(issue('warning', 'XYZ_99_SENTINEL', '엑시즈 소재 99 매개변수 확인 필요',
      '구형 무한 소재 지정 방식이 남아 있을 수 있습니다.'));
  }
  if (/GetOriginalAttack\s*\(/.test(script.text)) {
    warnings.push(issue('warning', 'ATTACK_API_COMPAT', '원래 공격력 API 호환성 확인 필요',
      'GetOriginalAttack 호출을 발견했습니다. 실제 EDOPro 런타임 호환 여부를 점검하세요.'));
  }
  const descIndices = [...script.text.matchAll(/aux\.Stringid\s*\(\s*id\s*,\s*(\d+)\s*\)/g)]
    .map((m) => Number(m[1]));
  if (card) {
    const missing = [...new Set(descIndices)].filter((i) => i >= 0 && i < 16 && !String(card.strings?.[i] || '').trim());
    if (missing.length) warnings.push(issue('warning', 'DESCRIPTION_MISSING', '효과 선택지 설명 문자열 누락',
      'Lua에서 aux.Stringid(id, ' + missing.join('), aux.Stringid(id, ') + ')을 호출하지만 해당 CDB str 필드가 비어 있습니다. ??? 선택지의 원인일 수 있습니다.'));
  }
  if (/특수 소환(?:했을|되었을|에 성공했을)\s*경우/.test(card?.desc || '')
      && !/EVENT_SPSUMMON_SUCCESS/.test(script.text)
      && /EVENT_SUMMON_SUCCESS/.test(script.text)) {
    warnings.push(issue('info', 'SPSUMMON_REVIEW', '특수 소환 성공 트리거 확인 필요',
      '설명에는 특수 소환 시 효과가 있으나 Lua에서 EVENT_SPSUMMON_SUCCESS를 직접 찾지 못했습니다. 공용 헬퍼 사용 여부를 검토하세요.'));
  }
  return warnings;
}

export function buildAudit({ textFiles = [], cdbCards = [], luaFiles = [], loadingWarnings = [] } = {}) {
  const parsed = parseDocuments(textFiles);
  const warnings = [...loadingWarnings, ...parsed.warnings];
  const sourceCards = parsed.documents.flatMap((doc) => doc.cards);
  const cdbById = groupBy(cdbCards, (c) => String(c.id));
  const cdbByName = groupBy(cdbCards, (c) => normalizeCardName(c.name));
  const luaByName = groupBy(luaFiles, (f) => f.name.split('/').pop().toLowerCase());
  const luaById = groupBy(luaFiles.filter((f) => /^c\d{6,10}\.lua$/i.test(f.name.split('/').pop())),
    (f) => f.name.split('/').pop().match(/^c(\d+)\.lua$/i)[1]);
  const hasCdb = cdbCards.length > 0;
  const hasLua = luaFiles.some((f) => /^c\d+\.lua$/i.test(f.name.split('/').pop()));
  const rows = [];
  const usedCdb = new Set();
  const usedLua = new Set();

  for (const source of sourceCards) {
    const problems = [];
    const explicitCandidates = source.id ? cdbById.get(String(source.id)) || [] : [];
    const nameCandidates = cdbByName.get(normalizeCardName(source.name)) || [];
    const candidates = explicitCandidates.length ? explicitCandidates : nameCandidates;
    const unique = [...new Map(candidates.map((c) => [c.origin + '#' + c.id, c])).values()];
    const matchingNames = candidates.filter((c) => normalizeCardName(c.name) === normalizeCardName(source.name));

    if (!source.id) {
      problems.push(issue('info', 'SOURCE_ID_UNSPECIFIED', '원문에 카드 ID가 없음',
        'CDB 이름 일치로 연결했습니다. 같은 이름의 카드가 여럿이면 수동 확인이 필요합니다.'));
    }

    if (hasCdb && !unique.length) {
      problems.push(issue('error', 'NO_CDB_CARD', '원문에 해당하는 CDB 카드 없음',
        '원문 이름과 ID로 찾지 못했습니다. 입력한 CDB가 최신 패키지인지 확인하세요.'));
    }
    if (!hasCdb) {
      problems.push(issue('info', 'CDB_NOT_IMPORTED', 'CDB 미제공',
        '원문↔CDB 검사를 하려면 같은 테마의 .cdb를 추가로 불러오세요.'));
    }

    const selected = matchingNames[matchingNames.length - 1] || unique[unique.length - 1] || null;
    if (selected) {
      usedCdb.add(String(selected.id));
      if (source.id && String(source.id) !== String(selected.id)) {
        problems.push(issue('error', 'ID_MISMATCH', '원문과 CDB 카드 ID가 다름',
          '원문 ' + source.id + ' / CDB ' + selected.id));
      }
      if (normalizeCardName(source.name) !== normalizeCardName(selected.name)) {
        problems.push(issue('warning', 'NAME_MISMATCH', '원문과 CDB 카드명이 다름',
          '원문: ' + source.name + ' / CDB: ' + selected.name));
      }
      const signatures = new Set(unique.map(textSignature));
      if (signatures.size > 1) problems.push(issue('warning', 'CDB_VERSION_CONFLICT',
        '동일 카드 ID에 서로 다른 CDB 버전이 존재',
        '버전이 다른 CDB를 함께 불러왔을 수 있습니다. 어떤 버전을 기준으로 검사할지 확인하세요.'));
      const mismatch = verifyText(source.description, selected.desc);
      if (mismatch) problems.push(mismatch);
    }

    const effectiveId = String(source.id || selected?.id || '');
    const luaEntries = luaById.get(effectiveId) || [];
    const script = luaEntries[luaEntries.length - 1] || null;
    if (script) {
      usedLua.add(effectiveId);
      if (new Set(luaEntries.map((s) => s.text)).size > 1) {
        problems.push(issue('warning', 'LUA_VERSION_CONFLICT', '동일 카드의 서로 다른 Lua 버전이 존재',
          '같은 카드의 Lua가 여러 버전입니다. 마지막 파일이 임시 기준으로 선택됐습니다.'));
      }
      problems.push(...checkLua(script, selected));
      for (const m of script.text.matchAll(/Duel\.LoadScript\s*\(\s*["']([^"']+)["']\s*\)/g)) {
        const name = m[1].split('/').pop().toLowerCase();
        if (hasRelevantSharedScript(name) && !luaByName.has(name)) {
          problems.push(issue('warning', 'SHARED_SCRIPT_NOT_IMPORTED', '참조한 공용 Lua가 입력 파일에 없음',
            name + '을(를) 호출하지만 함께 업로드되지 않았습니다. EDOPro 설치 폴더에 이미 존재할 수 있습니다.'));
        }
      }
    } else if (hasLua && selected && requiresLua(selected.type)) {
      problems.push(issue('error', 'NO_CARD_SCRIPT', '카드 Lua 파일 없음',
        '필요한 파일: c' + effectiveId + '.lua'));
    } else if (!hasLua) {
      problems.push(issue('info', 'LUA_NOT_IMPORTED', 'Lua 미제공',
        '정적 Lua 검사를 하려면 script 폴더 또는 Lua가 포함된 패키지를 추가로 불러오세요.'));
    }

    rows.push({
      key: source.key, name: source.name, theme: source.theme, id: effectiveId || null,
      source: source.fileName, cdb: selected?.origin || null, lua: script?.origin || null,
      issues: problems, description: source.description, cdbDescription: selected?.desc || '',
      status: problems.some((p) => p.severity === 'error') ? 'error' :
        problems.some((p) => p.severity === 'warning') ? 'warning' : 'info'
    });
  }

  // Only when source documents exist; CDB-only scans are treated as limited coverage, not failure.
  if (sourceCards.length) {
    for (const c of cdbCards) {
      if (!usedCdb.has(String(c.id)) && !sourceCards.some((s) => normalizeCardName(s.name) === normalizeCardName(c.name))) {
        if (/토큰|기억을\s*잃은\s*자/.test(c.name)) continue;
        warnings.push(c.name + ' [' + c.id + '] — 원문 파일에서 찾지 못한 CDB 카드');
      }
    }
  }
  const summary = countStatuses(rows);
  return {
    documents: parsed.documents, cards: rows,
    counts: { ...summary, source: sourceCards.length, cdb: new Set(cdbCards.map((c) => String(c.id))).size,
      lua: new Set(luaFiles.filter((f) => /^c\d+\.lua$/i.test(f.name.split('/').pop())).map((f) => f.name.split('/').pop())).size },
    warnings, coverage: { hasSource: !!sourceCards.length, hasCdb, hasLua },
    note: '정적 비교 결과입니다. OCG 적법성·Lua 런타임·실제 효과 발동·덱 성능 검증을 의미하지 않습니다.'
  };
}

export function requiresLua(type) {
  const n = Number(type) >>> 0;
  const TYPE_MONSTER = 0x1, TYPE_NORMAL = 0x10, TYPE_TOKEN = 0x4000;
  const TYPE_RITUAL = 0x80, TYPE_FUSION = 0x40, TYPE_SYNCHRO = 0x2000;
  const TYPE_XYZ = 0x800000, TYPE_PENDULUM = 0x1000000, TYPE_LINK = 0x4000000;
  if (n & TYPE_TOKEN) return false;
  const isPlainNormal = (n & TYPE_MONSTER) && (n & TYPE_NORMAL) && !(n &
    (TYPE_RITUAL | TYPE_FUSION | TYPE_SYNCHRO | TYPE_XYZ | TYPE_PENDULUM | TYPE_LINK));
  return !isPlainNormal;
}

export function auditMarkdown(result) {
  const out = [
    '# YU-GI-OH DESIGN LAB — V0.2 원문·CDB·Lua 비교 보고서',
    '',
    '> 정적 점검 결과입니다. 실제 EDOPro 듀얼·OCG 재정·밸런스 검증 결과가 아닙니다.',
    '',
    '원문 카드: ' + result.counts.source + '종 / CDB 카드: ' + result.counts.cdb + '종 / 카드 Lua: ' + result.counts.lua + '개',
    '오류 후보: ' + result.counts.error + '건 / 검토 필요: ' + result.counts.warning + '건 / 정보: ' + result.counts.info + '건',
    ''
  ];
  if (result.warnings.length) out.push('## 가져오기·자료 범위 경고', ...result.warnings.map((x) => '- ' + x), '');
  for (const card of result.cards) {
    out.push('## ' + card.theme + ' / ' + card.name + (card.id ? ' (' + card.id + ')' : ''), '');
    out.push('- 원문: ' + card.source, '- CDB: ' + (card.cdb || '미확인'), '- Lua: ' + (card.lua || '미확인'));
    if (!card.issues.length) out.push('- 정적 검사에서 문제 후보 없음 (실전 검증 아님)');
    for (const i of card.issues) out.push('- [' + i.severity + '/' + i.code + '] ' + i.title + ': ' + i.detail);
    out.push('');
  }
  out.push('---', result.note, '');
  return out.join('\n');
}
