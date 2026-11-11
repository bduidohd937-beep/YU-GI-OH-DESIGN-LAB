import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildFixPlan, fixPlanMarkdown } from '../src/fix-planner.js';

const html = readFileSync(new URL('../index.html', import.meta.url),'utf8');
const ui = readFileSync(new URL('../src/audit-ui.js', import.meta.url),'utf8');
const focus = readFileSync(new URL('../src/audit-reader.js', import.meta.url),'utf8');
const css = readFileSync(new URL('../src/audit-reader.css', import.meta.url),'utf8');

function makeCard(i, issues) {
  return {key:'테마:card-'+i,name:'카드-'+i,id:String(990470100+i),theme:'천망성역',source:'원문.txt',
    lua:null,cdb:null,description:'①: 효과',cdbDescription:'',issues};
}
const missing = (code,title) => ({code,title,severity:'info',detail:'자료가 없습니다.'});

test('검수 집중 읽기 DOM과 통합 모듈이 존재',()=>{
  for(const id of ['audit-reader-open','audit-reader-overlay','audit-reader-close',
    'audit-reader-search','audit-reader-filter','audit-reader-list','audit-reader-content',
    'audit-reader-position','audit-reader-prev','audit-reader-next','audit-reader-font-down',
    'audit-reader-font-up','audit-reader-copy','audit-reader-title','audit-coverage-notice']){
    assert.match(html,new RegExp('id="' + id + '"'),id);
  }
  assert.match(html,/src\/audit-reader\.css/);
  assert.match(ui,/createAuditReader\(/);
  assert.match(ui,/reader\.sync\(\)/);
});

test('오류와 참고 자료 보강을 구분하고 자료가 없으면 중복을 압축해 표시',()=>{
  const card=makeCard(1,[
    missing('CDB_NOT_IMPORTED','CDB 미제공'),
    missing('LUA_NOT_IMPORTED','Lua 미제공'),
    missing('SOURCE_ID_UNSPECIFIED','원문 ID 없음')
  ]);
  assert.match(focus,/filter\(\(step\) => step\.priority < 3\)/);
  assert.match(focus,/검사에 필요한 자료가 부족합니다/);
  assert.match(focus,/이 카드와 연결된 CDB·Lua가 없습니다/);
  assert.match(ui,/audit-no-code-note/);
  assert.match(ui,/CDB\/Lua 심층 검수는 자료 추가 대기 중/);
  const plan=buildFixPlan({cards:[card]});
  assert.equal(plan.counts.first,0);
  assert.equal(plan.counts.second,0);
  assert.equal(plan.counts.third,3);
});

test('86종·222개 자료 보강 기록은 86개의 반복 문단 대신 유형별 집계',()=>{
  const cards=Array.from({length:86},(_,i)=>makeCard(i,[
    missing('CDB_NOT_IMPORTED','CDB 미제공'),
    missing('LUA_NOT_IMPORTED','Lua 미제공'),
    ...(i<50?[missing('SOURCE_ID_UNSPECIFIED','원문 ID 없음')]:[])
  ]));
  const result={cards,coverage:{hasSource:true,hasCdb:false,hasLua:false}};
  const report=fixPlanMarkdown(result);
  assert.match(report,/대상 카드: 86종/);
  assert.match(report,/자료 범위·미제공 알림: 222건/);
  assert.match(report,/CDB_NOT_IMPORTED.*86종/);
  assert.match(report,/LUA_NOT_IMPORTED.*86종/);
  assert.match(report,/SOURCE_ID_UNSPECIFIED.*50종/);
  assert.doesNotMatch(report,/## 천망성역 \/ 카드-0/);
  assert.ok(report.length<3500,'반복된 안내가 과도하게 길어지지 않아야 함');
});

test('실제 코드 문제는 파일 줄번호와 수정 방향을 계속 보존',()=>{
  const result={cards:[makeCard(1,[{
    code:'OPTIONAL_TRIGGER_TIMING',severity:'warning',title:'유발 효과 타이밍',
    detail:'복제 효과에 DELAY 미적용 가능성',confidence:'review',
    file:'script/c990470101.lua',line:19,snippet:'e2:SetCode(EVENT_SPSUMMON_SUCCESS)'
  }])],coverage:{hasCdb:true,hasLua:true}};
  const report=fixPlanMarkdown(result);
  assert.match(report,/script\/c990470101\.lua:19/);
  assert.match(report,/EFFECT_FLAG_DELAY/);
  assert.match(report,/발동/);
});

test('읽기 모드는 화면 전체 18px 기본 글씨와 키보드 이동·닫기 지원',()=>{
  assert.match(css,/\.audit-reader-overlay\{position:fixed;inset:0/);
  assert.match(css,/--audit-reader-size,18px/);
  assert.match(focus,/let opened = false, fontSize = 18/);
  assert.match(focus,/event\.key==='Escape'/);
  assert.match(focus,/event\.key==='ArrowLeft'/);
  assert.match(focus,/event\.key==='ArrowRight'/);
});

test('검수 파일은 집중 보기 모드에서 실행·업로드·덮어쓰기하지 않음',()=>{
  assert.doesNotMatch(focus,/XMLHttpRequest|eval\s*\(|fetch\s*\(/);
  assert.match(focus,/cardPlanMarkdown/);
  assert.doesNotMatch(focus,/writeFile|FileSystemWritableFileStream/);
});
