// V0.5.1 — 검수 결과의 '수정 검토안' 생성. 정적 규칙 기반이며 Lua를 자동 수정하지 않습니다.
const DEFINITIONS = Object.freeze({
  NO_DIRECT_EFFECT_REGISTRATION: {
    level: 2, group: '효과 구조', action: 'Lua에 직접 RegisterEffect 호출이 없는 이유를 확인합니다. 공용 함수나 효과 보조 등록 방식이 있는지 먼저 조사하고, 근거 없이 효과를 추가하지 않습니다.',
    verify: '각 번호 효과에 필요한 상황을 EDOPro에서 재현하여 실제 발동·적용 여부를 확인하고 Lua 로그를 기록합니다.'
  },
  EFFECT_REGISTRATION_COUNT_REVIEW: {
    level: 2, group: '효과 구조', action: '①②③ 번호 효과와 Lua 등록 호출 수의 차이를 조사합니다. 하나의 효과가 여러 처리를 담당하거나 다른 헬퍼를 사용하는지 먼저 확인합니다.',
    verify: '해당 카드의 각 번호 효과를 독립적으로 재현해 발동 조건·처리 결과·1턴 1번 제한 등을 확인합니다.'
  },
  NO_INITIAL_EFFECT: {
    level: 1, group: 'Lua 구조', action: '해당 카드의 initial_effect 등록 위치와 함수 선언을 확인한다. 일반 카드 Lua라면 엔진이 호출할 초기화 함수를 구현한다.',
    verify: 'EDOPro에서 카드를 로드한 뒤 실제 효과를 발동해 초기화 오류 여부를 확인한다.'
  },
  NO_CARD_SCRIPT: {
    level: 1, group: '파일 연결', action: 'CDB의 카드 ID와 동일한 c<ID>.lua가 시험 패키지 또는 실제 script 폴더에 있는지 확인한다. 누락이 확정된 경우만 새로 작성한다.',
    verify: '등록된 CDB·Lua를 같은 버전으로 다시 불러와 경고가 해소되는지 보고, EDOPro에서 카드를 소환/발동한다.'
  },
  ID_MISMATCH: {
    level: 1, group: '파일 연결', action: '원문과 CDB 중 어느 ID가 승인된 정식 값인지 먼저 확정하고, 덱·Lua 파일명·카드 이미지 ID도 함께 대조한다.',
    verify: '카드 원문·CDB·Lua·YDK가 같은 ID를 참조하는지 확인한다.'
  },
  DESCRIPTION_MISSING: {
    level: 1, group: '선택지 표시', action: 'Lua의 aux.Stringid(id,n)이 참조하는 CDB texts.str(n+1)에 올바른 설명이 있는지 확인하고, 빈 값이라면 해당 카드에 맞는 문구를 입력한다.',
    verify: '실제 EDOPro에서 선택지를 열어 ??? 대신 의도한 설명이 보이는지 확인한다.'
  },
  CDB_VERSION_CONFLICT: {
    level: 1, group: '버전 관리', action: '같은 카드 ID를 가진 서로 다른 CDB 중 승인된 최신 버전을 결정한다. 구버전은 별도 백업하고 분석 대상에서 제외한다.',
    verify: '동일 ID의 CDB 버전 충돌이 사라지고 Lua가 의도한 원문과 일치하는지 확인한다.'
  },
  LUA_VERSION_CONFLICT: {
    level: 1, group: '버전 관리', action: '동일 카드 ID의 서로 다른 Lua를 비교하여 설치 기준본을 지정한다. 오래된 Lua는 별도 백업한 뒤 검사 입력에서 제외한다.',
    verify: '한 버전의 Lua로 재검사하고 실제 EDOPro에서 대표 효과를 시험한다.'
  },
  LEGACY_LINK_HELPER: {
    level: 2, group: '소환 절차', action: '대상 엔진에서 aux.AddLinkProcedure가 지원되는지 확인한다. 미지원이면 해당 카드의 링크 소재 조건을 보존하며 Link.AddProcedure 형태로 마이그레이션한다.',
    verify: '링크 소재 조건이 다른 2개 이상의 상황에서 정상적으로 링크 소환 후보가 나타나는지 시험한다.'
  },
  XYZ_99_SENTINEL: {
    level: 2, group: '소환 절차', action: 'Xyz.AddProcedure의 99가 무한 소재를 의도하는지 확인한다. 엔진에서 필요하면 Xyz.InfiniteMats로 변경하되 소재 조건을 유지한다.',
    verify: '엑시즈 소환창 표시와 소재 수 조건을 실제 엔진에서 확인한다.'
  },
  ATTACK_API_COMPAT: {
    level: 2, group: 'API 호환', action: 'GetOriginalAttack 호출 대상과 실제 설치된 EDOPro API를 비교한다. 미지원으로 확인될 경우 목적에 맞는 지원 API로 교체한다.',
    verify: '해당 효과 발동 시 nil 메서드/런타임 오류가 재현되지 않는지 확인한다.'
  },
  OPTIONAL_TRIGGER_TIMING: {
    level: 2, group: '유발 효과', action: '특수 소환 성공 후 같은 효과 처리 중 다른 행동이 이어지는지 살펴본다. 텍스트가 선택 유발 효과라면 EFFECT_FLAG_DELAY의 필요성과 기존 Clone 속성을 확인한다.',
    verify: '일반 특수 소환과 다른 효과 도중 특수 소환을 각각 재현해 발동 선택지가 나타나는지 시험한다.'
  },
  REASON_BITMASK_COMPARE: {
    level: 2, group: '소재 판정', action: '소재로 사용한 이유가 복합 비트 플래그인지 확인한다. 그렇다면 r==REASON_LINK 등 단순 비교를 해당 엔진의 비트마스크 검사로 바꿀지 검토한다.',
    verify: '링크/싱크로 등 소재로 보낸 후 조건 효과가 발동하는지 확인한다.'
  },
  SHARED_SCRIPT_NOT_IMPORTED: {
    level: 2, group: '공용 파일', action: 'Duel.LoadScript에서 참조한 공용 Lua가 실제 EDOPro 설치 경로에 있는지 확인한다. 업로드 누락일 뿐이면 파일을 추가해 재검사한다.',
    verify: '공용 파일을 포함해 재검사하고 엔진에서 초기화 오류가 없는지 시험한다.'
  },
  PENDULUM_RANGE_LITERAL: {
    level: 2, group: '펜듈럼', action: 'P존 관련 SetRange의 숫자 상수가 실제 엔진의 LOCATION_PZONE 값과 일치하는지 확인한다. 의도가 P존이면 이름 있는 상수 사용을 검토한다.',
    verify: 'P존에 카드가 있을 때만 해당 펜듈럼 효과가 적용되는지 시험한다.'
  },
  EFFECT_COUNT_MISMATCH: {
    level: 2, group: '원문 대조', action: '설계 원문과 CDB에서 효과 번호·개수를 나란히 비교한다. 설계에서 승인한 버전을 기준으로 누락 또는 추가 문구를 결정한다.',
    verify: '원문과 CDB의 효과 수를 다시 검사하고 게임에서 각각의 효과가 존재하는지 확인한다.'
  },
  EFFECT_ORDER_MISMATCH: {
    level: 2, group: '원문 대조', action: '펜듈럼 효과와 몬스터 효과 구획 및 ①②③ 순서를 비교한다. 구획 분리 오류인지 실제 카드 데이터 차이인지 먼저 판단한다.',
    verify: '카드 정보 창의 효과 구분/순서가 승인 원문과 일치하는지 확인한다.'
  },
  EFFECT_TEXT_DIFFERENCE: {
    level: 2, group: '원문 대조', action: '원문과 CDB 설명의 단순 표기 차이인지 실제 효과 차이인지 비교한다. 승인되지 않은 버전을 자동으로 덮어쓰지 않는다.',
    verify: '확정된 정식 원문을 기준으로 다시 검사한다.'
  },
  CDB_EFFECT_EMPTY: {
    level: 2, group: '원문 대조', action: 'CDB 설명란에 효과가 빠졌는지, 효과 번호가 없는 정상 카드인지 확인한다.',
    verify: '게임 카드 상세 문구와 원문을 대조한다.'
  },
  NAME_MISMATCH: {
    level: 2, group: '원문 대조', action: '공식 채택한 카드명을 확인하고 원문·CDB·검색 대상의 표기 차이를 정리한다.',
    verify: '원문과 CDB가 동일한 이름으로 연결되는지 재검사한다.'
  },
  NO_CDB_CARD: {
    level: 3, group: '자료 범위', action: '우선 그 테마의 CDB가 이번 입력 자료에 포함됐는지 확인한다. 자료 범위가 충분한데도 카드가 없다면 실제 누락을 조사한다.',
    verify: '해당 테마 CDB를 추가해 다시 검사한다. 단순 미업로드를 카드 결함으로 판단하지 않는다.'
  },
  SOURCE_ID_UNSPECIFIED: {
    level: 3, group: '자료 범위', action: '공식 CDB에 연결한 카드 ID를 원문 버전 관리 자료에 병기할지 결정한다. 기존 ID를 임의로 새로 발급하지 않는다.',
    verify: '다른 이름의 카드와 잘못 연결되지 않는지 확인한다.'
  },
  CDB_NOT_IMPORTED: {
    level: 3, group: '자료 범위', action: '검토할 테마의 CDB를 보관함에 추가한다.',
    verify: 'CDB 카드 수와 카드명·ID 매핑이 표시되는지 확인한다.'
  },
  LUA_NOT_IMPORTED: {
    level: 3, group: '자료 범위', action: '해당 카드군 Lua 파일을 포함한 시험 패키지를 등록한다.',
    verify: '카드별 Lua 파일명과 코드 근거가 나타나는지 확인한다.'
  },
  SOURCE_NOT_IMPORTED: {
    level: 3, group: '자료 범위', action: '승인된 카드 효과 원문 TXT 또는 ZIP을 등록한다.',
    verify: '원문·CDB 효과 비교가 가능해졌는지 확인한다.'
  },
  SOURCE_EFFECT_UNSTRUCTURED: {
    level: 3, group: '자료 범위', action: '원문이 비표준 형식인 경우 ①②③ 경계를 사람이 확인하고 필요할 때 문서 서식을 정리한다.',
    verify: '효과 번호를 정상 추출하는지 확인한다.'
  },
  SPSUMMON_REVIEW: {
    level: 2, group: '유발 효과', action: '특수 소환 성공 시 유발 효과 이벤트 등록 여부를 확인한다. 공용 헬퍼에서 처리되는지도 함께 확인한다.',
    verify: '소환 성공 직후 실제 엔진에서 발동 선택지가 보이는지 시험한다.'
  }
});

