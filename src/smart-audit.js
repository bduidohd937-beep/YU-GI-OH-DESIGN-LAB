// V0.6 — 업로드된 자료 범위의 테마별 요약 및 수동 EDOPro 재현 체크리스트.
// 오류 후보/구현율/실전 통과를 같은 의미로 취급하지 않습니다.
import { THEMES } from './parser.js';

const NOT_UPLOADED = new Set([
  'CDB_NOT_IMPORTED','LUA_NOT_IMPORTED','CDB_THEME_NOT_IMPORTED','LUA_THEME_NOT_IMPORTED',
  'SOURCE_NOT_IMPORTED','SOURCE_ID_UNSPECIFIED','SOURCE_EFFECT_UNSTRUCTURED',
  'CARD_ID_UNRESOLVED'
]);

export function buildThemeDashboard(result) {
  const rows = result?.cards || [];
  const coverage = result?.coverage?.byTheme || {};
  const themes = THEMES.map((theme) => {
    const cards = rows.filter((row) => row.theme === theme);
    const assets = coverage[theme] || {hasSource:false,hasCdb:false,hasLua:false,sourceCards:0,cdbCards:0,cardLua:0};
    const withCdb = cards.filter((row) => !!row.cdb).length;
    const withLua = cards.filter((row) => !!row.lua).length;
    const codeCandidates = cards.reduce((count,row) => count+row.issues.filter((x) => 
      !NOT_UPLOADED.has(x.code) && (x.severity === 'error' || x.severity === 'warning')).length,0);
    const pending = cards.filter((row) => !row.cdb || (!row.lua && row.cdbType !== 0x11)).length;
    const ready = cards.filter((row) => !!row.cdb && !!row.lua).length;
    const status = !assets.hasSource && !assets.hasCdb && !assets.hasLua ? '자료 없음' :
      assets.hasSource && !assets.hasCdb && !assets.hasLua ? '원문만 등록' :
      !assets.hasSource ? '원문 미등록' :
      !assets.hasCdb ? 'CDB 대조 대기' :
      !assets.hasLua ? 'Lua 검수 대기' : '정적 검수 가능';
    return {theme, source:assets.sourceCards || 0, cdb:assets.cdbCards || 0,
      lua:assets.cardLua || 0, listed:cards.length, withCdb, withLua, ready,
      pending, codeCandidates, status, runtime:'실전 미검증'};
  });
  const totals = themes.reduce((o,t)=>({
    listed:o.listed+t.listed, source:o.source+t.source, cdb:o.cdb+t.cdb,
    lua:o.lua+t.lua, ready:o.ready+t.ready, candidates:o.candidates+t.codeCandidates
  }),{listed:0,source:0,cdb:0,lua:0,ready:0,candidates:0});
  return { themes, totals,
    unknownCdb: result?.coverage?.unknownCdbCount || 0,
    unknownLua: result?.coverage?.unknownLuaCount || 0,
    note:'자료 연결과 정적 코드 규칙만 확인했습니다. EDOPro 듀얼 성공·효과 완성도·덱 강도를 평가하지 않았습니다.'};
}

