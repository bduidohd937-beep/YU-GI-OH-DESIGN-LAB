import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  scanEffectRegistrations, inspectEffectImplementation, implementationIssues, implementationMarkdown
} from '../src/effect-implementation.js';
import { buildAudit, getNumberedEffects } from '../src/audit.js';
import { buildCardPlan } from '../src/fix-planner.js';

const lua=(text,id='990470100')=>({name:'script/c'+id+'.lua',origin:'천망성역_패키지.zip/script/c'+id+'.lua',text});
const source=(text)=>getNumberedEffects(text);
const script=[
'local s,id=GetID()',
'function s.initial_effect(c)',
' local e1=Effect.CreateEffect(c)',
' e1:SetType(EFFECT_TYPE_SINGLE|EFFECT_TYPE_TRIGGER_O)',
' e1:SetCode(EVENT_SPSUMMON_SUCCESS)',
' e1:SetOperation(s.op)',
' c:RegisterEffect(e1)',
' local e2=e1:Clone()',
' e2:SetCode(EVENT_SUMMON_SUCCESS)',
' c:RegisterEffect(e2)',
'end',
'function s.op(e,tp) end'
].join('\n');

test('①②③ 원문과 Lua 등록 2건의 차이는 누락 확정 아닌 검토 후보',()=>{
  const report=inspectEffectImplementation({
    sourceEffects:source('①: 첫 번째.\n②: 두 번째.\n③: 세 번째.'),
    cdbEffects:source('①: 첫 번째.\n②: 두 번째.\n③: 세 번째.'),
    script:lua(script)
  });
  assert.equal(report.expectedCount,3);
  assert.equal(report.registrationCount,2);
  assert.equal(report.state,'count_review');
  const issues=implementationIssues(report);
  assert.equal(issues.length,1);
  assert.equal(issues[0].severity,'info');
  assert.match(issues[0].detail,/누락 확정은 아닙니다/);
});

test('실제 Lua 등록 위치와 메서드 힌트 보존',()=>{
  const data=scanEffectRegistrations(lua(script));
  assert.deepEqual(data.registrations.map(x=>x.line),[7,10]);
  assert.equal(data.registrations[0].variable,'e1');
  assert.ok(data.registrations[0].methods.includes('SetOperation'));
  assert.ok(data.registrations[0].snippet.includes('c:RegisterEffect(e1)'));
});

test('주석과 일반 문자열 및 긴 문자열의 가짜 등록은 제외',()=>{
  const text=[
    'function s.initial_effect(c)',
    '-- c:RegisterEffect(fake1)',
    '--[=[',
    'c:RegisterEffect(fake2)',
    ']=]',
    'local a="c:RegisterEffect(fake3)"',
    'local b=[[c:RegisterEffect(fake4)]]',
    'local e1=Effect.CreateEffect(c)',
    'c:RegisterEffect(e1)',
    'end'
  ].join('\n');
  const data=scanEffectRegistrations(lua(text));
  assert.deepEqual(data.registrations.map(x=>x.variable),['e1']);
});

test('펜듈럼 효과 ①과 몬스터 효과 ①은 서로 다른 항목',()=>{
  const effects=source('【펜듈럼 효과】\n①: P존에서 발동.\n【몬스터 효과】\n①: 특수 소환 시 발동.');
  const report=inspectEffectImplementation({sourceEffects:effects,script:lua(script)});
  assert.equal(report.source.length,2);
  assert.deepEqual(report.source.map(x=>x.section),['펜듈럼','몬스터']);
  assert.equal(report.state,'evidence_found');
  assert.match(report.notes,/자동 대응은 하지 않습니다/);
});

test('직접 등록 없어도 소환 헬퍼가 있으면 누락이라고 단정하지 않음',()=>{
  const report=inspectEffectImplementation({
    sourceEffects:source('①: 소환 조건.\n②: 적용 효과.'),
    script:lua('function s.initial_effect(c)\nLink.AddProcedure(c,nil,2)\nend')
  });
  assert.equal(report.registrationCount,0);
  assert.equal(report.helpers.length,1);
  assert.equal(report.state,'helper_review');
  assert.equal(implementationIssues(report).length,0);
});

