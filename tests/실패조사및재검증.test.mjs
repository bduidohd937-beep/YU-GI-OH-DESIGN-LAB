import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {makeTestEntry,mergeTestRecords} from '../src/test-records.js';
import {TRIAGE_KEY,TRIAGE_STATES,sanitizeInvestigation,makeInvestigation,
  mergeInvestigations,encodeInvestigations,decodeInvestigations,
  compareInstalledVersion,getLineContext,buildFailureQueue,failureQueueMarkdown} from '../src/failure-triage.js';

const code=[
  'local s,id=GetID()',
  'function s.initial_effect(c)',
  ' local e1=Effect.CreateEffect(c)',
  ' e1:SetCode(EVENT_SPSUMMON_SUCCESS)',
  ' c:RegisterEffect(e1)',
  'end',
  'function s.op(e,tp)',
  ' local x=c:GetOriginalAttack()',
  ' return x',
  'end'
].join('\n');
const orig={key:'천망성역:990470109',id:'990470109',name:'천망성역－라지엘',theme:'천망성역',
  lua:'천망성역_V0.9.2_긴급패치.zip / script/c990470109.lua',luaSource:code,
  issues:[{code:'ATTACK_API_COMPAT',severity:'warning',title:'공격력 API 검토',detail:'시그니처 호환 확인',
    line:8,file:'script/c990470109.lua'}]};
const other={key:'천망성역:990470116',id:'990470116',name:'천망성역－역사의 역전',theme:'천망성역',
  lua:'천망성역_V0.9.2_긴급패치.zip / script/c990470116.lua',luaSource:'one\ntwo\nthree',
  issues:[]};
const caseOne={key:'천망성역:990470109:effect:몬스터:①:0',theme:'천망성역',id:'990470109',name:orig.name,
  title:'몬스터 ① 재현',lua:orig.lua,steps:'특수 소환',expected:'①: 효과 처리'};