const LABELS = ['즉시 확인', '수정 검토', '자료 보강'];
const GROUP_ORDER = new Map([['Lua 구조',0],['파일 연결',1],['선택지 표시',2],['버전 관리',3]]);

function classify(issue) {
  const template = DEFINITIONS[issue.code];
  if (template) return template;
  return {
    level: issue.severity === 'error' ? 2 : 3, group: '기타 검수',
    action: '문제의 실제 원인과 자료 범위를 확인한 다음 수정 여부를 결정한다.',
    verify: '원문·CDB·Lua를 다시 대조하고 필요한 경우 EDOPro에서 재현 시험한다.'
  };
}
function cleanEvidence(issue) {
  if (!issue.line) return null;
  return {
    file: issue.file || 'Lua 파일',
    line: issue.line,
    snippet: issue.snippet || ''
  };
}

export function buildCardPlan(card) {
  const byCode = new Map();
  for (const issue of card.issues || []) {
    const rule = classify(issue);
    const existing = byCode.get(issue.code);
    const evidence = cleanEvidence(issue);
    if (existing) {
      if (evidence && !existing.evidence.some((x) => x.file === evidence.file && x.line === evidence.line)) existing.evidence.push(evidence);
      continue;
    }
    byCode.set(issue.code, {
      code: issue.code,
      problem: issue.title,
      detail: issue.detail || '',
      group: rule.group,
      priority: rule.level,
      priorityLabel: LABELS[rule.level - 1],
      suggestedAction: rule.action,
      verify: rule.verify,
      basis: issue.confidence === 'static' ? '코드 패턴 확인' :
        issue.confidence === 'review' ? '동작 검토 필요' : '자료 비교 또는 미제공',
      evidence: evidence ? [evidence] : []
    });
  }
  const steps = [...byCode.values()].sort((a,b) =>
    a.priority - b.priority ||
    (GROUP_ORDER.get(a.group) ?? 10) - (GROUP_ORDER.get(b.group) ?? 10) ||
    a.code.localeCompare(b.code));
  return { name: card.name, id: card.id, theme: card.theme, key: card.key, steps };
}

