import test from 'node:test';
import assert from 'node:assert/strict';
import {
  themeFromName,themeFromId,themeFromOrigin,classifyCdbCard,classifyLuaFile,getAssetCoverage
} from '../src/theme-classifier.js';
import { buildAudit } from '../src/audit.js';
import { buildThemeDashboard,buildManualTestPlan,manualTestMarkdown,themeAuditMarkdown } from '../src/smart-audit.js';

const txt=(theme,name,id=null)=>({
  name:theme+'_V1.0_원문.txt',
  text:'《'+theme+'》 V1.0\n[카드 원문]\n[01] '+name+(id?' | ID '+id:'')+'\n①: 특수 소환에 성공한 경우 덱에서 카드 1장을 패에 넣는다.\n[변경 및 검증 메모]\n- 테스트'
});
const cdb=(id,name,type=0x21,origin='통합.cdb')=>({
  id:String(id),name,type,desc:'①: 특수 소환에 성공한 경우 덱에서 카드 1장을 패에 넣는다.',
  strings:['텍스트'],origin
});
const lua=(id,origin='scripts.zip')=>({
  name:'script/c'+id+'.lua',origin,text:'local s,id=GetID()\nfunction s.initial_effect(c)\n local e=Effect.CreateEffect(c)\n c:RegisterEffect(e)\nend'
});
const SKY_NAME='천망성역－예언자 노에마';
const SKY_ID='990470100';

test('이름·알려진 ID·파일명으로 테마 식별, 모르면 미분류',()=>{
  assert.equal(themeFromName('천망성역－예언자 노에마'),'천망성역');
  assert.equal(themeFromId(SKY_ID),'천망성역');
  assert.equal(themeFromId('990999999'),null);
  assert.equal(themeFromOrigin('심연묘역_시험패키지.zip'),'심연묘역');
  assert.equal(classifyCdbCard(cdb(SKY_ID,'예언자 노에마')).theme,'천망성역');
  assert.equal(classifyCdbCard(cdb('123456789','이름 미상')).theme,null);
  assert.equal(classifyLuaFile(lua(SKY_ID)).theme,'천망성역');
});

test('CDB ID 미상이라도 연결된 CDB 이름을 근거로 Lua 테마 판별',()=>{
  const card=cdb('123456789','심연묘역－기록자 네리아');
  const map=new Map([['123456789',card]]);
  assert.equal(classifyLuaFile(lua('123456789'),map).theme,'심연묘역');
});

test('다른 테마 CDB 하나만 업로드한 경우 미등록 테마를 결함으로 표시하지 않는다',()=>{
  const result=buildAudit({
    textFiles:[
      txt('천망성역',SKY_NAME,SKY_ID),
      txt('혈성','혈성-미리엘'),
      txt('파계잔영','파계잔영－이단서기관 레아드')
    ],
    cdbCards:[cdb(SKY_ID,SKY_NAME)],
    luaFiles:[lua(SKY_ID)]
  });
  assert.equal(result.counts.source,3);
  const sky=result.cards.find(x=>x.theme==='천망성역');
  assert.equal(sky.cdb,'통합.cdb');
  assert.equal(sky.lua,'scripts.zip');
  for (const other of result.cards.filter(x=>x.theme!=='천망성역')) {
    assert.ok(other.issues.some(x=>x.code==='CDB_THEME_NOT_IMPORTED'));
    assert.ok(other.issues.some(x=>x.code==='LUA_THEME_NOT_IMPORTED'));
    assert.ok(!other.issues.some(x=>x.code==='NO_CDB_CARD'));
    assert.ok(!other.issues.some(x=>x.code==='NO_CARD_SCRIPT'));
  }
  const dashboard=buildThemeDashboard(result);
  assert.equal(dashboard.themes.find(x=>x.theme==='천망성역').ready,1);
  assert.equal(dashboard.themes.find(x=>x.theme==='혈성').ready,0);
  assert.equal(dashboard.themes.find(x=>x.theme==='혈성').status,'원문만 등록');
});

test('같은 테마 CDB가 있는 상태에서 특정 카드가 없으면 매칭 실패 후보',()=>{
  const result=buildAudit({
    textFiles:[txt('천망성역',SKY_NAME,SKY_ID)],
    cdbCards:[cdb('990470101','천망성역－제1관문')],
    luaFiles:[]
  });
  assert.ok(result.cards[0].issues.some(x=>x.code==='NO_CDB_CARD'));
});

test('원문 없이 CDB/Lua만 업로드해도 해당 테마로 행과 대시보드가 연결됨',()=>{
  const result=buildAudit({
    cdbCards:[cdb(SKY_ID,'예언자 노에마')],
    luaFiles:[lua(SKY_ID)]
  });
  assert.equal(result.cards.length,1);
  assert.equal(result.cards[0].theme,'천망성역');
  assert.equal(buildThemeDashboard(result).themes.find(x=>x.theme==='천망성역').ready,1);
});

test('실전 체크리스트는 자료 연결 카드만 포함하고 실행 여부를 추정하지 않는다',()=>{
  const r=buildAudit({
    textFiles:[txt('천망성역',SKY_NAME,SKY_ID),txt('혈성','혈성-미리엘')],
    cdbCards:[cdb(SKY_ID,SKY_NAME,0x4000021)],
    luaFiles:[lua(SKY_ID)]
  });
  const plan=buildManualTestPlan(r,{theme:'천망성역'});
  assert.equal(plan.eligibleCards,1);
  assert.ok(plan.cases.some(x=>x.title==='링크 소환 조건'));
  assert.ok(plan.cases.every(x=>x.status==='미실행'));
  assert.ok(plan.cases.every(x=>x.id===SKY_ID));
  const md=manualTestMarkdown(plan);
  assert.match(md,/전부 미실행/);
  assert.match(md,/링크 소재/);
  assert.doesNotMatch(md,/테스트 성공|통과 완료/);
  assert.equal(buildManualTestPlan(r,{theme:'혈성'}).cases.length,0);
});

test('유발 효과 타이밍은 구체적 수동 재현 시나리오로 변환',()=>{
  const r=buildAudit({
    cdbCards:[cdb(SKY_ID,SKY_NAME)],
    luaFiles:[{
      name:'script/c'+SKY_ID+'.lua',origin:'패키지.zip',
      text:'local s,id=GetID()\nfunction s.initial_effect(c)\nlocal e=Effect.CreateEffect(c)\ne:SetType(EFFECT_TYPE_TRIGGER_O)\ne:SetCode(EVENT_SPSUMMON_SUCCESS)\nc:RegisterEffect(e)\nend'
    }]
  });
  const cases=buildManualTestPlan(r).cases;
  assert.ok(cases.some(x=>x.title==='유발 효과 타이밍'));
  assert.ok(cases.some(x=>x.steps.includes('다른 효과 처리 도중')));
});

test('테마별 현황은 구현 완료율/실전 승률로 오인되지 않게 표시',()=>{
  const r=buildAudit({textFiles:[txt('혈성','혈성-미리엘')]});
  const d=buildThemeDashboard(r);
  const md=themeAuditMarkdown(d);
  assert.equal(d.themes.length,5);
  assert.equal(d.themes.find(x=>x.theme==='혈성').status,'원문만 등록');
  assert.match(md,/실전 승률이 아닙니다/);
  assert.match(md,/혈성/);
});

test('미분류 카드를 억지로 다른 테마에 편입하지 않음',()=>{
  const cov=getAssetCoverage([], [cdb('123456789','이름 없는 카드')], [lua('123456789')]);
  assert.equal(cov.unknownCdb.length,1);
  assert.equal(cov.unknownLua.length,1);
});
