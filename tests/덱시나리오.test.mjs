import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseYdk,analyzeDeck,probabilityAtLeast} from '../src/deck-analysis.js';
import {
  SCENARIO_MIN,SCENARIO_MAX,SCENARIO_OBJECTIVES,
  protectedCardIds,sanitizeScenario,buildHypotheticalDeck,scenarioMetrics,
  compareScenario,compareDeckSizes,scenarioReportMarkdown
} from '../src/deck-scenarios.js';

const starter='990470100',extender='990470101',risk='990470102';
const fill=Array.from({length:32},(_,i)=>String(990480200+i));
const raw=[...Array(3).fill(starter),...Array(2).fill(extender),
  ...Array(3).fill(risk),...fill];
const d=parseYdk('#main\n'+raw.join('\n')+'\n#extra\n!side','천망성역_40장.ydk');
const opts={starterIds:[starter],extenderIds:[extender],riskIds:[risk],
  recipes:[{id:'ab',name:'노에마+라지엘',groupA:[starter],groupB:[extender]}],
  handSize:5,targetSize:45,objective:'starter'};

test('40장 기준 원본·비조정 가상 40장 확률은 모든 지표에서 일치',()=>{
  assert.equal(d.counts.main,40);
  const cmp=compareScenario(d,{...opts,targetSize:40});
  assert.equal(cmp.valid,true);
  assert.equal(cmp.protectedCopies,8);
  assert.equal(cmp.neutralSlots,32);
  for(const key of Object.keys(SCENARIO_OBJECTIVES)){
    assert.ok(Math.abs(cmp.deltas[key])<1e-12,key+': '+cmp.deltas[key]);
  }
});

test('40→50장으로 중립 슬롯만 추가하면 초동 확률은 하락하며 정확 조합에 일치',()=>{
  const cmp=compareScenario(d,{...opts,targetSize:50});
  assert.equal(cmp.valid,true);
  assert.equal(cmp.neutralSlots,42);
  assert.ok(Math.abs(cmp.scenario.starter-probabilityAtLeast(50,3,5,1))<1e-12);
  assert.ok(Math.abs(cmp.baseline.starter-probabilityAtLeast(40,3,5,1))<1e-12);
  assert.ok(cmp.deltas.starter<0);
  assert.ok(cmp.scenario.combo<cmp.baseline.combo);
});

test('핵심 카드를 3→2, 2→3 바꾼 경우 변경된 매수를 실제 확률에 반영',()=>{
  const cmp=compareScenario(d,{...opts,targetSize:40,
    copyOverrides:{[starter]:2,[extender]:3}});
  assert.equal(cmp.valid,true);
  assert.deepEqual(cmp.altered.map(x=>[x.id,x.before,x.after]),
    [[starter,3,2],[extender,2,3]]);
  assert.ok(Math.abs(cmp.scenario.starter-probabilityAtLeast(40,2,5))<1e-12);
  assert.equal(cmp.scenario.size,40);
  assert.equal(cmp.protectedCopies,8);
});

test('시뮬레이터는 원본 YDK 덱 객체를 변경하지 않음',()=>{
  const original=[...d.zones.main];
  compareDeckSizes(d,{...opts,copyOverrides:{[starter]:0}});
  assert.deepEqual(d.zones.main,original);
  assert.equal(d.zones.main.filter(x=>x===starter).length,3);
});

test('초동 매수를 0으로 줄인 가상 덱은 초동 확률 0%, 초동 없는 패 100%',()=>{
  const cmp=compareScenario(d,{...opts,copyOverrides:{[starter]:0}});
  assert.equal(cmp.valid,true);
  assert.equal(cmp.scenario.starter,0);
  assert.equal(cmp.scenario.noStarter,1);
  assert.equal(cmp.scenario.combo,0);
});

test('부담 카드를 0장으로 줄이면 그 카드가 잡힐 확률과 복합 위험은 0%',()=>{
  const cmp=compareScenario(d,{...opts,copyOverrides:{[risk]:0}});
  assert.equal(cmp.valid,true);
  assert.equal(cmp.scenario.risk,0);
  assert.equal(cmp.scenario.stranded,0);
});

test('변경 대상은 원본 메인 덱에 있는 사용자가 지정한 카드 ID만',()=>{
  const cfg=sanitizeScenario(d,{
    ...opts,starterIds:[starter,'888888888'],
    copyOverrides:{[starter]:3,[risk]:1,['888888888']:3,[fill[0]]:2,[extender]:9},
    targetSize:1000
  });
  assert.deepEqual(cfg.protectedIds,[starter,extender,risk]);
  assert.deepEqual(cfg.copyOverrides,{[starter]:3,[risk]:1});
  assert.equal(cfg.targetSize,40);
  assert.equal(protectedCardIds(d,opts).length,3);
});

