import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseYdk,probabilityAtLeast} from '../src/deck-analysis.js';
import {cardIsMainEligible,eligibleCatalog,cleanRealOverrides,
  buildRealDeck,compareRealDeck,serializeEditedYdk,realDeckReportMarkdown,
  REAL_EDITOR_KEY} from '../src/deck-real-editor.js';

const starter='990470100',extender='990470101',risk='990470102',newId='990470199',extraId='990470301';
const fillers=Array.from({length:32},(_,i)=>String(990480200+i));
const original=parseYdk('#created by EDOPro\n#main\n'+[
  ...Array(3).fill(starter),...Array(2).fill(extender),...Array(3).fill(risk),...fillers
].join('\n')+'\n#extra\n'+extraId+'\n!side\n990470401\n','천망성역_40장.ydk');
const cdb=[
  {id:starter,name:'천망성역－노에마',type:0x21,origin:'천망성역.cdb'},
  {id:extender,name:'천망성역－라지엘',type:0x21,origin:'천망성역.cdb'},
  {id:risk,name:'천망성역－부담',type:0x2,origin:'천망성역.cdb'},
  {id:newId,name:'천망성역－연동 카드',type:0x2,origin:'천망성역.cdb'},
  {id:extraId,name:'천망성역－링크',type:0x4000021,origin:'천망성역.cdb'},
  {id:'990470500',name:'토큰',type:0x4001,origin:'천망성역.cdb'}
];
const opts={starterIds:[starter],extenderIds:[extender],riskIds:[risk],
  handSize:5,recipes:[{id:'ab',name:'노에마 + 라지엘',groupA:[starter],groupB:[extender]}]};

test('CDB에서 메인 덱 가능한 카드만 후보 등록, 링크·토큰 제외',()=>{
  const found=eligibleCatalog(cdb);
  assert.ok(found.some(x=>x.id===newId));
  assert.ok(found.some(x=>x.id===risk));
  assert.ok(!found.some(x=>x.id===extraId));
  assert.ok(!found.some(x=>x.id==='990470500'));
  assert.equal(cardIsMainEligible({type:0x4000021}),false);
  assert.equal(cardIsMainEligible({type:0x21}),true);
  assert.equal(cardIsMainEligible({type:0x2}),true);
  assert.equal(cardIsMainEligible({type:0}),false);
});

test('원본 YDK 카드 40장은 편집 없이 40장으로 유지되고 동일 효과',()=>{
  const edited=buildRealDeck(original,cdb,{});
  assert.equal(edited.valid,true);
  assert.equal(edited.deck.counts.main,40);
  assert.equal(edited.unchanged,true);
  assert.deepEqual(edited.deck.zones.extra,original.zones.extra);
  assert.deepEqual(edited.deck.zones.side,original.zones.side);
  assert.deepEqual(original.zones.main.slice(0,3),Array(3).fill(starter));
});

test('실제 CDB 카드 2장 추가 및 기존 카드 2장 삭제 → 40장 유지, 증감표 정확',()=>{
  const result=buildRealDeck(original,cdb,{[starter]:1,[newId]:2});
  assert.equal(result.valid,true);
  assert.equal(result.deck.counts.main,40);
  assert.equal(result.totalAdded,2);
  assert.equal(result.totalRemoved,2);
  assert.deepEqual(result.changes.map(x=>[x.id,x.before,x.after]),
    [[starter,3,1],[newId,0,2]]);
  assert.equal(result.deck.zones.main.filter(x=>x===starter).length,1);
  assert.equal(result.deck.zones.main.filter(x=>x===newId).length,2);
});

test('카드 새로 추가 후 41장 덱으로 내보낼 수 있고 원본은 그대로',()=>{
  const before=[...original.zones.main];
  const result=buildRealDeck(original,cdb,{[newId]:1});
  assert.equal(result.valid,true);
  assert.equal(result.deck.counts.main,41);
  const ydk=serializeEditedYdk(result);
  const again=parseYdk(ydk,'수정안.ydk');
  assert.deepEqual(again.zones.main,result.deck.zones.main);
  assert.deepEqual(again.zones.extra,original.zones.extra);
  assert.deepEqual(again.zones.side,original.zones.side);
  assert.equal(again.counts.main,41);
  assert.deepEqual(original.zones.main,before);
});

