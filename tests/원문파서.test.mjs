import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument, parseDocuments } from '../src/parser.js';
import { classifyCard, summarize, makeReport } from '../src/rules.js';

function txt(name, header, body = '①: 덱에서 카드 1장을 패에 넣는다.') {
  return {
    name: name + '_V1.0_원문.txt',
    text: '《종언성서》 / 《' + name + '》 V1.0\n[카드 원문]\n' +
      header + '\n' + body + '\n\n[변경 및 검증 메모]\n- 추가 검증 필요\n[백업 종료]'
  };
}

test('심연묘역 대괄호 + 카드명 제목', () => {
  const d = txt('심연묘역', '[01] 《심연묘역－기록자 네리아》');
  const parsed = parseDocument(d.name, d.text);
  assert.equal(parsed.cards.length, 1);
  assert.equal(parsed.cards[0].name, '심연묘역－기록자 네리아');
  assert.equal(parsed.cards[0].id, null);
  assert.match(parsed.notes, /추가 검증/);
});

test('영각시계 [00] 필드 마법 포함', () => {
  const d = txt('영각시계', '[00] 영각시계\n필드 마법\n[01] 영각시계－초침의 아이라\n효과');
  const parsed = parseDocument(d.name, d.text);
  assert.equal(parsed.cards.length, 2);
  assert.equal(parsed.cards[0].index, '00');
});

test('천망성역 9자리 ID + 토큰 부록 제외', () => {
  const d = txt('천망성역', '[990470100] 천망성역－예언자 노에마\n효과');
  const parsed = parseDocument(d.name, d.text.replace('[변경 및 검증 메모]', '[토큰 / 기술용] 천망성역 토큰\n[변경 및 검증 메모]'));
  assert.equal(parsed.cards.length, 1);
  assert.equal(parsed.cards[0].id, '990470100');
});

test('파계잔영 제목 뒤 ID 분리', () => {
  const d = txt('파계잔영', '[01] 파계잔영－이단서기관 레아드 | ID 990480101');
  const parsed = parseDocument(d.name, d.text);
  assert.equal(parsed.cards[0].id, '990480101');
  assert.equal(parsed.cards[0].name, '파계잔영－이단서기관 레아드');
});

test('혈성 01. 형태의 카드 구분', () => {
  const d = txt('혈성', '01. 혈성-미리엘\n특수 소환한다.\n\n02. 혈성-아그네스\n회수한다.');
  const parsed = parseDocument(d.name, d.text);
  assert.deepEqual(parsed.cards.map((c) => c.name), ['혈성-미리엘', '혈성-아그네스']);
});

test('동일한 카드 원문의 중복 저장은 한 번만 보여주고 경고하지 않음', () => {
  const d = txt('파계잔영', '[01] 파계잔영－이단서기관 레아드');
  const result = parseDocuments([{ name: d.name, text: d.text }, { name: d.name, text: d.text }]);
  assert.equal(result.documents.length, 1);
  assert.equal(result.warnings.length, 0);
});

test('서로 다른 버전이면 입력 순서보다 최신 버전으로 기준본 선택', () => {
  const v1 = txt('파계잔영', '[01] 파계잔영－이단서기관 레아드');
  const v2 = {
    name: '파계잔영_V1.1_원문.txt',
    text: v1.text.replace(' V1.0', ' V1.1').replace('카드 1장을', '카드 2장을')
  };
  const result = parseDocuments([v2,v1]);
  assert.equal(result.documents[0].version, 'V1.1');
  assert.ok(result.warnings.some((m) => m.includes('테마 원문 버전 안내:')));
});

test('서치 분류와 외부 참조는 사실 기반 별도 표시', () => {
  const d = txt('혈성', '01. 혈성-미리엘', '①: 덱에서 "혈성" 카드 1장을 패에 넣는다.\n②: "기억을 잃은 자－아벨" 1장.');
  const card = parseDocument(d.name, d.text).cards[0];
  const classified = classifyCard(card);
  assert.ok(classified.keywords.includes('서치'));
  assert.ok(classified.notices.some((n) => n.type === '외부 참조'));
  assert.ok(classified.notices.some((n) => n.type === '자료 연결 대기'));
});

test('보고서에 원문 메모와 검증 범위 제한 포함', () => {
  const d = txt('심연묘역', '[01] 《심연묘역－기록자 네리아》');
  const result = parseDocuments([{ name: d.name, text: d.text }]);
  assert.equal(summarize(result.documents).cardCount, 1);
  const report = makeReport(result.documents);
  assert.match(report, /검증 결과가 아닙니다/);
  assert.match(report, /추가 검증 필요/);
});

test('비원문 TXT는 오류로 표시하지 않고 검사 제외 목록에 보관', () => {
  const parsed = parseDocuments([{ name: '임의.txt', text: '단순 메모' }]);
  assert.equal(parsed.documents.length, 0);
  assert.equal(parsed.warnings.length, 0);
  assert.deepEqual(parsed.skippedDocuments,['임의.txt']);
});
