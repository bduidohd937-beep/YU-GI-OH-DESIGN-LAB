const RULES = [
  ['서치', /덱에서[\s\S]{0,90}(?:패에 넣|패로 가져)/],
  ['특수 소환', /특수 소환/],
  ['펜듈럼', /펜듈럼/],
  ['융합', /융합/],
  ['싱크로', /싱크로/],
  ['엑시즈', /엑시즈/],
  ['링크', /링크/],
  ['파괴', /파괴/],
  ['무효', /무효/],
  ['묘지 활용', /묘지/],
  ['회수', /(?:묘지|제외 상태|엑스트라 덱)[\s\S]{0,90}패에 넣/],
  ['제외', /제외/],
  ['카운터', /카운터/],
  ['상대 턴', /상대\s*(?:턴|메인 페이즈|엔드 페이즈)/]
];

export function classifyCard(card) {
  const keywords = RULES.filter(([, re]) => re.test(card.description)).map(([name]) => name);
  const notices = [];
  if (/미확정|미정|추후 확인/.test(card.description)) {
    notices.push({ type: '확인 필요', message: '카드 원문에 미확정 사항이 기재되어 있습니다.' });
  }
  if (card.description.includes('기억을 잃은 자－아벨')) {
    notices.push({ type: '외부 참조', message: '공용 아벨은 5대 세력 원문에 별도 카드로 분리되어 있습니다.' });
  }
  if (!card.id) {
    notices.push({ type: '자료 연결 대기', message: '이 원문에는 9자리 카드 ID가 명시되지 않았습니다. CDB 대조가 필요합니다.' });
  }
  return { keywords, notices };
}

export function summarize(documents) {
  const cards = documents.flatMap((doc) => doc.cards);
  const tags = new Map();
  for (const card of cards) {
    for (const tag of classifyCard(card).keywords) tags.set(tag, (tags.get(tag) || 0) + 1);
  }
  return {
    themeCount: documents.length,
    cardCount: cards.length,
    themes: documents.map((doc) => ({ name: doc.theme, count: doc.cards.length, version: doc.version })),
    keywords: [...tags.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }))
  };
}

export function makeReport(documents, warnings = []) {
  const summary = summarize(documents);
  const out = [
    '# YU-GI-OH DESIGN LAB — V0.1 기초 진단 보고서',
    '',
    '> 이 보고서는 원문 파일을 분류하고 키워드를 집계한 정적 진단입니다. OCG 규칙 판정, Lua 구동, AI 자동 대전, 덱 성능 검증 결과가 아닙니다.',
    '',
    '원문 파일: ' + summary.themeCount + '개 테마 / 카드 ' + summary.cardCount + '종',
    ''
  ];
  for (const doc of documents) {
    out.push('## ' + doc.theme + ' (' + doc.version + ', ' + doc.cards.length + '종)');
    out.push('');
    out.push('출처 파일: ' + doc.fileName);
    out.push('');
    for (const card of doc.cards) {
      const r = classifyCard(card);
      out.push('- ' + card.name + (card.id ? ' [' + card.id + ']' : '') + ': ' + (r.keywords.join(', ') || '미분류'));
      for (const notice of r.notices) out.push('  - [' + notice.type + '] ' + notice.message);
    }
    if (doc.notes) {
      out.push('', '### 원문에 기록된 변경·검증 메모', '', doc.notes);
    }
    out.push('');
  }
  if (warnings.length) out.push('## 가져오기 경고', ...warnings.map((s) => '- ' + s));
  return out.join('\n');
}