test('메인 덱 39장 및 61장이면 YDK 내보내기 차단',()=>{
  const tooSmall=buildRealDeck(original,cdb,{[starter]:1,[extender]:1});
  assert.equal(tooSmall.deck.counts.main,37);
  assert.equal(tooSmall.valid,false);
  assert.match(tooSmall.reason,/40~60장/);
  assert.throws(()=>serializeEditedYdk(tooSmall),/생성할 수 없습니다/);
  const long=buildRealDeck(original,cdb,{[newId]:3});
  assert.equal(long.valid,true);
  // 별도 최대 장수 검사: 61개를 가진 원본에서 추가함
  const oversized=parseYdk('#main\n'+Array.from({length:60},(_,i)=>String(991000000+i)).join('\n')+'\n#extra\n!side');
  const r=buildRealDeck(oversized,cdb,{[newId]:1});
  assert.equal(r.deck.counts.main,61);
  assert.equal(r.valid,false);
  assert.throws(()=>serializeEditedYdk(r),/생성할 수 없습니다/);
});

test('새 카드 ID를 등록되지 않은 값으로 임의 생성하지 못함',()=>{
  const cleaned=cleanRealOverrides(original,cdb,{['998877665']:3,[newId]:1,[starter]:2});
  assert.ok(!Object.prototype.hasOwnProperty.call(cleaned,'998877665'));
  assert.equal(cleaned[newId],1);
  const r=buildRealDeck(original,cdb,{['998877665']:3,[newId]:1});
  assert.equal(r.valid,true);
  assert.ok(!r.deck.zones.main.includes('998877665'));
});

test('잘못된 카드 매수·존재하지 않는 ID는 보관된 설정에서도 안전하게 제거',()=>{
  const raw={...Object.fromEntries(fillers.map(x=>[x,1])),
    [starter]:-3,[extender]:10,[risk]:1.5,[newId]:'2',garbage:3};
  const result=cleanRealOverrides(original,cdb,raw);
  assert.equal(result[newId],2);
  assert.ok(!Object.prototype.hasOwnProperty.call(result,starter));
  assert.ok(!Object.prototype.hasOwnProperty.call(result,extender));
  assert.ok(!Object.prototype.hasOwnProperty.call(result,risk));
  assert.ok(!Object.prototype.hasOwnProperty.call(result,'garbage'));
});

test('동일 ID가 메인과 사이드 합산 4장이면 내보내기 차단',()=>{
  const deck=parseYdk('#main\n'+Array(2).fill(starter).concat(Array.from({length:38},(_,i)=>String(996000000+i))).join('\n')
    +'\n#extra\n!side\n'+starter+'\n');
  const result=buildRealDeck(deck,cdb,{[starter]:3});
  assert.equal(result.valid,false);
  assert.match(result.errors.join(' '),/3장 제한/);
  assert.throws(()=>serializeEditedYdk(result),/생성할 수 없습니다/);
});

test('메인 덱에 링크 타입 카드가 이미 들어 있으면 타입 오류로 차단',()=>{
  const deck=parseYdk('#main\n'+extraId+'\n'+Array.from({length:39},(_,i)=>String(995000000+i)).join('\n')+'\n#extra\n!side');
  const result=buildRealDeck(deck,cdb);
  assert.equal(result.valid,false);
  assert.match(result.reason,/메인 덱 배치/);
});

test('CDB 미연결 원본 카드는 보존하지만 새로운 카드는 CDB에서만 추가',()=>{
  const result=buildRealDeck(original,cdb,{[starter]:2});
  assert.equal(result.valid,false); // 총 39장
  assert.equal(result.deck.zones.main.filter(x=>x===fillers[0]).length,1);
  assert.ok(result.warnings.some(x=>x.includes(fillers[0])));
  assert.equal(result.changes.length,1);
});