test('핵심 카드 수가 목표 덱 장수를 넘으면 실패로 표시하고 확률을 만들지 않음',()=>{
  const many=Array.from({length:41},(_,i)=>String(555000000+i));
  const big=parseYdk('#main\n'+many.join('\n')+'\n#extra\n!side');
  const cmp=compareScenario(big,{starterIds:many,targetSize:40,handSize:5});
  assert.equal(cmp.valid,false);
  assert.equal(cmp.scenario,null);
  assert.match(cmp.reason,/초과/);
});

test('원본에 보호 카드 4장이 있으면 잘못된 장수로 가정하지 않고 경고',()=>{
  const four=parseYdk('#main\n'+Array(4).fill(starter).join('\n')+
    '\n'+Array.from({length:36},(_,i)=>String(666000000+i)).join('\n')+'\n#extra\n!side');
  const built=buildHypotheticalDeck(four,{starterIds:[starter],targetSize:40});
  assert.equal(built.valid,false);
  assert.match(built.reason,/3장/);
});

test('40~60장 전 후보 21개를 만들고 단일 초동 확률 최상위가 40장',()=>{
  const scan=compareDeckSizes(d,opts);
  assert.equal(SCENARIO_MIN,40);
  assert.equal(SCENARIO_MAX,60);
  assert.equal(scan.rows.length,21);
  assert.equal(scan.rows[0].size,40);
  assert.equal(scan.rows[20].size,60);
  assert.equal(scan.best.size,40);
  assert.ok(scan.rows[0].scenario.starter>scan.rows[20].scenario.starter);
  assert.match(scan.note,/실제 최적 덱/);
});

test('사용자가 초동 지표를 지정하지 않았다면 최상위 후보를 억지로 만들지 않음',()=>{
  const scan=compareDeckSizes(d,{targetSize:45,handSize:5,objective:'starter'});
  assert.equal(scan.best,null);
  assert.equal(scan.baseline.starter,null);
  assert.ok(scan.rows.every(x=>x.valid));
});

test('부담 카드만 지정한 경우 부담 카드 확률이 낮은 장수를 조건부 상위로 표시',()=>{
  const scan=compareDeckSizes(d,{handSize:5,targetSize:45,objective:'risk',riskIds:[risk]});
  assert.equal(scan.best.size,60);
  assert.ok(scan.rows[0].scenario.risk>scan.rows[20].scenario.risk);
});

test('투핸드 후보의 실제 물리적 두 장 조건과 가상 덱 시뮬레이션이 일치',()=>{
  const cmp=compareScenario(d,{...opts,targetSize:40,
    copyOverrides:{[starter]:1,[extender]:1}});
  // 한 종류 A 1장, B 1장을 동시에 첫 5장에 포함할 확률 = 5×4/(40×39)
  const expected=5*4/(40*39);
  assert.ok(Math.abs(cmp.scenario.combo-expected)<1e-12);
  assert.ok(cmp.scenario.combo<cmp.baseline.combo);
});

test('보고서는 원본·가상 장수·변화율·명시적 가정과 표를 모두 포함',()=>{
  const md=scenarioReportMarkdown(d,analyzeDeck(d),opts);
  assert.match(md,/원본: 천망성역_40장\.ydk · 메인 40장/);
  assert.match(md,/목표 덱: 45장/);
  assert.match(md,/가상 중립 슬롯 37장/);
  assert.match(md,/원본 대비/);
  assert.match(md,/\| 60 \|/);
  assert.match(md,/원본 YDK를 수정하지 않고/);
  assert.match(md,/실제 전개 성공률/);
});

test('UI 연결: 모달·매수 입력·객관 지표·이중 보고서·브라우저 보관',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const app=readFileSync(new URL('../src/deck-lab-ui.js',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../src/deck-scenarios-ui.js',import.meta.url),'utf8');
  for(const id of ['deck-scenario-dialog','deck-scenario-open','deck-scenario-size',
    'deck-scenario-objective','deck-scenario-copies','deck-scenario-metrics',
    'deck-scenario-table-body','deck-scenario-export','deck-scenario-close',
    'deck-scenario-inline','deck-scenario-reset']){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  assert.match(html,/V0\.8\.2/);
  assert.match(app,/scenarioUI\.sync\(\)/);
  assert.match(app,/scenarioReportMarkdown/);
  assert.match(ui,/localStorage\.setItem/);
  assert.match(ui,/dialog\.showModal\(\)/);
  assert.match(ui,/textContent=value/);
  assert.doesNotMatch(ui,/innerHTML|eval\s*\(|XMLHttpRequest|fetch\s*\(/);
});