export function buildFixPlan(result) {
  const cards = (result?.cards || []).map(buildCardPlan);
  const actionCards = cards.filter((c) => c.steps.length);
  const counts = { cards: cards.length, flaggedCards: actionCards.length,
    first: 0, second: 0, third: 0, actions: 0 };
  for (const card of cards) for (const step of card.steps) {
    counts.actions++;
    counts[['first','second','third'][step.priority - 1]]++;
  }
  return { cards, counts, note: '자동 생성된 검토 제안입니다. 코드 변경·규칙 적법성·EDOPro 작동은 검증하거나 실행하지 않았습니다.' };
}

export function cardPlanMarkdown(card) {
  const out = ['## ' + card.theme + ' / ' + card.name + (card.id ? ' (' + card.id + ')' : ''), ''];
  if (!card.steps.length) return [...out, '정적 검수에서 등록된 검토 항목이 없습니다. 정상 작동을 보증하지 않습니다.', ''].join('\n');
  for (const [i, step] of card.steps.entries()) {
    out.push('### ' + (i + 1) + '. [' + step.priorityLabel + '] ' + step.problem + ' (' + step.code + ')', '');
    out.push('- **관찰된 내용:** ' + step.detail);
    out.push('- **근거 수준:** ' + step.basis);
    for (const evidence of step.evidence) {
      out.push('- **코드 위치:** ' + evidence.file + ':' + evidence.line);
      if (evidence.snippet) out.push('  - 코드: ' + evidence.snippet.replace(/\n/g, ' ').slice(0, 220));
    }
    out.push('- **권장 조치:** ' + step.suggestedAction, '- **확인 방법:** ' + step.verify, '');
  }
  return out.join('\n');
}