test('원본과 실제 수정 덱의 초동 확률은 각 장수를 바탕으로 계산',()=>{
  const cmp=compareRealDeck(original,cdb,{[starter]:2,[newId]:1},opts);
  assert.equal(cmp.valid,true);
  assert.equal(cmp.edited.size,40);
  assert.ok(Math.abs(cmp.baseline.starter-probabilityAtLeast(40,3,5))<1e-12);
  assert.ok(Math.abs(cmp.edited.starter-probabilityAtLeast(40,2,5))<1e-12);
  assert.ok(cmp.deltas.starter<0);
  assert.ok(cmp.edited.combo<cmp.baseline.combo);
  assert.equal(cmp.after.composition.spell,4); // 3장 부담 마법 + 1장 신규 마법
});

test('추가한 새 카드는 사용자가 지정하지 않는 한 초동으로 취급하지 않음',()=>{
  const cmp=compareRealDeck(original,cdb,{[newId]:1},opts);
  assert.equal(cmp.valid,true);
  assert.ok(Math.abs(cmp.edited.starter-probabilityAtLeast(41,3,5))<1e-12);
});

test('YDK 재파싱 후 원본 메인·엑스트라·사이드 구역과 매수 검증',()=>{
  const r=buildRealDeck(original,cdb,{[starter]:2,[newId]:1});
  assert.equal(r.valid,true);
  const output=serializeEditedYdk(r);
  assert.match(output,/#main\n/);
  assert.match(output,/#extra\n/);
  assert.match(output,/!side\n/);
  const again=parseYdk(output);
  assert.equal(again.total,r.deck.total);
  assert.equal(again.counts.extra,1);
  assert.equal(again.counts.side,1);
});

test('Markdown 보고서에 실제 카드 증감 및 확률·원본 보호 안내',()=>{
  const cmp=compareRealDeck(original,cdb,{[starter]:2,[newId]:1},opts);
  const text=realDeckReportMarkdown(cmp,opts);
  assert.match(text,/천망성역－노에마/);
  assert.match(text,/천망성역－연동 카드/);
  assert.match(text,/3장 → 2장/);
  assert.match(text,/0장 → 1장/);
  assert.match(text,/초동 1장 이상/);
  assert.match(text,/YDK 구조 검증: 통과/);
  assert.match(text,/금제·엔진 실행·실전 전개를 검증하지 않습니다/);
});

test('신규 UI는 실제 증감 패널과 YDK 다운로드, CDB 카드 검색 및 안전한 텍스트 출력',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../src/deck-real-editor-ui.js',import.meta.url),'utf8');
  const deckUI=readFileSync(new URL('../src/deck-lab-ui.js',import.meta.url),'utf8');
  for(const id of ['deck-real-dialog','deck-real-open','deck-real-current','deck-real-search',
    'deck-real-catalog','deck-real-diff','deck-real-counts','deck-real-metrics',
    'deck-real-preview','deck-real-ydk','deck-real-report','deck-real-reset']){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  assert.match(html,/V0\.8\.3/);
  assert.match(ui,/serializeEditedYdk/);
  assert.match(ui,/localStorage\.setItem/);
  assert.match(ui,/dialog\.showModal\(\)/);
  assert.match(deckUI,/realUI\.sync\(\)/);
  assert.match(deckUI,/realDeckReportMarkdown/);
  assert.doesNotMatch(ui,/innerHTML|eval\s*\(|XMLHttpRequest|fetch\s*\(/);
  assert.equal(REAL_EDITOR_KEY,'design-lab:real-deck-edits:v1');
});

test('V0.8.3.1: 실제 덱 래퍼의 parsed.zones.main에서 사용자 초동·연장·부담 분류를 읽는다',async()=>{
  const {selectionFromImportedDeck}=await import('../src/deck-selection.js');
  const wrapped={key:'test',name:'덱.ydk',parsed:original};
  const result=selectionFromImportedDeck(wrapped,{
    starterIds:[starter,starter,'999999999'],
    extenderIds:[extender],
    riskIds:[risk,'123456789']
  });
  assert.deepEqual(result,{starterIds:[starter],extenderIds:[extender],riskIds:[risk]});
  assert.deepEqual(selectionFromImportedDeck(null,{}),{
    starterIds:[],extenderIds:[],riskIds:[]
  });
  const ui=readFileSync(new URL('../src/deck-lab-ui.js',import.meta.url),'utf8');
  assert.match(ui,/selectionFromImportedDeck\(deck,tags\[deck\?\.key\]\|\|\{\}\)/);
});
test('V0.8.3.1: 4,000종 이후와 20,000행 이후 CDB 카드도 검색 후보에서 사라지지 않는다',()=>{
  const large=Array.from({length:20010},(_,i)=>({
    id:String(995000000+i),name:'시험 카드 '+i,type:0x2,origin:'대형.cdb'
  }));
  const catalog=eligibleCatalog(large);
  assert.equal(catalog.length,20010);
  assert.equal(catalog[4000].id,large[4000].id);
  assert.equal(catalog[20009].id,large[20009].id);
  assert.equal(eligibleCatalog(large,35).length,35);
});
test('V0.8.3.1: 빈 매수 입력·불리언·공백을 0장 삭제로 해석하지 않는다',async()=>{
  const {parseRealCopyCount}=await import('../src/deck-real-editor.js');
  for(const invalid of ['', '   ',false,true,null,undefined,'0.0','04','-1','4']){
    assert.equal(parseRealCopyCount(invalid),null,String(invalid));
  }
  assert.equal(parseRealCopyCount('0'),0);
  assert.equal(parseRealCopyCount(3),3);
  const clean=cleanRealOverrides(original,cdb,{[starter]:'',[extender]:'  ',[newId]:'2'});
  assert.equal(clean[starter],undefined);
  assert.equal(clean[extender],undefined);
  assert.equal(clean[newId],2);
  const ui=readFileSync(new URL('../src/deck-real-editor-ui.js',import.meta.url),'utf8');
  assert.match(ui,/const n=parseRealCopyCount\(value\)/);
});
test('V0.8.3.1: CDB 동일 ID의 다른 정의는 후보 제외, 해당 카드 사용 시 내보내기 차단',async()=>{
  const {conflictingCdbIds}=await import('../src/deck-real-editor.js');
  const conflicting=[...cdb,{id:newId,name:'다른 카드',type:0x2,desc:'바뀐 효과',origin:'겹친.cdb'}];
  assert.ok(conflictingCdbIds(conflicting).has(newId));
  assert.ok(!eligibleCatalog(conflicting).some(c=>c.id===newId));
  assert.equal(buildRealDeck(original,conflicting,{}).valid,true);
  const occupied=[...cdb,{id:starter,name:'동일 ID 다른 타입',type:0x4000021,origin:'충돌.cdb'}];
  const built=buildRealDeck(original,occupied,{});
  assert.equal(built.valid,false);
  assert.match(built.errors.join(' '),/CDB 카드 정의.*충돌/);
  assert.throws(()=>serializeEditedYdk(built),/생성할 수 없습니다/);
});
test('V0.8.3.1: 동일 내용 CDB 복수 등록은 중복 ID 충돌로 보지 않는다',async()=>{
  const {conflictingCdbIds}=await import('../src/deck-real-editor.js');
  const copied=[...cdb,{...cdb[0],origin:'복사본.cdb'}];
  assert.equal(conflictingCdbIds(copied).size,0);
  assert.equal(buildRealDeck(original,copied,{}).valid,true);
});
test('V0.8.3.1: 동일 ID가 서로 떨어져 있어도 무수정 YDK 순서를 정확히 보존한다',()=>{
  const arranged=[starter,fillers[0],starter,extender,risk,starter,extender,
    ...fillers.slice(1),risk,risk];
  assert.equal(arranged.length,40);
  const deck=parseYdk('#main\n'+arranged.join('\n')+'\n#extra\n'+extraId+'\n!side\n');
  const result=buildRealDeck(deck,cdb,{});
  assert.equal(result.valid,true);
  assert.deepEqual(result.deck.zones.main,arranged);
  assert.deepEqual(parseYdk(serializeEditedYdk(result)).zones.main,arranged);
});
