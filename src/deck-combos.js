// V0.8.1 — 시작 패 정적 조합 분석. 임의 효과의 전개 가능성을 자동 판정하지 않습니다.
export const MAX_COMBO_RECIPES = 3;
const CAP = 2;
const MAX_DECK_CARDS = 250;
function combination(n,k) {
  if (!Number.isInteger(n) || !Number.isInteger(k) || n<0 || k<0 || k>n) return 0;
  let v=1;
  for(let i=1;i<=Math.min(k,n-k);i++) v=v*(n-Math.min(k,n-k)+i)/i;
  return v;
}
function chance(numer,denom){return denom>0?Math.max(0,Math.min(1,numer/denom)):null;}
const ids=(values,mainSet) => [...new Set((Array.isArray(values)?values:[]).filter(x=>typeof x==='string' && mainSet.has(x)))];
export function cleanComboRecipes(deck, recipes=[]) {
  const mainSet=new Set(deck?.zones?.main||[]);
  return (Array.isArray(recipes)?recipes:[]).slice(0,MAX_COMBO_RECIPES).map((raw,index)=>({
    id:(typeof raw?.id==='string' && /^[a-zA-Z0-9_-]{1,50}$/.test(raw.id))?raw.id:'combo-'+(index+1),
    name:(typeof raw?.name==='string'&&raw.name.trim()?raw.name.trim():'투핸드 조합 '+(index+1)).slice(0,55),
    groupA:ids(raw?.groupA,mainSet),
    groupB:ids(raw?.groupB,mainSet)
  }));
}
export function exactTwoCardProbability(deck,groupA=[],groupB=[],handSize=5){
  const main=deck?.zones?.main||[];
  const n=main.length;
  if(!Number.isInteger(handSize)||handSize<0||handSize>n||n<1||n>MAX_DECK_CARDS)return null;
  const set=new Set(main),a=new Set(ids(groupA,set)),b=new Set(ids(groupB,set));
  if(!a.size||!b.size)return null;
  let aOnly=0,bOnly=0,both=0,other=0;
  for(const id of main){
    const left=a.has(id),right=b.has(id);
    if(left&&right)both++;
    else if(left)aOnly++;
    else if(right)bOnly++;
    else other++;
  }
  const total=combination(n,handSize);
  let favorable=0;
  for(let i=0;i<=Math.min(aOnly,handSize);i++)
    for(let j=0;j<=Math.min(bOnly,handSize-i);j++)
      for(let k=0;k<=Math.min(both,handSize-i-j);k++){
        const filler=handSize-i-j-k;
        if(filler<0||filler>other||i+k<1||j+k<1||i+j+k<2)continue;
        favorable+=combination(aOnly,i)*combination(bOnly,j)*combination(both,k)*combination(other,filler);
      }
  return chance(favorable,total);
}
function cardMask(id,recipes) {
  let mask=0;
  for(let r=0;r<recipes.length;r++){
    if(recipes[r].groupA.includes(id)) mask|=1<<(2*r);
    if(recipes[r].groupB.includes(id)) mask|=2<<(2*r);
  }
  return mask;
}
function applyGroup(state,mask,t,recipeCount){
  if(!t)return state;
  let next=state;
  for(let r=0;r<recipeCount;r++){
    const m=(mask>>(2*r))&3;
    if(!m)continue;
    const shift=4*r;
    const old=(state>>shift)&15;
    const flags=(old&3)|m;
    const used=Math.min(CAP,(old>>2)+t);
    next=(next&~(15<<shift))|((flags|(used<<2))<<shift);
  }
  return next;
}
function anyRecipeCompleted(state,count) {
  for(let r=0;r<count;r++){
    const part=(state>>(4*r))&15;
    if((part&3)===3 && (part>>2)>=2)return true;
  }
  return false;
}
// 같은 시작 패가 여러 레시피를 만족해도 중복 합산하지 않는 정확 확률.
// 카드 ID별 소속 마스크별 장수를 묶어 조합 DP로 계산하므로 전체 패를 열거하지 않습니다.
export function exactAnyComboProbability(deck,recipes=[],handSize=5) {
  const main=deck?.zones?.main||[];
  const n=main.length;
  if(!Number.isInteger(handSize)||handSize<0||handSize>n||n<1||n>MAX_DECK_CARDS)return null;
  const valid=cleanComboRecipes(deck,recipes).filter(r=>r.groupA.length&&r.groupB.length);
  if(!valid.length)return null;
  const grouped=new Map();
  for(const id of main){
    const mask=cardMask(id,valid);
    grouped.set(mask,(grouped.get(mask)||0)+1);
  }
  let dp=Array.from({length:handSize+1},()=>new Map());
  dp[0].set(0,1);
  for(const [mask,count] of grouped){
    const next=Array.from({length:handSize+1},()=>new Map());
    for(let h=0;h<=handSize;h++)
      for(const [state,ways] of dp[h])
        for(let picked=0;picked<=Math.min(count,handSize-h);picked++){
          const newState=applyGroup(state,mask,picked,valid.length);
          const row=next[h+picked];
          row.set(newState,(row.get(newState)||0)+ways*combination(count,picked));
        }
    dp=next;
  }
  let favorable=0;
  for(const [state,ways] of dp[handSize])
    if(anyRecipeCompleted(state,valid.length)) favorable+=ways;
  return chance(favorable,combination(n,handSize));
}
export function analyzeComboRecipes(deck,recipes=[],handSize=5){
  const cleaned=cleanComboRecipes(deck,recipes);
  const result=cleaned.map(r=>({
    ...r,
    probability:exactTwoCardProbability(deck,r.groupA,r.groupB,handSize),
    ready:!!r.groupA.length&&!!r.groupB.length
  }));
  return {
    recipes:result,
    anyProbability:exactAnyComboProbability(deck,cleaned,handSize),
    activeCount:result.filter(r=>r.ready).length,
    note:'각 A군과 B군에서 서로 다른 실제 카드 2장이 패에 있어야 충족합니다. 여러 조합의 합집합은 겹치는 패를 중복 계산하지 않습니다. 실제 전개 가능성은 검증하지 않았습니다.'
  };
}
export function analyzeHandRisks(deck,{starterIds=[],riskIds=[],handSize=5}={}){
  const main=deck?.zones?.main||[];
  const n=main.length;
  if(!Number.isInteger(handSize)||handSize<0||handSize>n||n<1)return {
    n,handSize,starterCopies:0,riskCopies:0,noStarter:null,riskAtLeastOne:null,riskAtLeastTwo:null,noStarterAndRisk:null
  };
  const known=new Set(main),s=new Set(ids(starterIds,known)),r=new Set(ids(riskIds,known));
  const starterCopies=main.filter(id=>s.has(id)).length;
  const riskCopies=main.filter(id=>r.has(id)).length;
  const combined=main.filter(id=>s.has(id)||r.has(id)).length;
  const total=combination(n,handSize);
  const noStarter=starterCopies?chance(combination(n-starterCopies,handSize),total):null;
  const riskAtLeastOne=riskCopies?chance(total-combination(n-riskCopies,handSize),total):null;
  const riskAtLeastTwo=riskCopies?chance(total-combination(n-riskCopies,handSize)-
    riskCopies*combination(n-riskCopies,handSize-1),total):null;
  const noStarterAndRisk=starterCopies&&riskCopies
    ?chance(combination(n-starterCopies,handSize)-combination(n-combined,handSize),total):null;
  return {n,handSize,starterCopies,riskCopies,noStarter,riskAtLeastOne,riskAtLeastTwo,noStarterAndRisk,
    note:'위험 카드와 초동 카드는 사용자가 직접 지정한 분류입니다. 위험 카드가 반드시 패말림을 일으킨다는 뜻이 아니며, 패트랩·서치·발동 조건은 확률에 반영하지 않습니다.'};
}
export function comboResearchMarkdown(deck,analysis,{starterIds=[],riskIds=[],handSize=5,recipes=[]}={}){
  const combo=analyzeComboRecipes(deck,recipes,handSize);
  const risk=analyzeHandRisks(deck,{starterIds,riskIds,handSize});
  const pct=p=>p===null?'미지정/계산 불가':(100*p).toFixed(2)+'%';
  const names=new Map((analysis?.sections?.main||[]).map(x=>[x.id,x.name]));
  const list=arr=>arr.map(id=>(names.get(id)||id)+' ['+id+']').join(', ')||'(지정 없음)';
  const lines=['# DESIGN LAB V0.8.1 — 원핸드·투핸드 조합 및 패말림 위험','',
    '덱: '+deck.name,'메인 덱 '+deck.counts.main+'장 / 시작 패 '+handSize+'장','',
    '## 원핸드 초동·위험 카드','',
    '사용자가 지정한 원핸드 초동: '+list(starterIds),
    '사용자가 지정한 부담 카드: '+list(riskIds),'',
    '초동이 없는 패: '+pct(risk.noStarter),
    '부담 카드 ≥1장: '+pct(risk.riskAtLeastOne),
    '부담 카드 ≥2장: '+pct(risk.riskAtLeastTwo),
    '초동 없음 + 부담 카드 ≥1장: '+pct(risk.noStarterAndRisk),'',
    '> '+risk.note,'','## 투핸드 레시피',''];
  for(const [i,item] of combo.recipes.entries()){
    lines.push('### '+(i+1)+'. '+item.name,'',
      '- A군: '+list(item.groupA),'- B군: '+list(item.groupB),
      '- 서로 다른 실제 2장 확보 확률: '+pct(item.probability),'');
  }
  if(!combo.recipes.length)lines.push('투핸드 레시피를 아직 지정하지 않았습니다.','');
  lines.push('설정한 투핸드 레시피 중 하나 이상 충족: '+pct(combo.anyProbability),'',
    '> '+combo.note,'',
    '주의: 이 결과는 패에 특정 카드가 들어올 확률입니다. 실제 효과 발동, 콤보 전개 성공률, 승률, 금제 적합성을 검증하지 않았습니다.','');
  return lines.join('\n');
}