function classifyMechanics(type) {
  if (!Number.isFinite(Number(type))) return null;
  const value = Number(type) >>> 0;
  const includes = (flag) => (value & flag) !== 0;
  if (includes(0x4000000)) return {label:'링크 소환 조건', steps:'링크 소재·링크 마커·엑스트라 몬스터 존 조건을 구성하고 소환 후보에 나타나는지 확인'};
  if (includes(0x800000)) return {label:'엑시즈 소환 조건', steps:'레벨/랭크와 엑시즈 소재 수 조건을 갖춘 뒤 소환 및 소재 제거 확인'};
  if (includes(0x2000)) return {label:'싱크로 소환 조건', steps:'튜너·비튜너 및 레벨 합계 조건을 갖춘 뒤 싱크로 소환 후보 확인'};
  if (includes(0x40)) return {label:'융합 소환 조건', steps:'명시된 융합 소재와 소환 수단을 준비하고 융합 소환 후보 및 소재 처리 확인'};
  if (includes(0x80)) return {label:'의식 소환 조건', steps:'의식 몬스터·의식 마법·릴리스 조건을 갖춘 뒤 소환 결과 확인'};
  if (includes(0x1000000)) return {label:'펜듈럼 존·펜듈럼 소환', steps:'스케일·펜듈럼 존 발동, 펜듈럼 소환 가능 레벨, 파괴 시 이동 위치 확인'};
  if (includes(0x80000)) return {label:'필드 마법 발동', steps:'필드 존에서 발동한 뒤 선택지 문구와 필드 효과 처리 확인'};
  if (includes(0x2)) return {label:'마법 카드 발동', steps:'발동 조건, 효과 처리, 발동 후 카드 위치 확인'};
  if (includes(0x4)) return {label:'함정 카드 발동', steps:'세트 후 발동 타이밍, 체인 처리, 발동 후 카드 위치 확인'};
  return {label:'소환·발동 기본 확인', steps:'카드에 명시된 소환 조건이나 발동 조건을 갖춘 뒤 결과를 확인'};
}

const DIAGNOSTIC_CASES = Object.freeze({
  OPTIONAL_TRIGGER_TIMING: ['유발 효과 타이밍','일반 특수 소환과 다른 효과 처리 도중 특수 소환을 각각 수행해 발동 창 표시 비교'],
  DESCRIPTION_MISSING: ['선택지 문자열','효과의 선택지를 열어 ??? 표시가 없는지 확인'],
  LEGACY_LINK_HELPER: ['링크 소재 API','서로 다른 링크 소재 조합에서 합법적인 링크 소환 후보가 표시되는지 확인'],
  XYZ_99_SENTINEL: ['엑시즈 소재 API','요구 소재 수의 최소·초과 상황에서 엑시즈 소환 후보가 올바르게 표시되는지 확인'],
  REASON_BITMASK_COMPARE: ['소재 사유 판정','소재로 묘지에 보내진 후 사유 조건을 만족하는 효과가 발동하는지 확인'],
  ATTACK_API_COMPAT: ['공격력 API','해당 효과를 실행한 뒤 Lua nil 메서드 오류 없이 올바른 공격력 수치가 계산되는지 확인'],
  SHARED_SCRIPT_NOT_IMPORTED: ['공용 Lua 로딩','공용 스크립트를 설치한 환경에서 카드 초기화 오류가 발생하지 않는지 확인'],
  NO_INITIAL_EFFECT: ['초기화 함수','EDOPro에서 카드를 불러올 때 initial_effect 관련 오류가 없는지 확인'],
  NO_DIRECT_EFFECT_REGISTRATION: ['효과 등록 방식 확인','원문의 번호 효과를 각각 재현하고 공용 함수 또는 다른 등록 경로에서 정상 처리되는지 확인'],
  EFFECT_REGISTRATION_COUNT_REVIEW: ['번호 효과별 개별 재현','원문 ①②③ 효과를 각각 발동·적용하여 조건·1턴 1번 제한·실제 처리 결과를 개별 확인']
});