export function fixPlanMarkdown(result) {
  const plan = buildFixPlan(result);
  const actionable = plan.cards.filter((card) => card.steps.some((step) => step.priority <= 2));
  const items = new Map();
  for (const card of plan.cards) for (const step of card.steps.filter((item) => item.priority === 3)) {
    const found = items.get(step.code) || { name: step.problem, count: 0 };
    found.count++;
    items.set(step.code, found);
  }
  const lines = ['# DESIGN LAB — 카드별 수정 검토안 V0.5.2', '',
    '> 정적 검사 결과에서 생성한 규칙 기반 제안입니다. 승인 없는 수정은 실행하지 않았습니다.', '',
    '대상 카드: ' + plan.counts.cards + '종 / 실제 수정 검토 대상: ' + actionable.length +
      '종 / 코드·문구 수정 검토: ' + (plan.counts.first + plan.counts.second) + '건',
    '자료 범위·미제공 알림: ' + plan.counts.third + '건 (아래에서 유형별로 묶어 표시)', '',
    '## 진행 순서', '',
    '1. 현재 입력한 원문·CDB·Lua의 범위를 먼저 확인합니다.',
    '2. 코드·문구 수정 후보를 확인하고 정식 원문과 맞춰 수정 범위를 승인합니다.',
    '3. 원본을 백업한 뒤 승인된 파일만 수정하고 정적 재검사를 수행합니다.',
    '4. 해당 효과를 EDOPro에서 재현하여 실제 작동을 확인합니다.', ''];
  if (!actionable.length) {
    lines.push('## 현재 코드 수정 검토 대상 없음', '',
      '현재 입력 자료에서 실제 수정 검토로 분류된 항목이 없습니다. 이것은 정상 작동이 확인됐다는 뜻이 아닙니다.', '');
    if (!result?.coverage?.hasCdb || !result?.coverage?.hasLua) lines.push(
      '현재 CDB 또는 Lua 분석 자료가 부족합니다. 해당 테마의 최신 CDB와 Lua 시험 패키지를 추가한 뒤 다시 검수하세요.', '');
  } else {
    lines.push('## 카드별 수정 검토 항목', '');
    for (const card of actionable) lines.push(cardPlanMarkdown({
      ...card, steps: card.steps.filter((step) => step.priority <= 2)
    }));
  }
  if (items.size) {
    lines.push('## 자료 범위·미제공 안내 (유형별 집계)', '',
      '동일한 정보 안내를 각 카드마다 반복하지 않고 한 번만 표시합니다.', '');
    for (const [code, entry] of [...items.entries()].sort((a,b) => b[1].count - a[1].count))
      lines.push('- ' + code + ' · ' + entry.name + ': ' + entry.count + '종');
    lines.push('');
  }
  lines.push('---', plan.note, '');
  return lines.join('\n');
}
