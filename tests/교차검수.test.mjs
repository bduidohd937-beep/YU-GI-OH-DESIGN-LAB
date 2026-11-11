import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudit, auditMarkdown, getNumberedEffects, normalizeCardName, requiresLua } from '../src/audit.js';

const makeTxt = (card, effect = '①: 덱에서 카드를 패에 넣는다.', name = '파계잔영') =>
  ({ name: '파계잔영_V0.9_원문.txt', text: '《종언성서》 / 《' + name + '》 V0.9\n[카드 원문]\n[01] ' +
    card + '\n' + effect + '\n[변경 및 검증 메모]\n- 확인 필요' });
const makeCdb = (name, desc, id = '990480101', strings = []) =>
  ({ id, name, desc, strings, type: 0x21, origin: '시험.cdb' });
const makeLua = (id = '990480101', body = 'local s,id=GetID()\nfunction s.initial_effect(c) end') =>
  ({ name: 'script/c' + id + '.lua', origin: '시험.zip', text: body });

test('한글 카드명 정규화: 전각 하이픈·인용부호·공백', () => {
  assert.equal(normalizeCardName('《파계잔영－이단서기관 레아드》'),
    normalizeCardName('파계잔영-이단서기관 레아드'));
});

test('원문 ID 없는 카드의 이름으로 CDB·Lua 연결', () => {
  const s = '①: 덱에서 카드를 패에 넣는다.';
  const r = buildAudit({
    textFiles: [makeTxt('파계잔영－이단서기관 레아드', s)],
    cdbCards: [makeCdb('파계잔영－이단서기관 레아드', s)],
    luaFiles: [makeLua()]
  });
  assert.equal(r.counts.source, 1);
  assert.equal(r.cards[0].id, '990480101');
  assert.ok(!r.cards[0].issues.some((x) => x.code === 'NO_CDB_CARD' || x.code === 'NO_CARD_SCRIPT'));
});

test('Lua에서 존재하지 않는 CDB 설명 문자열을 쓰면 경고', () => {
  const desc = '①: 덱에서 카드를 패에 넣는다.';
  const r = buildAudit({
    textFiles: [makeTxt('파계잔영－이단서기관 레아드', desc)],
    cdbCards: [makeCdb('파계잔영－이단서기관 레아드', desc, undefined, ['', '둘째 문자열'])],
    luaFiles: [makeLua(undefined, 'local s,id=GetID()\nfunction s.initial_effect(c) c:RegisterEffect(c) end\nlocal a=aux.Stringid(id,0)')]
  });
  assert.ok(r.cards[0].issues.some((x) => x.code === 'DESCRIPTION_MISSING'));
});

test('CDB만 있고 원문이 없을 때 Lua 검사 가능하며 원문은 미검증', () => {
  const r = buildAudit({ cdbCards: [makeCdb('파계잔영－이단서기관 레아드', '')] });
  assert.equal(r.counts.source, 0);
  assert.equal(r.cards.length, 1);
  assert.ok(r.cards[0].issues.some((x) => x.code === 'SOURCE_NOT_IMPORTED'));
  assert.equal(r.coverage.hasSource, false);
});

test('몬스터 일반 노멀은 Lua 누락을 오류로 판단하지 않는다', () => {
  assert.equal(requiresLua(0x11), false);
  assert.equal(requiresLua(0x4000 | 0x1), false);
  assert.equal(requiresLua(0x21), true);
  assert.equal(requiresLua(0x1000011), true);
});

test('CDB 효과 항목 수 변경 경고', () => {
  const original = '①: 카드 1장을 패에 넣는다.\n②: 자신 묘지에서 1장을 특수 소환한다.';
  const r = buildAudit({
    textFiles: [makeTxt('파계잔영－이단서기관 레아드', original)],
    cdbCards: [makeCdb('파계잔영－이단서기관 레아드', '①: 카드 1장을 패에 넣는다.')],
    luaFiles: [makeLua()]
  });
  assert.ok(r.cards[0].issues.some((x) => x.code === 'EFFECT_COUNT_MISMATCH'));
});

test('Lua가 없으면 필요 카드 Lua 누락 탐지', () => {
  const r = buildAudit({
    textFiles: [makeTxt('파계잔영－이단서기관 레아드')],
    cdbCards: [makeCdb('파계잔영－이단서기관 레아드', '①: 덱에서 카드를 패에 넣는다.')],
    luaFiles: [makeLua('990489999')]
  });
  assert.ok(r.cards[0].issues.some((x) => x.code === 'NO_CARD_SCRIPT'));
});

test('Lua 공용 스크립트 파일 누락 탐지', () => {
  const r = buildAudit({
    textFiles: [makeTxt('파계잔영－이단서기관 레아드')],
    cdbCards: [makeCdb('파계잔영－이단서기관 레아드', '①: 덱에서 카드를 패에 넣는다.')],
    luaFiles: [makeLua(undefined, 'local s,id=GetID()\nDuel.LoadScript("pagye_common.lua")\nfunction s.initial_effect(c) end')]
  });
  assert.ok(r.cards[0].issues.some((x) => x.code === 'SHARED_SCRIPT_NOT_IMPORTED'));
});

test('서로 다른 CDB 버전을 함께 업로드하면 충돌 경고', () => {
  const a = makeCdb('파계잔영－이단서기관 레아드', '①: 카드 한 장을 패에 넣는다.');
  const b = { ...a, desc: '①: 카드 두 장을 패에 넣는다.', origin: '패치.cdb' };
  const r = buildAudit({
    textFiles: [makeTxt('파계잔영－이단서기관 레아드')],
    cdbCards: [a,b],
    luaFiles: [makeLua()]
  });
  assert.ok(r.cards[0].issues.some((x) => x.code === 'CDB_VERSION_CONFLICT'));
});

test('펜듈럼 효과와 몬스터 효과 ①을 서로 구분', () => {
  const sections = getNumberedEffects('【펜듈럼 효과】\n①: A.\n【몬스터 효과】\n①: B.');
  assert.equal(sections.length, 2);
  assert.equal(sections[0].section, '펜듈럼');
  assert.equal(sections[1].section, '몬스터');
});

test('보고서에는 검사 범위와 오류 코드가 기록됨', () => {
  const r = buildAudit({
    textFiles: [makeTxt('파계잔영－이단서기관 레아드')],
    cdbCards: [makeCdb('파계잔영－이단서기관 레아드', '①: 효과가 다르다.')],
    luaFiles: [makeLua()]
  });
  const report = auditMarkdown(r);
  assert.match(report, /정적 점검/);
  assert.match(report, /EFFECT_TEXT_DIFFERENCE/);
});
