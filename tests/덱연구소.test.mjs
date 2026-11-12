import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseYdk,collapseZone,analyzeDeck,probabilityAtLeast,analyzeOpeners,deckReportMarkdown} from '../src/deck-analysis.js';

const sample=['#created by EDOPro','#main',
 '990470100','990470100','990470100','990470101','990470101',
 ...Array.from({length:35},(_,i)=>String(990470200+i)),
 '#extra','990470301','990470302','!side','990470401','990470401'].join('\r\n');
const cdb=[
 {id:'990470100',name:'천망성역－노에마',type:0x21,origin:'천망성역.cdb'},
 {id:'990470101',name:'천망성역－라지엘',type:0x21,origin:'천망성역.cdb'},
 {id:'990470301',name:'천망성역－감시자',type:0x4000021,origin:'천망성역.cdb'}
];

test('정상 YDK 메인 40·엑스트라 2·사이드 2와 중복 장수 보존',()=>{
 const d=parseYdk(sample,'천망성역_시험덱.ydk');
 assert.deepEqual(d.counts,{main:40,extra:2,side:2});
 assert.equal(d.total,44);
 assert.equal(collapseZone(d.zones.main)[0].count,3);
 assert.equal(d.warnings.length,0);
});
test('BOM, CRLF, 주석과 표준 YDK 구역 처리',()=>{
 const d=parseYdk('\uFEFF#main\r\n123456789\r\n#comment\r\n#extra\r\n234567890\r\n!side\r\n345678901\r\n');
 assert.deepEqual(d.zones,{main:['123456789'],extra:['234567890'],side:['345678901']});
});
test('잘못된 줄과 구역 전 ID는 경고 후 건너뛰며 원본 ID를 만들지 않음',()=>{
 const d=parseYdk('123456789\n#main\nabc\n-345\n123456789\n#extra\n!side\n');
 assert.deepEqual(d.zones.main,['123456789']);
 assert.ok(d.warnings.some(x=>x.includes('구역 표기')));
 assert.ok(d.warnings.some(x=>x.includes('카드 ID가 아닌')));
});
test('덱 크기 고정 40장이 아니고 45·50·60장도 정상 구조',()=>{
 for(const n of [40,45,50,60]){
  const d=parseYdk('#main\n'+Array.from({length:n},(_,i)=>String(123456789+i)).join('\n')+'\n#extra\n!side');
  assert.equal(d.counts.main,n);
  assert.ok(!d.warnings.some(x=>x.includes('40~60')));
 }
});
test('장수 제한 및 동일 카드 4장, 메인+엑스트라 중복 의심 확인',()=>{
 const d=parseYdk('#main\n'+Array(4).fill('123456789').join('\n')+
  '\n#extra\n123456789\n'+Array(15).fill('234567890').join('\n')+
  '\n!side\n'+Array(16).fill('345678901').join('\n'));
 assert.ok(d.warnings.some(x=>x.includes('메인 덱 4장')));
 assert.ok(d.warnings.some(x=>x.includes('엑스트라 덱 16장')));
 assert.ok(d.warnings.some(x=>x.includes('사이드 덱 16장')));
 assert.ok(d.warnings.some(x=>x.includes('3장 제한')));
 assert.ok(d.warnings.some(x=>x.includes('동시에 들어간')));
});
test('악의적 대용량 또는 250장 초과 덱은 거절',()=>{
 assert.throws(()=>parseYdk('a'.repeat(1000001)),/1MB/);
 assert.throws(()=>parseYdk('#main\n'+Array(251).fill('123456789').join('\n')),/250장/);
});
test('CDB 실제 카드 이름·타입이 연결되고 미확인은 추정하지 않음',()=>{
 const a=analyzeDeck(parseYdk(sample),cdb);
 assert.equal(a.sections.main[0].name,'천망성역－노에마');
 assert.equal(a.sections.main[0].count,3);
 assert.equal(a.composition.monster,5);
 assert.equal(a.composition.unknown,35);
 assert.ok(a.sections.extra[1].name.startsWith('미확인 카드'));
 assert.equal(a.unresolved,39);
});
test('엑스트라 타입 카드가 메인에 있거나 비엑스트라가 엑스트라에 있으면 경고',()=>{
 const d=parseYdk('#main\n234567890\n#extra\n123456789\n!side');
 const a=analyzeDeck(d,[
 {id:'123456789',name:'일반 몬스터',type:0x11},
 {id:'234567890',name:'링크 몬스터',type:0x4000021}
 ]);
 assert.ok(a.warnings.some(x=>x.includes('엑스트라 소환 타입')));
 assert.ok(a.warnings.some(x=>x.includes('카드 타입과 구역')));
});
test('하이퍼지오메트릭 정확 확률: 40장 중 3장, 5장 패',()=>{
 const p=probabilityAtLeast(40,3,5);
 const expected=1-(37*36*35*34*33)/(40*39*38*37*36);
 assert.ok(Math.abs(p-expected)<1e-12);
 assert.equal(probabilityAtLeast(40,0,5),0);
 assert.equal(probabilityAtLeast(40,40,5),1);
 assert.equal(probabilityAtLeast(40,3,5,6),0);
 assert.equal(probabilityAtLeast(40,3,41),null);
});
test('연장 겹침을 포함배제로 계산하고 적어도 2장 확률을 따로 계산',()=>{
 const d=parseYdk(sample);
 const analysis=analyzeOpeners(d,{starterIds:['990470100'],extenderIds:['990470101'],handSize:5});
 assert.equal(analysis.first,3);assert.equal(analysis.second,2);assert.equal(analysis.overlap,0);
 assert.ok(analysis.starterPlusExtender>0&&analysis.starterPlusExtender<analysis.atLeastOne);
 assert.ok(analysis.atLeastTwo<analysis.atLeastOne);
 const same=analyzeOpeners(d,{starterIds:['990470100'],extenderIds:['990470100'],handSize:5});
 assert.equal(same.overlap,3);
 assert.ok(Math.abs(same.starterPlusExtender-same.atLeastOne)<1e-10);
});
test('5장과 6장 시작 패의 차이를 정확히 반영',()=>{
 const d=parseYdk(sample);
 const a=analyzeOpeners(d,{starterIds:['990470100'],handSize:5});
 const b=analyzeOpeners(d,{starterIds:['990470100'],handSize:6});
 assert.ok(b.atLeastOne>a.atLeastOne);
});
test('직접 선택 안 한 덱은 확률 0이지 덱 강도 0으로 표현하지 않음',()=>{
 const d=parseYdk(sample);
 const a=analyzeOpeners(d);
 assert.equal(a.first,0);assert.equal(a.atLeastOne,0);
 assert.match(a.note,/승률이 아닙니다/);
});
test('보고서에 40/2/2 장수, 미확인 ID, 확률과 제한을 구분',()=>{
 const d=parseYdk(sample);
 const a=analyzeDeck(d,cdb);
 const opener=analyzeOpeners(d,{starterIds:['990470100']});
 const md=deckReportMarkdown(a,opener);
 assert.match(md,/메인 40장 \/ 엑스트라 2장 \/ 사이드 2장/);
 assert.match(md,/미확인 카드/);
 assert.match(md,/초동 1장 이상:/);
 assert.match(md,/실제 전개 성공률/);
 assert.doesNotMatch(md,/승률 검증 완료/);
});
test('덱 연구소 HTML과 저장 자료·CDB 데이터 연결',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../src/deck-lab-ui.js',import.meta.url),'utf8');
 const storage=readFileSync(new URL('../src/storage-ui.js',import.meta.url),'utf8');
 const audit=readFileSync(new URL('../src/audit-ui.js',import.meta.url),'utf8');
 for(const id of ['deck-select','deck-summary','deck-zones','deck-opener-list',
  'deck-hand-size','deck-export','deck-import','deck-prob-metrics','deck-warnings']){
   assert.match(html,new RegExp('id="'+id+'"'));
 }
 assert.match(storage,/refreshDeck\(files\)/);
 assert.match(storage,/\$\('deck-import'\)/);
 assert.match(audit,/designlab:audit-data/);
 assert.match(ui,/addEventListener\('designlab:audit-data'/);
 assert.match(ui,/textContent/);
 assert.doesNotMatch(ui,/innerHTML|eval\s*\(|XMLHttpRequest/);
});
