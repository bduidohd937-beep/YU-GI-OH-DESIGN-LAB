import { parseDocuments } from './parser.js';
import { scanLuaFile } from './lua-inspector.js';
import { getAssetCoverage, classifyCdbCard, classifyLuaFile } from './theme-classifier.js';
import { inspectEffectImplementation, implementationIssues } from './effect-implementation.js';
import { resolveLuaRevision } from './package-versions.js';

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
    // 원문 백업의 구분선은 효과 문구가 아닙니다.
    if (/^\s*(?:={5,}|-{5,})\s*$/.test(line)) continue;
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

export function buildAudit({ textFiles = [], cdbCards = [], luaFiles = [], loadingWarnings = [] } = {}) {
  const parsed = parseDocuments(textFiles);
  const warnings = [...loadingWarnings, ...parsed.warnings];
  const sourceCards = parsed.documents.flatMap((doc) => doc.cards);
  const themeCoverage = getAssetCoverage(parsed.documents, cdbCards, luaFiles);
  // CDB만 올린 경우에도 Lua 누락·설명 문자열·공용 스크립트를 검사할 수 있습니다.
  // 단, 원문 대조를 통과한 것으로 판정하지 않습니다.
  const records = sourceCards.length ? sourceCards :
    cdbCards.length ? [...new Map(cdbCards.map((c) => [String(c.id), c])).values()].map((c) => ({
      key: 'cdb:' + c.id, name: c.name, theme: classifyCdbCard(c).theme || '미분류', id: String(c.id),
      fileName: '원문 미제공', description: ''
    })) : [...new Map(luaFiles.filter((f) => /^c\d{6,10}\.lua$/i.test(f.name.split('/').pop()))
      .map((f) => [f.name.split('/').pop().match(/^c(\d+)\.lua$/i)[1], f])).entries()]
      .map(([id, file]) => ({ key: 'lua:' + id, name: 'Lua 카드 ' + id,
        theme: classifyLuaFile(file).theme || '미분류', id, fileName: '원문 미제공', description: '' }));
  const cdbById = groupBy(cdbCards, (c) => String(c.id));
  const cdbByName = groupBy(cdbCards, (c) => normalizeCardName(c.name));
  const luaById = groupBy(luaFiles.filter((f) => /^c\d{6,10}\.lua$/i.test(f.name.split('/').pop())),
    (f) => f.name.split('/').pop().match(/^c(\d+)\.lua$/i)[1]);
  const hasCdb = cdbCards.length > 0;
  const hasLua = luaFiles.some((f) => /^c\d+\.lua$/i.test(f.name.split('/').pop()));
  const rows = [];
  const usedCdb = new Set();
  const usedLua = new Set();

  for (const source of records) {
    const problems = [];
    if (!sourceCards.length) {
      problems.push(issue('info', 'SOURCE_NOT_IMPORTED', '설계 원문 미제공',
        'CDB↔Lua 검사만 가능합니다. 효과 원문 일치 여부는 확인하지 않았습니다.'));
    }
    const explicitCandidates = source.id ? cdbById.get(String(source.id)) || [] : [];
    const nameCandidates = cdbByName.get(normalizeCardName(source.name)) || [];
    const candidates = explicitCandidates.length ? explicitCandidates : nameCandidates;
    const unique = [...new Map(candidates.map((c) => [c.origin + '#' + c.id, c])).values()];
    const matchingNames = candidates.filter((c) => normalizeCardName(c.name) === normalizeCardName(source.name));

    if (!source.id) {
      problems.push(issue('info', 'SOURCE_ID_UNSPECIFIED', '원문에 카드 ID가 없음',
        unique.length ? 'CDB 이름을 기준으로 임시 연결했습니다. 같은 이름의 카드가 여럿이면 수동 확인이 필요합니다.' : '원문에 ID가 없고 연결된 CDB도 없습니다. ID 매칭 여부는 아직 확인하지 않았습니다.'));
    }

    const scoped = themeCoverage.themes[source.theme];
    if (!unique.length && hasCdb && scoped?.hasCdb) {
      problems.push(issue('error', 'NO_CDB_CARD', '해당 테마 CDB에서 카드 매칭 실패',
        '이 테마에 속한 CDB는 등록되어 있으나 이름·ID로 연결하지 못했습니다. 등록된 CDB가 전체 패키지인지 먼저 확인하세요.'));
    } else if (!unique.length && hasCdb && scoped && !scoped.hasCdb) {
      problems.push(issue('info', 'CDB_THEME_NOT_IMPORTED', '이 테마의 CDB 미등록',
        '다른 테마의 CDB는 있지만 ' + source.theme + ' CDB는 확인되지 않았습니다. 카드 오류가 아닙니다.'));
    } else if (!unique.length && !hasCdb) {
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
      if (sourceCards.length) {
        const mismatch = verifyText(source.description, selected.desc);
        if (mismatch) problems.push(mismatch);
      }
    }

    const effectiveId = String(source.id || selected?.id || '');
    const luaEntries = luaById.get(effectiveId) || [];
    const revision = resolveLuaRevision(luaEntries);
    const script = revision.script;
    if (script) {
      usedLua.add(effectiveId);
      if (revision.patchApplied) {
        problems.push(issue('info', 'LUA_PATCH_OVERLAY', '버전이 명시된 Lua 긴급 패치 적용',
          revision.label + ' 패치를 검사 기준으로 사용했습니다. 패치 전 파일도 입력되어 있으나 정상적인 버전 갱신 후보입니다. 설치 여부는 별도 확인해야 합니다.'));
      } else if (revision.conflict) {
        problems.push(issue('warning', 'LUA_VERSION_CONFLICT', '동일 카드의 서로 다른 Lua 버전이 존재',
          '명시적인 상위 버전 패치로 확인되지 않은 서로 다른 Lua입니다. 마지막 입력 파일을 임시 기준으로 선택했습니다.'));
      }
      problems.push(...scanLuaFile(script, {
        card: selected, availableLuaNames: luaFiles.map((file) => file.name)
      }));
    } else if (hasLua && scoped && !scoped.hasLua && (!selected || requiresLua(selected.type))) {
      problems.push(issue('info', 'LUA_THEME_NOT_IMPORTED', '이 테마의 Lua 미등록',
        '다른 테마의 Lua는 있지만 ' + source.theme + ' Lua는 확인되지 않았습니다.'));
    } else if (selected && requiresLua(selected.type) && scoped?.hasLua) {
      problems.push(issue('error', 'NO_CARD_SCRIPT', '해당 테마 카드 Lua 파일 누락 의심',
        '필요한 파일: c' + effectiveId + '.lua. 현재 입력한 Lua 묶음이 완전한 버전인지 확인하세요.'));
    } else if ((!selected || !effectiveId) && scoped?.hasLua) {
      problems.push(issue('info', 'CARD_ID_UNRESOLVED', 'Lua 카드 ID 연결 보류',
        '해당 테마의 Lua가 등록되어 있지만 이 원문 카드에 연결할 ID를 찾지 못했습니다.'));
    } else if ((!selected || (selected && requiresLua(selected.type))) && !hasLua) {
      problems.push(issue('info', 'LUA_NOT_IMPORTED', 'Lua 미제공',
        '정적 Lua 검사를 하려면 script 폴더 또는 Lua가 포함된 패키지를 추가로 불러오세요.'));
    }

    // 구조 비교는 원문 효과와 Lua 등록 흔적의 관계를 확정하지 않습니다.
    const effectImplementation = inspectEffectImplementation({
      sourceEffects: getNumberedEffects(source.description),
      cdbEffects: getNumberedEffects(selected?.desc || ''),
      script
    });
    problems.push(...implementationIssues(effectImplementation));

    rows.push({
      key: source.key, name: source.name, theme: source.theme, id: effectiveId || null,
      source: source.fileName, cdb: selected?.origin || null, lua: script?.origin || null,
      // 런타임 로그의 줄번호와 같은 버전 Lua를 근거로 5줄 내외의 코드 맥락을 볼 수 있게 합니다.
      // 실제 엔진 설치본과의 버전 일치는 실전 기록에서 별도로 확인합니다.
      luaSource: script?.text?.slice(0,250000) || null,
      cdbType: selected?.type ?? null, sourceVersion: source.version || null,
      effectImplementation,
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
    documents: parsed.documents, skippedDocuments: parsed.skippedDocuments || [], cards: rows,
    counts: { ...summary, source: sourceCards.length, cdb: new Set(cdbCards.map((c) => String(c.id))).size,
      lua: new Set(luaFiles.filter((f) => /^c\d+\.lua$/i.test(f.name.split('/').pop())).map((f) => f.name.split('/').pop())).size },
    warnings, coverage: { hasSource: !!sourceCards.length, hasCdb, hasLua, byTheme: themeCoverage.themes,
      unknownCdbCount: themeCoverage.unknownCdb.length, unknownLuaCount: themeCoverage.unknownLua.length },
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
    '# YU-GI-OH DESIGN LAB — V0.5 원문·CDB·Lua 심층 정적 보고서',
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
    for (const i of card.issues) {
      const location = i.line ? ' (' + (i.file || card.lua || 'Lua') + ':' + i.line + ')' : '';
      const confidence = i.confidence === 'static' ? ' / 정적 코드 패턴 확인' :
        i.confidence === 'review' ? ' / 동작 검토 필요' : '';
      out.push('- [' + i.severity + '/' + i.code + confidence + '] ' + i.title + location + ': ' + i.detail);
      if (i.snippet) out.push('  - 증거: `' + i.snippet.replace(/`/g, '') + '`');
    }
    out.push('');
  }
  out.push('---', result.note, '');
  return out.join('\n');
}