test('헬퍼와 직접 등록이 모두 없으면 경고 후보, 확정 오류 아님',()=>{
  const report=inspectEffectImplementation({
    sourceEffects:source('①: 효과.\n②: 효과.'),
    script:lua('function s.initial_effect(c)\nlocal id=c:GetOriginalCode()\nend')
  });
  const issue=implementationIssues(report)[0];
  assert.equal(report.state,'no_direct_registration');
  assert.equal(issue.severity,'warning');
  assert.equal(issue.confidence,'review');
  assert.match(issue.detail,/공용 함수/);
});

test('Lua 미등록에서는 추가 오류를 만들지 않음',()=>{
  const report=inspectEffectImplementation({sourceEffects:source('①: 효과.'),script:null});
  assert.equal(report.state,'lua_unavailable');
  assert.equal(report.registrations.length,0);
  assert.equal(implementationIssues(report).length,0);
});

test('원문 없으면 CDB 번호 효과를 근거로 쓰되 구현 성공 확정 안 함',()=>{
  const report=inspectEffectImplementation({
    cdbEffects:source('①: 첫 효과.\n②: 두 효과.'),
    script:lua(script)
  });
  assert.equal(report.textBasis,'CDB');
  assert.equal(report.expectedCount,2);
  assert.equal(report.state,'evidence_found');
  assert.match(report.message,/미검증/);
});

test('실제 buildAudit에서 Lua 구조 근거와 수정 검토안을 연결',()=>{
  const result=buildAudit({
    cdbCards:[{id:'990470100',name:'천망성역－노에마',type:0x21,desc:'①: 첫 효과.\n②: 두 효과.\n③: 세 효과.',
      strings:[],origin:'천망성역.cdb'}],
    luaFiles:[lua(script)]
  });
  assert.equal(result.cards.length,1);
  const card=result.cards[0];
  assert.equal(card.effectImplementation.registrationCount,2);
  assert.ok(card.issues.some(x=>x.code==='EFFECT_REGISTRATION_COUNT_REVIEW'));
  assert.ok(buildCardPlan(card).steps.some(x=>x.code==='EFFECT_REGISTRATION_COUNT_REVIEW'));
});

test('효과 구조 보고서는 파일:줄번호와 번호 효과 기록, 통과 판정 금지',()=>{
  const result=buildAudit({
    cdbCards:[{id:'990470100',name:'천망성역－노에마',type:0x21,desc:'①: 효과 하나.\n②: 효과 둘.\n③: 효과 셋.',
      strings:[],origin:'천망성역.cdb'}],
    luaFiles:[lua(script)]
  });
  const markdown=implementationMarkdown(result,{theme:'천망성역'});
  assert.match(markdown,/c990470100\.lua:7/);
  assert.match(markdown,/번호 효과/);
  assert.match(markdown,/자동 대응은 하지 않습니다/);
  assert.doesNotMatch(markdown,/구현 완료|실전 통과|효과 정상 인증/);
});

test('UI는 효과 대조 필터·집중 읽기·안전한 텍스트 출력과 연결',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../src/audit-ui.js',import.meta.url),'utf8');
  const reader=readFileSync(new URL('../src/audit-reader.js',import.meta.url),'utf8');
  const panel=readFileSync(new URL('../src/effect-implementation-ui.js',import.meta.url),'utf8');
  assert.match(html,/id="effect-export"/);
  assert.match(html,/value="implementation"/);
  assert.match(html,/src\/effect-implementation\.css/);
  assert.match(ui,/createImplementationPanel/);
  assert.match(reader,/createImplementationPanel/);
  assert.match(panel,/textContent/);
  assert.doesNotMatch(panel,/innerHTML|eval\(/);
});