export function buildManualTestPlan(result, {theme = '전체'} = {}) {
  const all = result?.cards || [];
  const matched = all.filter((card) => (theme === '전체' || card.theme === theme) && card.id && card.cdb && card.lua);
  const cases = [];
  for (const card of matched) {
    const mechanics = classifyMechanics(card.cdbType);
    const base = {
      theme:card.theme, id:card.id, name:card.name, lua:card.lua, cdb:card.cdb,
      status:'미실행', source:'정적 패턴 및 CDB 타입'
    };
    if (mechanics) cases.push({...base, key:card.key+':base', title:mechanics.label,
      steps:mechanics.steps, expected:'카드 원문과 CDB 효과에 명시된 결과와 일치해야 함'});
    // 문장별 효과 재현: 원문 ①②③과 펜듈럼 효과 ①은 별도 체크.
    // 텍스트는 기대 결과의 근거이며 Lua 변수와 직접 대응하지 않습니다.
    const numbered = card.effectImplementation?.source?.length
      ? card.effectImplementation.source : (card.effectImplementation?.cdb || []);
    for (const [index, effect] of numbered.entries()) {
      const name = effect.section + ' ' + effect.label;
      cases.push({
        ...base, key:card.key+':effect:'+effect.section+':'+effect.label+':'+index,
        title:name+' 효과 재현',
        steps:'이 카드의 '+name+' 효과 발동 조건을 구성한 다음 발동 여부, 처리 결과, 1턴 1번 제한을 각각 확인',
        expected:effect.text, source:'등록된 원문/CDB 효과 문구 · Lua 의미 대응 미검증'
      });
    }
    for (const diagnostic of [...new Set(card.issues.map((x) => x.code))]) {
      const spec = DIAGNOSTIC_CASES[diagnostic];
      if (spec) cases.push({...base, key:card.key+':'+diagnostic, title:spec[0],
        steps:spec[1], expected:'의도한 효과 처리 및 Lua 런타임 오류 없음', source:diagnostic});
    }
  }
  return {cases, theme, inputCards:all.filter((card)=>theme==='전체'||card.theme===theme).length,
    eligibleCards:matched.length, excludedCards:all.filter((card)=>theme==='전체'||card.theme===theme).length-matched.length,
    note:'실전 테스트 체크리스트 자동 생성 결과입니다. 테스트는 실행하지 않았으며 모든 항목의 상태는 미실행입니다.'};
}
export function manualTestMarkdown(plan) {
  const lines = ['# DESIGN LAB V0.6 — EDOPro 수동 실전 테스트 목록', '',
    '대상 테마: '+plan.theme,'연결된 원문/CDB/Lua 카드: '+plan.eligibleCards+'종',
    '테스트 대상 제외(자료 부족): '+plan.excludedCards+'종',
    '테스트 시나리오: '+plan.cases.length+'건 · 전부 미실행', '',
    '> 테스트 생성만 했습니다. 실제 엔진에서 실행하거나 통과 처리하지 않았습니다.', ''];
  if (!plan.cases.length) lines.push('현재 실행 가능한 카드별 테스트 목록이 없습니다. 해당 테마의 CDB와 Lua 파일을 등록하세요.', '');
  for (const [i,c] of plan.cases.entries()) {
    lines.push('## '+(i+1)+'. '+c.theme+' / '+c.name+' ['+c.id+']', '',
      '- [ ] **'+c.title+'** (미실행)',
      '- 준비·실행: '+c.steps,
      '- 기대 결과: '+c.expected,
      '- 근거: '+c.source,
      '- 기록: 결과(통과/실패/보류), EDOPro 로그, 사용한 파일 버전과 스크린샷을 직접 기재', '');
  }
  lines.push('---',plan.note,'');
  return lines.join('\n');
}

export function themeAuditMarkdown(dashboard) {
  const lines=['# DESIGN LAB V0.6 — 테마별 검수 현황', '',
    '> 자료 범위 및 정적 오류 후보입니다. 구현 완료율 또는 실전 승률이 아닙니다.', '',
    '| 테마 | 원문 | CDB | 카드 Lua | 카드 연결(CDB/Lua) | 정적 문제 후보 | 검수 상태 |',
    '|---|---:|---:|---:|---:|---:|---|'];
  for (const t of dashboard.themes)
    lines.push('| '+t.theme+' | '+t.source+' | '+t.cdb+' | '+t.lua+
      ' | '+t.withCdb+'/'+t.withLua+' | '+t.codeCandidates+' | '+t.status+' |');
  lines.push('', '미분류 CDB 카드: '+dashboard.unknownCdb+'종 / 미분류 Lua 파일: '+dashboard.unknownLua+'개', '',
    dashboard.note, '');
  return lines.join('\n');
}
