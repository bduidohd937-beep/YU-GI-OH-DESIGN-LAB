import test from 'node:test';
import assert from 'node:assert/strict';
import { stripLuaComments, lineAt, scanLuaFile } from '../src/lua-inspector.js';
import { buildAudit, auditMarkdown } from '../src/audit.js';

const file = (text, name = 'c990470100.lua') => ({ name: 'script/' + name, origin: '테스트.zip/script/' + name, text });
const card = (strings = []) => ({id:'990470100', name:'예언자 노에마', desc:'①: 테스트', strings, origin:'테스트.cdb',type:0x21});

test('Lua 줄 주석·블록 주석은 탐지하지 않으며 줄번호 보존', () => {
  const source = '-- aux.AddLinkProcedure(c)\n--[[\nXyz.AddProcedure(c,nil,4,99)\n]]\nlocal s,id=GetID()\nfunction s.initial_effect(c)\n Link.AddProcedure(c,nil,2)\nend';
  const result = scanLuaFile(file(source));
  assert.equal(result.length,0);
  assert.equal(lineAt(stripLuaComments(source),source.indexOf('Link.AddProcedure')),7);
});

test('현재 Link.AddProcedure는 구형 API 경고가 없어야 한다', () => {
  assert.ok(!scanLuaFile(file('function s.initial_effect(c)\n Link.AddProcedure(c,nil,2)\nend'))
    .some(x=>x.code==='LEGACY_LINK_HELPER'));
});

test('aux.AddLinkProcedure를 파일과 줄번호로 지적', () => {
  const results = scanLuaFile(file('local s,id=GetID()\nfunction s.initial_effect(c)\n aux.AddLinkProcedure(c,nil,2)\nend'));
  const issue = results.find(x=>x.code==='LEGACY_LINK_HELPER');
  assert.equal(issue?.line,3);
  assert.match(issue?.file,/c990470100\.lua/);
  assert.match(issue?.snippet,/aux\.AddLinkProcedure/);
  assert.equal(issue?.confidence,'static');
});

test('엑시즈 소재 인수 99는 지적하되 일반 상수 99는 무시', () => {
  const a = scanLuaFile(file('function s.initial_effect(c)\nXyz.AddProcedure(c,nil,4,99)\nend'));
  const b = scanLuaFile(file('function s.initial_effect(c)\nlocal x=99\nXyz.AddProcedure(c,nil,4,2)\nend'));
  assert.ok(a.some(x=>x.code==='XYZ_99_SENTINEL'));
  assert.ok(!b.some(x=>x.code==='XYZ_99_SENTINEL'));
});

test('CDB str1 비어 있을 때만 aux.Stringid(id,0) 경고', () => {
  const lua=file('function s.initial_effect(c)\n local d=aux.Stringid(id,0)\nend');
  assert.ok(scanLuaFile(lua,{card:card([''])}).some(x=>x.code==='DESCRIPTION_MISSING'));
  assert.ok(!scanLuaFile(lua,{card:card(['정상 설명'])}).some(x=>x.code==='DESCRIPTION_MISSING'));
});

test('공용 Lua가 업로드 목록에 없을 때 경고하되 존재하면 해제', () => {
  const lua=file('Duel.LoadScript("cheon_common.lua")\nfunction s.initial_effect(c) end');
  const opts={availableLuaNames:['c990470100.lua','cheon_common.lua']};
  assert.ok(scanLuaFile(lua).some(x=>x.code==='SHARED_SCRIPT_NOT_IMPORTED'));
  assert.ok(!scanLuaFile(lua,opts).some(x=>x.code==='SHARED_SCRIPT_NOT_IMPORTED'));
});

test('Noema 같은 복제된 특수소환 선택 유발 효과 타이밍 검토', () => {
  const input = 'function s.initial_effect(c)\nlocal e1=Effect.CreateEffect(c)\ne1:SetType(EFFECT_TYPE_SINGLE|EFFECT_TYPE_TRIGGER_O)\ne1:SetCode(EVENT_SUMMON_SUCCESS)\nlocal e2=e1:Clone()\ne2:SetCode(EVENT_SPSUMMON_SUCCESS)\nc:RegisterEffect(e2)\nend';
  const result=scanLuaFile(file(input));
  assert.ok(result.some(x=>x.code==='OPTIONAL_TRIGGER_TIMING'&&x.line===6&&x.confidence==='review'));
});

test('EFFECT_FLAG_DELAY 있는 선택 유발 효과는 타이밍 경고 생략', () => {
  const a='function s.initial_effect(c)\nlocal e1=Effect.CreateEffect(c)\ne1:SetType(EFFECT_TYPE_SINGLE|EFFECT_TYPE_TRIGGER_O)\ne1:SetCode(EVENT_SPSUMMON_SUCCESS)\ne1:SetProperty(EFFECT_FLAG_DELAY)\nend';
  const b='function s.initial_effect(c)\nlocal e1=Effect.CreateEffect(c)\ne1:SetType(EFFECT_TYPE_SINGLE|EFFECT_TYPE_TRIGGER_O)\ne1:SetProperty(EFFECT_FLAG_DELAY)\nlocal e2=e1:Clone()\ne2:SetCode(EVENT_SPSUMMON_SUCCESS)\nend';
  for(const input of [a,b]) assert.ok(!scanLuaFile(file(input)).some(x=>x.code==='OPTIONAL_TRIGGER_TIMING'));
});

test('REASON_LINK 단순 비교는 후보로 분류하고 비트마스크 비교는 통과', () => {
  const a='function s.initial_effect(c) end\nfunction s.con(e,tp,eg,ep,ev,re,r,rp) return r==REASON_LINK end';
  const b='function s.initial_effect(c) end\nfunction s.con(e,tp,eg,ep,ev,re,r,rp) return (r & REASON_LINK)~=0 end';
  assert.ok(scanLuaFile(file(a)).some(x=>x.code==='REASON_BITMASK_COMPARE'));
  assert.ok(!scanLuaFile(file(b)).some(x=>x.code==='REASON_BITMASK_COMPARE'));
});

test('GetOriginalAttack 사용은 오류 확정 아닌 엔진 호환 검토', () => {
  const r=scanLuaFile(file('function s.initial_effect(c)\nlocal a=c:GetOriginalAttack()\nend'));
  const f=r.find(x=>x.code==='ATTACK_API_COMPAT');
  assert.equal(f?.severity,'warning');
  assert.equal(f?.confidence,'review');
});

test('원문·CDB 없이 Lua만 등록해도 해당 파일의 정적 오류는 표시',()=>{
  const result=buildAudit({luaFiles:[file('function s.initial_effect(c)\naux.AddLinkProcedure(c,nil,2)\nend')]});
  assert.equal(result.cards.length,1);
  assert.ok(result.cards[0].issues.some(x=>x.code==='LEGACY_LINK_HELPER'));
  assert.equal(result.cards[0].lua,'테스트.zip/script/c990470100.lua');
});

test('교차 검수 결과의 Markdown에 Lua 파일명·줄번호·증거 문구 기록',()=>{
  const result=buildAudit({cdbCards:[card()],luaFiles:[file('function s.initial_effect(c)\naux.AddLinkProcedure(c,nil,2)\nend')]});
  const markdown=auditMarkdown(result);
  assert.match(markdown,/테스트\.zip\/script\/c990470100\.lua:2/);
  assert.match(markdown,/정적 코드 패턴 확인/);
  assert.match(markdown,/증거:/);
});
