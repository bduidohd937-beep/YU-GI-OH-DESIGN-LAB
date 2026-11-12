import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseYdk,analyzeDeck,analyzeOpeners} from '../src/deck-analysis.js';
import {MAX_COMBO_RECIPES,cleanComboRecipes,exactTwoCardProbability,
 exactAnyComboProbability,analyzeComboRecipes,analyzeHandRisks,comboResearchMarkdown} from '../src/deck-combos.js';

function deck(ids) {
  return parseYdk('#main\n'+ids.join('\n')+'\n#extra\n!side');
}
function choose(n,k){
  if(k<0||k>n)return 0;
  let x=1;for(let i=1;i<=k;i++)x=x*(n-i+1)/i;
  return x;
}
function bruteAny(ids,recipes,h){
  let good=0,total=0;
  function visit(start,chosen){
    if(chosen.length===h){
      total++;
      const actual=chosen.map(i=>ids[i]);
      if(recipes.some(r=>{
        for(let i=0;i<actual.length;i++)
          for(let j=0;j<actual.length;j++)
            if(i!==j&&r.groupA.includes(actual[i])&&r.groupB.includes(actual[j]))return true;
        return false;
      }))good++;
      return;
    }
    for(let i=start;i<ids.length;i++)visit(i+1,[...chosen,i]);
  }
  visit(0,[]);
  return total?good/total:null;
}
const tiny=['101010101','202020202','303030303','404040404'];
test('A/B 각 1장, 4장 덱에서 2장 패 확률 정확히 1/6',()=>{
 const d=deck(tiny);
 assert.ok(Math.abs(exactTwoCardProbability(d,[tiny[0]],[tiny[1]],2)-1/6)<1e-12);
});
test('같은 ID 1장은 투핸드 두 장으로 중복 처리하지 않음',()=>{
 const d=deck(tiny);
 assert.equal(exactTwoCardProbability(d,[tiny[0]],[tiny[0]],1),0);
 assert.equal(exactTwoCardProbability(d,[tiny[0]],[tiny[0]],2),0);
});
test('같은 카드 2장 복수 투입이면 2장을 동시에 뽑았을 때 투핸드 충족',()=>{
 const d=deck(['101010101','101010101','303030303','404040404']);
 assert.ok(Math.abs(exactTwoCardProbability(d,['101010101'],['101010101'],2)-1/6)<1e-12);
});
test('겹치는 A/B 후보라도 서로 다른 실물 카드 존재 여부로 판단',()=>{
 const d=deck(tiny);
 const both=['101010101'],a=['101010101','202020202'];
 assert.ok(Math.abs(exactTwoCardProbability(d,a,both,2)-1/6)<1e-12);
});
test('A·B 여러 장 후보와 중복 ID가 섞인 경우 물리적 조합 전수 검증',()=>{
 const ids=['101010101','101010101','202020202','303030303','303030303','404040404','505050505'];
 const d=deck(ids),recipes=[
  {id:'one',name:'A+B',groupA:['101010101','202020202'],groupB:['303030303','404040404']},
  {id:'two',name:'A+C',groupA:['101010101','303030303'],groupB:['202020202','505050505']}
 ];
 for(const h of [2,3,4,5,6]){
  const exact=exactAnyComboProbability(d,recipes,h);
  const brute=bruteAny(ids,recipes,h);
  assert.ok(Math.abs(exact-brute)<1e-12,'hand='+h+' '+exact+' / '+brute);
 }
});
test('개별 조합의 합계 대신 중복 제거한 합집합 확률 반환',()=>{
 const d=deck(['101010101','202020202','303030303','404040404','505050505']);
 const recipes=[
  {id:'one',name:'AB',groupA:['101010101'],groupB:['202020202']},
  {id:'two',name:'AC',groupA:['101010101'],groupB:['303030303']}
 ];
 const r=analyzeComboRecipes(d,recipes,3);
 assert.equal(r.recipes.length,2);
 assert.ok(r.anyProbability>r.recipes[0].probability);
 assert.ok(r.anyProbability<r.recipes[0].probability+r.recipes[1].probability);
});
test('0~3개 레시피와 덱에 없는 카드 ID는 정확하게 필터링',()=>{
 const d=deck(tiny);
 const raw=Array.from({length:5},(_,i)=>({
   id:'recipe-'+i,name:'시험 '+i,groupA:['101010101','998877665'],groupB:['202020202']
 }));
 const cleaned=cleanComboRecipes(d,raw);
 assert.equal(cleaned.length,MAX_COMBO_RECIPES);
 assert.deepEqual(cleaned[0].groupA,['101010101']);
 assert.equal(analyzeComboRecipes(d,[],2).anyProbability,null);
 assert.equal(exactTwoCardProbability(d,[],['101010101'],2),null);
 assert.equal(exactAnyComboProbability(d,[],2),null);
});
test('40장 3장 초동 + 2장 부담 카드의 복합 위험을 정확 조합으로 검증',()=>{
 const ids=[...Array(3).fill('101010101'),...Array(2).fill('202020202'),
   ...Array.from({length:35},(_,i)=>String(300000000+i))];
 const d=deck(ids);
 const risk=analyzeHandRisks(d,{starterIds:['101010101'],riskIds:['202020202'],handSize:5});
 const all=choose(40,5);
 assert.ok(Math.abs(risk.noStarter-choose(37,5)/all)<1e-12);
 assert.ok(Math.abs(risk.riskAtLeastOne-(1-choose(38,5)/all))<1e-12);
 assert.ok(Math.abs(risk.riskAtLeastTwo-choose(38,3)/all)<1e-12);
 assert.ok(Math.abs(risk.noStarterAndRisk-(choose(37,5)-choose(35,5))/all)<1e-12);
});
test('부담 카드가 전부 초동에도 포함되면 초동 없고 부담 카드 잡을 확률은 0',()=>{
 const d=deck(['101010101','101010101','202020202','303030303','404040404']);
 const r=analyzeHandRisks(d,{starterIds:['101010101'],riskIds:['101010101'],handSize:2});
 assert.equal(r.noStarterAndRisk,0);
});
test('지정이 없다면 위험이 0%라고 단정하지 않고 미지정 표시',()=>{
 const d=deck(tiny);
 const r=analyzeHandRisks(d,{handSize:2});
 assert.equal(r.noStarter,null);
 assert.equal(r.riskAtLeastOne,null);
 assert.equal(r.noStarterAndRisk,null);
 const md=comboResearchMarkdown(d,analyzeDeck(d),{handSize:2});
 assert.match(md,/미지정\/계산 불가/);
 assert.match(md,/실제 효과 발동/);
});
test('기존 초동+연장도 중복 카드 1장을 2장처럼 세지 않음',()=>{
 const d=deck(['101010101','101010101','202020202','303030303']);
 const r=analyzeOpeners(d,{starterIds:['101010101'],extenderIds:['101010101'],handSize:2});
 assert.ok(Math.abs(r.starterPlusExtender-1/6)<1e-12);
 assert.ok(r.starterPlusExtender<r.atLeastOne);
});
test('투핸드·패말림 보고서는 정의한 카드군과 실제 수치를 포함',()=>{
 const d=deck(tiny);
 const a=analyzeDeck(d);
 const md=comboResearchMarkdown(d,a,{handSize:2,starterIds:['101010101'],
 riskIds:['404040404'],recipes:[{id:'ab',name:'A+B 테스트',
  groupA:['101010101'],groupB:['202020202']}]});
 assert.match(md,/A\+B 테스트/);
 assert.match(md,/16\.67%/);
 assert.match(md,/초동 없음 \+ 부담 카드/);
 assert.match(md,/콤보 전개 성공률/);
});
test('편집창·위험 카드 UI가 자료실 및 기존 보고서와 연결되고 HTML 삽입 없음',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const main=readFileSync(new URL('../src/deck-lab-ui.js',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../src/deck-combos-ui.js',import.meta.url),'utf8');
 for(const id of ['deck-risk-metrics','deck-combo-summary','deck-combo-open','deck-combo-dialog',
  'deck-combo-close','deck-combo-add','deck-combo-recipe-list','deck-combo-editor-content']){
  assert.match(html,new RegExp('id="'+id+'"'));
 }
 assert.match(html,/V0\.8\.3/);
 assert.match(main,/comboResearchMarkdown/);
 assert.match(main,/riskIds/);
 assert.match(main,/comboUI\.sync\(\)/);
 assert.match(ui,/localStorage\.setItem/);
 assert.match(ui,/dialog\.showModal\(\)/);
 assert.match(ui,/textContent\s*=\s*text/);
 assert.doesNotMatch(ui,/innerHTML|eval\s*\(|XMLHttpRequest|fetch\s*\(/);
});
