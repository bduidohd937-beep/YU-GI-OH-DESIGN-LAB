import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildAudit} from '../src/audit.js';
import {buildManualTestPlan} from '../src/smart-audit.js';
import {TEST_RECORDS_KEY,STATUSES,parseLuaErrorReferences,makeTestEntry,
  decodeTestRecords,encodeTestRecords,mergeTestRecords,latestForCases,
  summarizeRecordedTests,recordedTestMarkdown,MAX_RECORDS} from '../src/test-records.js';

const single={
  key:'천망성역:990470109:effect:몬스터:①:0',id:'990470109',
  name:'천망성역－대천감시자 라지엘',theme:'천망성역',
  title:'몬스터 ① 효과 재현',steps:'동시 소환 조건 구성',expected:'①: 효과를 발동한다.',
  lua:'천망성역_V0.9.2_긴급패치.zip'
};
const record=(status='fail',version='V0.9.1',time='2026-11-10T10:00:00Z',id='run1')=>
  makeTestEntry({test:single,status,installedVersion:version,
    notes:'해당 효과 발동창이 나타나지 않았음.',log:'script/c990470109.lua:42: attempt to call a nil value',
    time,id});

test('Lua 로그에서 카드ID·줄번호를 근거로 추출하고 반복 참조 제거',()=>{
  const refs=parseLuaErrorReferences('script/c990470109.lua:42 failed\n./script\\c990470109.lua:42\nc990470116.lua:9\nother.lua:5');
  assert.deepEqual(refs,[{cardId:'990470109',line:42},{cardId:'990470116',line:9}]);
});
test('기록 없는 효과는 미실행으로만 판정',()=>{
  const counts=summarizeRecordedTests([single],[]);
  assert.equal(counts.untested,1);
  assert.equal(counts.pass,0);
  assert.equal(counts.fail,0);
  assert.equal(Object.keys(STATUSES).length,4);
});
test('실제 설치 버전을 입력하지 않으면 수동 판정 저장 불가',()=>{
  assert.throws(()=>makeTestEntry({test:single,status:'pass',installedVersion:' '}),/실제 설치/);
  assert.throws(()=>makeTestEntry({test:single,status:'success',installedVersion:'V0.9.2'}),/수동 판정/);
});
test('버전별 시험 기록 두 개는 덮어쓰지 않고 최신 판정만 현황에 반영',()=>{
  const first=record();
  const second=record('pass','V0.9.2','2026-11-11T10:00:00Z','run2');
  const entries=mergeTestRecords([first],[second]);
  assert.equal(entries.length,2);
  assert.equal(latestForCases(entries).get(single.key).status,'pass');
  assert.equal(summarizeRecordedTests([single],entries).pass,1);
  const report=recordedTestMarkdown({cases:[single],theme:'천망성역'},entries);
  assert.match(report,/V0.9.2/);
  assert.match(report,/시험 기록 수: 2/);
  assert.match(report,/사용자가 직접 기록한 판정/);
});
test('JSON 백업과 복원은 허용된 필드 및 개수로 제한',()=>{
  const restored=decodeTestRecords(encodeTestRecords([record()]));
  assert.equal(restored.length,1);
  assert.equal(restored[0].status,'fail');
  assert.equal(restored[0].references[0].cardId,'990470109');
  assert.equal(decodeTestRecords('broken json').length,0);
  assert.equal(decodeTestRecords(JSON.stringify({schema:999,entries:[record()]})).length,0);
  const invalid={...record(),status:'autopass',id:'bad'};
  assert.equal(decodeTestRecords({schema:1,entries:[invalid]}).length,0);
  assert.ok(MAX_RECORDS<=1500);
});
test('로그·메모 입력 길이를 제한하고 악성 HTML 문자열도 텍스트로 저장',()=>{
  const e=makeTestEntry({test:single,status:'fail',installedVersion:'V0.9.2',
    notes:'<img src=x onerror=alert(1)>'+'x'.repeat(5000),log:'y'.repeat(20000),
    id:'x',time:'2026-11-11T10:00:00Z'});
  assert.equal(e.notes.length,2500);
  assert.equal(e.log.length,12000);
  assert.match(e.notes,/^<img src=x/);
});
test('CDB·Lua 연결 카드에 ①②③ 효과별 실전 재현 항목이 추가됨',()=>{
  const data=buildAudit({
    cdbCards:[{id:'990470109',name:'천망성역－대천감시자 라지엘',type:0x4000021,
      desc:'①: 첫 효과.\n②: 둘째 효과.\n③: 셋째 효과.',strings:[],origin:'천망성역.cdb'}],
    luaFiles:[{name:'script/c990470109.lua',origin:'천망성역.zip',
      text:'local s,id=GetID()\nfunction s.initial_effect(c) c:RegisterEffect(Effect.CreateEffect(c)) end'}]
  });
  const plan=buildManualTestPlan(data,{theme:'천망성역'});
  assert.equal(plan.eligibleCards,1);
  assert.ok(plan.cases.some(x=>x.title==='링크 소환 조건'));
  const perEffect=plan.cases.filter(x=>x.key.includes(':effect:'));
  assert.equal(perEffect.length,3);
  assert.ok(perEffect.every(x=>x.status==='미실행'));
  assert.match(perEffect[2].expected,/셋째 효과/);
});
test('수동 기록은 UI에서만 작성, 직접 실제 EDOPro 시험을 주장하지 않음',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../src/test-recorder-ui.js',import.meta.url),'utf8');
  const audit=readFileSync(new URL('../src/audit-ui.js',import.meta.url),'utf8');
  for(const id of ['runtime-open','runtime-dialog','runtime-stats','runtime-list',
      'runtime-detail','runtime-search','runtime-filter','runtime-notice',
      'runtime-export-json','runtime-export-md','runtime-import-input','runtime-close'])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(ui,/localStorage\.setItem/);
  assert.match(ui,/JSON 기록/);
  assert.match(ui,/installedVersion/);
  assert.match(ui,/dialog\.showModal/);
  assert.match(audit,/testRecorder\.sync\(\)/);
  assert.doesNotMatch(ui,/fetch\s*\(|XMLHttpRequest|innerHTML|eval\s*\(/);
  assert.equal(TEST_RECORDS_KEY,'design-lab:edopro-manual-results:v1');
});
test('기록의 순서와 무관하게 가장 늦은 날짜가 최신 판정',()=>{
  const old=record();
  const newer=record('blocked','V0.9.2','2026-11-11T12:00:00Z','run2');
  assert.equal(latestForCases([newer,old]).get(single.key).status,'blocked');
});