const caseTwo={...caseOne,key:'천망성역:990470116:base',id:'990470116',name:other.name,lua:other.lua,title:'소환 조건'};
const result={cards:[orig,other]};
const plan={theme:'천망성역',cases:[caseOne,caseTwo]};
function rec(status='fail',time='2026-11-11T10:00:00Z',id='run1',version='V0.9.2',testCase=caseOne){
 return makeTestEntry({test:testCase,status,installedVersion:version,
   notes:'발동 창이 나오지 않고 nil 오류 발생',
   log:'script/c990470109.lua:8: attempt to call a nil value\nscript/c990470116.lua:2: stack',
   time,id});
}
test('실패 기록은 로그 참조·동일 카드 정적 근거·코드 줄번호를 조사표에 연결',()=>{
 const q=buildFailureQueue(result,plan,[rec()]);
 assert.equal(q.counts.fail,1);
 assert.equal(q.items.length,1);
 const one=q.items[0];
 assert.equal(one.test.id,'990470109');
 assert.equal(one.issues[0].code,'ATTACK_API_COMPAT');
 assert.equal(one.logHits.length,2);
 assert.equal(one.logHits[0].cardId,'990470109');
 assert.match(one.logHits[0].context.code,/→ 8 \|  local x=c:GetOriginalAttack/);
 assert.equal(one.logHits[1].otherCard,true);
 assert.equal(one.logHits[1].context,null);
 assert.ok(one.guidance.some(x=>x.includes('nil')));
});
test('다른 버전에서 발생한 로그는 현재 Lua의 해당 줄을 오류 근거로 단정하지 않음',()=>{
 const entry=rec('fail','2026-11-11T10:00:00Z','v1','V0.9.1');
 assert.equal(compareInstalledVersion(caseOne,entry),'different');
 const q=buildFailureQueue(result,plan,[entry]);
 assert.equal(q.counts.retest,1);
 assert.equal(q.counts.fail,0);
 assert.equal(q.items[0].logHits[0].context,null);
 assert.equal(q.items[0].logHits[0].versionRelation,'different');
});
test('번호 없거나 Lua 원문이 없으면 근거를 만들지 않음',()=>{
 assert.equal(getLineContext(code,0),null);
 assert.equal(getLineContext(code,200),null);
 assert.equal(getLineContext(null,8),null);
 assert.equal(getLineContext(code,8).from,6);
 assert.equal(getLineContext(code,8).to,10);
});
test('과거 실패 기록 후 현재 통과했다면 현재 조사 대기열에는 표시하지 않음',()=>{
 const fail=rec('fail','2026-11-10T10:00:00Z','fail');
 const pass=rec('pass','2026-11-11T12:00:00Z','pass');
 const q=buildFailureQueue(result,plan,mergeTestRecords([fail],[pass]));
 assert.equal(q.items.length,0);
});
test('버전 변경으로 기존 통과가 재검증 필요가 되면 조사 대상에 포함',()=>{
 const pass=rec('pass','2026-11-11T12:00:00Z','pass','V0.9.1');
 const q=buildFailureQueue(result,plan,[pass]);
 assert.equal(q.items.length,1);
 assert.equal(q.items[0].effectiveStatus,'retest');
 assert.match(q.note,/원인은 확정되지 않았/);
});
test('조사 상태는 지정 상태만 가능하고 승인용 수정안·재시험 절차를 강제',()=>{
 assert.equal(Object.keys(TRIAGE_STATES).length,3);
 assert.throws(()=>makeInvestigation({caseKey:caseOne.key,state:'fixed'}),/조사 상태/);
 assert.throws(()=>makeInvestigation({caseKey:caseOne.key,state:'proposed'}),/수정 방향/);
 assert.throws(()=>makeInvestigation({caseKey:caseOne.key,state:'awaiting_retest',
  suggestedChange:'조건 함수 수정'}),/재현 절차/);
 const note=makeInvestigation({
  caseKey:caseOne.key,state:'awaiting_retest',
  hypothesis:'Lua nil 반환 가능성',suggestedChange:'조건 함수 확인 및 수정 검토',
  retestSteps:'같은 버전에서 링크 소재와 체인 조건 확인',
  updatedAt:'2026-11-11T13:00:00Z'
 });
 assert.equal(note.state,'awaiting_retest');
});
test('조사 기록 JSON 저장·복원·병합 시 같은 케이스의 더 최신 수정안을 남김',()=>{
 const old=makeInvestigation({caseKey:caseOne.key,state:'investigating',
  updatedAt:'2026-11-10T13:00:00Z',hypothesis:'추정 1'});
 const next=makeInvestigation({caseKey:caseOne.key,state:'proposed',
  updatedAt:'2026-11-11T13:00:00Z',suggestedChange:'조건 재검토'});
 const values=decodeInvestigations(encodeInvestigations(mergeInvestigations([next],[old])));
 assert.equal(values.length,1);
 assert.equal(values[0].state,'proposed');
 assert.equal(decodeInvestigations('{bad').length,0);
 assert.equal(decodeInvestigations({schema:2,items:[next]}).length,0);
 assert.equal(sanitizeInvestigation({...next,state:'success'}),null);
 assert.equal(TRIAGE_KEY,'design-lab:edopro-investigation:v1');
});
test('실패 조사 보고서에는 실제 로그 근거·수정안·재시험 절차와 비확정 고지가 포함',()=>{
 const note=makeInvestigation({caseKey:caseOne.key,state:'awaiting_retest',
  hypothesis:'코드 호출 API 확인',suggestedChange:'Lua API 호출 수정 검토',
  retestSteps:'패치 설치 후 해당 발동 상황 재현',
  updatedAt:'2026-11-11T15:00:00Z'});
 const q=buildFailureQueue(result,plan,[rec()],[note]);
 const md=failureQueueMarkdown(q);
 assert.match(md,/c990470109\.lua:8/);
 assert.match(md,/c990470116\.lua:2/);
 assert.match(md,/Lua API 호출 수정 검토/);
 assert.match(md,/패치 설치 후 해당 발동 상황 재현/);
 assert.match(md,/원인 확정이나 카드 패치는 하지 않았습니다/);
 assert.doesNotMatch(md,/자동 수정 완료|EDOPro 실행 완료/);
});
test('기록과 코드 텍스트를 HTML로 실행하거나 서버에 올리지 않음',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../src/test-recorder-ui.js',import.meta.url),'utf8');
 const panel=readFileSync(new URL('../src/failure-triage-ui.js',import.meta.url),'utf8');
 for(const id of ['runtime-review-shortcut','runtime-export-triage'])
  assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/value="needs_review"/);
 assert.match(ui,/mergeInvestigations/);
 assert.match(ui,/JSON\.stringify\(backup,null,2\)/);
 assert.match(ui,/failureQueueMarkdown/);
 assert.match(ui,/localStorage\.setItem\(TRIAGE_KEY/);
 assert.doesNotMatch(panel,/innerHTML|eval\s*\(|fetch\s*\(/);
 assert.doesNotMatch(ui,/XMLHttpRequest|fetch\s*\(/);
});
