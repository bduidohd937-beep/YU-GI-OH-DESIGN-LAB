import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isOptionalInstallPath, versionFromFilename, compareVersions, resolveLuaRevision } from '../src/package-versions.js';
import { buildAudit } from '../src/audit.js';

const base = {
  name:'script/c990470109.lua',
  origin:'천망성역_V0.9.1_CDB_Lua_안정화_독립설치패키지.zip / script/c990470109.lua',
  text:'local s,id=GetID()\nfunction s.initial_effect(c)\nlocal e1=Effect.CreateEffect(c)\nc:RegisterEffect(e1)\nend'
};
const patched = {
  name:'script/c990470109.lua',
  origin:'천망성역_V0.9.2_역사의역전_라지엘_긴급패치.zip / script/c990470109.lua',
  text:'local s,id=GetID()\nfunction s.initial_effect(c)\nlocal e1=Effect.CreateEffect(c)\ne1:SetCode(EVENT_CHAINING)\nc:RegisterEffect(e1)\nend'
};
const card={id:'990470109',name:'천망성역－대천감시자 라지엘',desc:'①: 타이밍 검토.',type:0x4000021,origin:'Cheonmang_V0_9.cdb',strings:[]};

test('선택 설치 하위 폴더는 경로와 구분자에 관계없이 인식',()=>{
  assert.equal(isOptionalInstallPath('공용_아벨_선택설치/Abel_Shared_V0_2_Provisional.cdb'),true);
  assert.equal(isOptionalInstallPath('공용_아벨_선택설치\\c990470200.lua'),true);
  assert.equal(isOptionalInstallPath('optional_install/bonus.cdb'),true);
  assert.equal(isOptionalInstallPath('script/c990470109.lua'),false);
  assert.equal(isOptionalInstallPath('문서/천망성역_V0.9_전체카드_최종개정원문.txt'),false);
});

test('실제 ZIP 이름에서 V0.9.1과 V0.9.2를 읽고 숫자 비교',()=>{
  assert.deepEqual(versionFromFilename(base.origin),[0,9,1]);
  assert.deepEqual(versionFromFilename(patched.origin),[0,9,2]);
  assert.ok(compareVersions(versionFromFilename(base.origin),versionFromFilename(patched.origin))<0);
  assert.equal(versionFromFilename('시험패키지.zip'),null);
});

test('V0.9.1+V0.9.2 명시 긴급 패치는 파일 등록 순서에 무관하게 적용',()=>{
  for(const entries of [[base,patched],[patched,base]]){
    const result=resolveLuaRevision(entries);
    assert.equal(result.script.text,patched.text);
    assert.equal(result.conflict,false);
    assert.equal(result.patchApplied,true);
    assert.equal(result.label,'V0.9.2');
  }
});

test('버전 같거나 패치 근거 없으면 충돌 상태를 보존',()=>{
  const sameVersion={...patched,origin:base.origin};
  const unknown={...patched,origin:'파일명불명.zip'};
  const notPatch={...patched,origin:'천망성역_V0.9.3_전체패키지.zip / script/c990470109.lua'};
  for (const list of [[base,sameVersion],[base,unknown],[base,notPatch]]) {
    const r=resolveLuaRevision(list);
    assert.equal(r.conflict,true);
    assert.equal(r.patchApplied,false);
  }
});

test('중복 내용이 동일하면 실제 충돌로 처리하지 않음',()=>{
  const r=resolveLuaRevision([base,{...base,origin:'복사본.zip'}]);
  assert.equal(r.conflict,false);
  assert.equal(r.patchApplied,false);
});

test('buildAudit도 실제 긴급 패치를 우선 적용하고 오류 아닌 정보로 표시',()=>{
  const r=buildAudit({cdbCards:[card],luaFiles:[patched,base]});
  assert.equal(r.cards.length,1);
  assert.equal(r.cards[0].lua,patched.origin);
  assert.ok(r.cards[0].issues.some(x=>x.code==='LUA_PATCH_OVERLAY' && x.severity==='info'));
  assert.ok(!r.cards[0].issues.some(x=>x.code==='LUA_VERSION_CONFLICT'));
});

test('패키지 내 선택 설치 폴더는 자동 분석에서 제외하고 개별 업로드 경로는 유지',()=>{
  const source=readFileSync(new URL('../src/audit-ui.js',import.meta.url),'utf8');
  assert.match(source,/optional\.length/);
  assert.match(source,/isOptionalInstallPath\(e\.name\)/);
  assert.match(source,/개별 파일로 추가하면 분석할 수 있습니다/);
  assert.match(source,/const type = kind\(file\.name\)/);
});
