import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCardPlan, buildFixPlan, cardPlanMarkdown, fixPlanMarkdown } from '../src/fix-planner.js';
import { buildAudit } from '../src/audit.js';

const makeCard = (issues, name = '파계잔영－이단서기관 레아드') => ({
  key: '파계잔영:01', name, id: '990480101', theme: '파계잔영',
  source: '파계잔영_원문.txt', lua: '시험.zip/script/c990480101.lua',
  description: '', issues
});
const issue = (code, title = '검수 필요', extra = {}) => ({
  code, title, detail: '코드와 원문을 대조하세요.', severity: 'warning', ...extra
});

test('같은 오류 코드 여러 줄은 검토안 하나로 합치되 코드 근거는 보존', () => {
  const card = makeCard([
    issue('OPTIONAL_TRIGGER_TIMING', '특수 소환 유발 검토',
      {file:'시험.zip/script/c990480101.lua', line:14, snippet:'e1:SetCode(EVENT_SPSUMMON_SUCCESS)',confidence:'review'}),
    issue('OPTIONAL_TRIGGER_TIMING', '특수 소환 유발 검토',
      {file:'시험.zip/script/c990480101.lua', line:23, snippet:'e2:SetCode(EVENT_SPSUMMON_SUCCESS)',confidence:'review'})
  ]);
  const plan = buildCardPlan(card);
  assert.equal(plan.steps.length,1);
  assert.equal(plan.steps[0].evidence.length,2);
  assert.match(cardPlanMarkdown(plan),/c990480101\.lua:23/);
});

test('즉시 확인 > 수정 검토 > 자료 보강으로 정렬', () => {
  const plan = buildCardPlan(makeCard([
    issue('CDB_NOT_IMPORTED','CDB 미제공',{severity:'info'}),
    issue('LEGACY_LINK_HELPER','구형 링크'),
    issue('DESCRIPTION_MISSING','설명 문구')
  ]));
  assert.deepEqual(plan.steps.map(x=>x.priority),[1,2,3]);
  assert.deepEqual(plan.steps.map(x=>x.code),['DESCRIPTION_MISSING','LEGACY_LINK_HELPER','CDB_NOT_IMPORTED']);
});

test('구형 링크 API는 자동 교체하지 않고 재현 절차를 설명', () => {
  const plan = buildCardPlan(makeCard([issue('LEGACY_LINK_HELPER','구형 링크')]));
  assert.match(plan.steps[0].suggestedAction,/확인/);
  assert.match(plan.steps[0].verify,/링크 소환/);
  assert.doesNotMatch(cardPlanMarkdown(plan),/적용 완료|자동 패치 성공/);
});

test('원문만 등록했을 때 CDB 미제공은 즉시 고장으로 분류하지 않음', () => {
  const plan = buildCardPlan(makeCard([
    issue('CDB_NOT_IMPORTED','CDB 미제공',{severity:'info'}),
    issue('LUA_NOT_IMPORTED','Lua 미제공',{severity:'info'})
  ]));
  assert.ok(plan.steps.every(x=>x.priority===3));
  assert.ok(plan.steps.every(x=>x.group==='자료 범위'));
});

test('잘 알려지지 않은 오류는 확인 필요로 남기되 근거를 꾸며내지 않음', () => {
  const plan = buildCardPlan(makeCard([issue('CUSTOM_UNKNOWN','사용자 정의 오류')]));
  assert.equal(plan.steps[0].evidence.length,0);
  assert.match(plan.steps[0].suggestedAction,/확인/);
});

test('문제가 없는 카드에 정상 작동이 검증됐다고 쓰지 않음', () => {
  const plan = buildCardPlan(makeCard([]));
  assert.equal(plan.steps.length,0);
  assert.match(cardPlanMarkdown(plan),/보증하지 않습니다/);
});

test('카드별·전체 결과 집계 일치 및 수정안 Markdown 보존', () => {
  const data={cards:[
    makeCard([issue('DESCRIPTION_MISSING','선택지 누락',{file:'a.lua',line:3,snippet:'aux.Stringid(id,0)',confidence:'static'})]),
    {...makeCard([issue('REASON_BITMASK_COMPARE','사유 비교')],'천망성역－노에마'),key:'천망성역:01',theme:'천망성역'},
    {...makeCard([issue('SOURCE_ID_UNSPECIFIED','ID 없음',{severity:'info'})],'혈성－미리엘'),key:'혈성:01',theme:'혈성'}
  ]};
  const plan=buildFixPlan(data);
  assert.equal(plan.counts.cards,3);
  assert.equal(plan.counts.actions,3);
  assert.deepEqual([plan.counts.first,plan.counts.second,plan.counts.third],[1,1,1]);
  const md=fixPlanMarkdown(data);
  assert.match(md,/Lua|a\.lua:3/);
  assert.match(md,/aux.Stringid\(id,0\)/);
  assert.match(md,/EDOPro/);
});

test('실제 buildAudit의 Lua 탐지 결과에서 검토안 연결',()=>{
  const result=buildAudit({
    luaFiles:[{name:'script/c990470100.lua',origin:'패키지.zip/script/c990470100.lua',
      text:'local s,id=GetID()\nfunction s.initial_effect(c)\naux.AddLinkProcedure(c,nil,2)\nend'}]
  });
  const plan=buildFixPlan(result);
  assert.equal(plan.cards.length,1);
  assert.ok(plan.cards[0].steps.some(x=>x.code==='LEGACY_LINK_HELPER'));
  assert.ok(fixPlanMarkdown(result).includes('패키지.zip/script/c990470100.lua:3'));
});

test('UI의 수정안 보기와 보고서 저장 컨트롤이 연결돼 있다',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../src/audit-ui.js',import.meta.url),'utf8');
  assert.match(html,/id="fix-export"/);
  assert.match(html,/value="fix"/);
  assert.match(ui,/buildCardPlan/);
  assert.match(ui,/fixPlanMarkdown/);
  assert.match(ui,/cardPlanMarkdown/);
  assert.match(ui,/navigator\.clipboard\.writeText/);
});

test('수정안에 코드 자동 교체·네트워크 전송 기능이 없다',()=>{
  const code=readFileSync(new URL('../src/fix-planner.js',import.meta.url),'utf8');
  assert.doesNotMatch(code,/fetch\(|XMLHttpRequest|eval\(/);
  assert.doesNotMatch(code,/Duel\.CreateToken|Duel\.SpecialSummon/);
});
