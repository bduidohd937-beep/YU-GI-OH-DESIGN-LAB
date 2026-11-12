// V0.8.2 — 가상 덱 장수/핵심 카드 매수 변경에 따른 시작 패 확률 비교.
// 원본 YDK 수정/실제 전개 검증/덱 성능 보증을 하지 않습니다.
import {probabilityAtLeast} from './deck-analysis.js';
import {analyzeComboRecipes,cleanComboRecipes} from './deck-combos.js';

export const SCENARIO_MIN=40;
export const SCENARIO_MAX=60;
export const SCENARIO_OBJECTIVES=Object.freeze({
  starter:{label:'초동 1장 이상',direction:'max'},
  combo:{label:'투핸드 하나 이상',direction:'max'},
  noStarter:{label:'초동 없는 패',direction:'min'},
  risk:{label:'부담 카드 1장 이상',direction:'min'},
  stranded:{label:'초동 없음 + 부담 카드',direction:'min'}
});
const mainIds=deck=>deck?.zones?.main||[];
const unique=values=>[...new Set((Array.isArray(values)?values:[]).map(String))];
const originalCounts=deck=>{
  const m=new Map();
  for(const id of mainIds(deck))m.set(id,(m.get(id)||0)+1);
  return m;
};
export function protectedCardIds(deck,{starterIds=[],extenderIds=[],riskIds=[],recipes=[]}={}){
  const inMain=new Set(mainIds(deck));
  const all=[
    ...unique(starterIds),...unique(extenderIds),...unique(riskIds),
    ...cleanComboRecipes(deck,recipes).flatMap(x=>[...x.groupA,...x.groupB])
  ];
  return [...new Set(all)].filter(id=>inMain.has(id)).sort();
}
export function sanitizeScenario(base,options={}){
  const protectedIds=protectedCardIds(base,options);
  const counts=originalCounts(base);
  const raw=options.copyOverrides&&typeof options.copyOverrides==='object'
    &&!Array.isArray(options.copyOverrides)?options.copyOverrides:{};
  const overrides={};
  for(const id of protectedIds){
    if(!Object.prototype.hasOwnProperty.call(raw,id))continue;
    const n=Number(raw[id]);
    if(Number.isInteger(n)&&n>=0&&n<=3)overrides[id]=n;
  }
  const defaultSize=mainIds(base).length;
  const target=Number(options.targetSize);
  return {targetSize:Number.isInteger(target)&&target>=SCENARIO_MIN&&target<=SCENARIO_MAX
      ?target:Math.max(SCENARIO_MIN,Math.min(SCENARIO_MAX,defaultSize)),
    copyOverrides:overrides,protectedIds,
    baseCopies:Object.fromEntries(protectedIds.map(id=>[id,counts.get(id)||0]))};
}
export function buildHypotheticalDeck(base,options={}){
  const source=mainIds(base);
  if(!source.length)return {valid:false,reason:'메인 덱이 없습니다.',deck:null};
  const config=sanitizeScenario(base,options);
  const chosen=[];
  const altered=[];
  for(const id of config.protectedIds){
    const before=config.baseCopies[id];
    const after=config.copyOverrides[id]??before;
    if(after>3)return {valid:false,reason:'보호 카드 '+id+'의 동일 카드 매수가 3장을 초과합니다. 원본 YDK를 검토하세요.',deck:null};
    for(let i=0;i<after;i++)chosen.push(id);
    if(before!==after)altered.push({id,before,after});
  }
  const neutralCount=config.targetSize-chosen.length;
  if(neutralCount<0)return {valid:false,reason:'선택한 카드 매수 '+chosen.length+'장이 목표 덱 '+config.targetSize+'장을 초과합니다.',deck:null};
  // 가상 슬롯은 가상의 실물 카드 종류/효과가 아님. 기존 비지정 카드풀의 통계적 자리만 나타냄.
  // 선택된 카드와 동일한 ID가 아님을 보장하는 별도 문자열.
  const virtual=Array.from({length:neutralCount},(_,i)=>'__scenario_neutral_'+i);
  const main=[...chosen,...virtual];
  return {
    valid:true,reason:null,altered,
    protectedCopies:chosen.length,neutralSlots:neutralCount,
    deck:{name:'가상 확률 시나리오',zones:{main,extra:[],side:[]},
      counts:{main:main.length,extra:0,side:0}}
  };
}
export function scenarioMetrics(deck,{starterIds=[],riskIds=[],recipes=[],handSize=5}={}){
  const main=mainIds(deck),n=main.length;
  const starters=unique(starterIds),risks=unique(riskIds);
  const starterCount=main.filter(id=>starters.includes(id)).length;
  const riskCount=main.filter(id=>risks.includes(id)).length;
  const starterSet=starters.length>0, riskSet=risks.length>0;
  const unionCount=main.filter(id=>starters.includes(id)||risks.includes(id)).length;
  const combo=analyzeComboRecipes(deck,recipes,handSize);
  // 레시피는 compareScenario에서 원본 YDK에 실제 존재하는 카드만 남깁니다.
  const definedRecipes=(Array.isArray(recipes)?recipes:[])
    .some(r=>Array.isArray(r.groupA)&&r.groupA.length&&Array.isArray(r.groupB)&&r.groupB.length);
  const noStarter=starterSet?probabilityAtLeast(n,n-starterCount,handSize,handSize):null;
  const noStarterNoRisk=starterSet&&riskSet?
    probabilityAtLeast(n,n-unionCount,handSize,handSize):null;
  return {
    size:n,handSize,
    starter:starterSet?probabilityAtLeast(n,starterCount,handSize,1):null,
    combo:definedRecipes?(combo.anyProbability??0):null,
    noStarter,
    risk:riskSet?probabilityAtLeast(n,riskCount,handSize,1):null,
    stranded:starterSet&&riskSet?Math.max(0,(noStarter??0)-(noStarterNoRisk??0)):null,
    starterCopies:starterCount,riskCopies:riskCount
  };
}
export function compareScenario(base,options={}){
  const trusted={...options,recipes:cleanComboRecipes(base,options.recipes)};
  const config=sanitizeScenario(base,trusted);
  const baseline=scenarioMetrics(base,trusted);
  const built=buildHypotheticalDeck(base,{...trusted,...config});
  if(!built.valid)return {valid:false,reason:built.reason,config,baseline,scenario:null,deltas:null};
  const scenario=scenarioMetrics(built.deck,trusted);
  const deltas={};
  for(const key of Object.keys(SCENARIO_OBJECTIVES)){
    const left=baseline[key],right=scenario[key];
    deltas[key]=left===null||right===null?null:right-left;
  }
  return {valid:true,reason:null,config,baseline,scenario,deltas,
    neutralSlots:built.neutralSlots,protectedCopies:built.protectedCopies,altered:built.altered};
}
export function compareDeckSizes(base,options={}){
  const rows=[];
  for(let size=SCENARIO_MIN;size<=SCENARIO_MAX;size++){
    const row=compareScenario(base,{...options,targetSize:size});
    rows.push({size,...row});
  }
  const objective=Object.prototype.hasOwnProperty.call(SCENARIO_OBJECTIVES,options.objective)
    ?options.objective:'starter';
  const direction=SCENARIO_OBJECTIVES[objective].direction;
  const eligible=rows.filter(r=>r.valid&&r.scenario[objective]!==null);
  eligible.sort((a,b)=>{
    const d=direction==='max'?b.scenario[objective]-a.scenario[objective]
      :a.scenario[objective]-b.scenario[objective];
    return Math.abs(d)>1e-12?d:
      Math.abs(a.size-mainIds(base).length)-Math.abs(b.size-mainIds(base).length)||
      a.size-b.size;
  });
  return {
    rows,objective,best:eligible[0]||null,
    baseline:scenarioMetrics(base,{...options,recipes:cleanComboRecipes(base,options.recipes)}),
    note:'비지정 카드 자리는 효과·매수 조합이 알려지지 않은 가상 중립 슬롯입니다. 선택 카드 매수만 가정대로 고정합니다. 단일 확률 지표가 높다는 이유로 실제 최적 덱이 되는 것은 아닙니다.'
  };
}
export function scenarioReportMarkdown(base,analysis,options={}){
  const scan=compareDeckSizes(base,options);
  const chosen=compareScenario(base,options);
  const fmt=p=>p===null?'미지정':(p*100).toFixed(2)+'%';
  const delta=p=>p===null?'—':(p>=0?'+':'')+(100*p).toFixed(2)+'%p';
  const label=new Map((analysis?.sections?.main||[]).map(c=>[c.id,c.name]));
  const lines=['# DESIGN LAB V0.8.2 — 덱 장수 가상 비교 보고서','',
    '원본: '+base.name+' · 메인 '+mainIds(base).length+'장',
    '시작 패 '+(options.handSize??5)+'장',
    '비교 지표: '+SCENARIO_OBJECTIVES[scan.objective].label,'',
    '> 실제 카드가 아닌 가상 중립 슬롯으로 장수를 조절합니다. 원본 YDK를 수정하지 않고, 최적 덱이나 실제 전개 성능을 보증하지 않습니다.','',
    '## 조정한 핵심 카드 매수',''];
  if(chosen.config.protectedIds.length){
    for(const id of chosen.config.protectedIds){
      const before=chosen.config.baseCopies[id],after=chosen.config.copyOverrides[id]??before;
      lines.push('- '+(label.get(id)||'미확인 카드')+' ['+id+']: '+before+'장 → '+after+'장');
    }
  }else lines.push('- 지정한 핵심 카드 없음');
  lines.push('','## 선택한 목표 덱', '',
    '목표 덱: '+chosen.config.targetSize+'장',
    '시뮬레이션 가능: '+(chosen.valid?'예':'아니요 ('+chosen.reason+')'),'');
  if(chosen.valid) {
    lines.push('지정 핵심 카드 '+chosen.protectedCopies+'장 · 가상 중립 슬롯 '+chosen.neutralSlots+'장','');
    for(const [key,info] of Object.entries(SCENARIO_OBJECTIVES)){
      lines.push('- '+info.label+': 원본 '+fmt(chosen.baseline[key])+
        ' / 가상 '+fmt(chosen.scenario[key])+' / 변화 '+delta(chosen.deltas[key]));
    }
  }
  lines.push('','## 40~60장 변화 비교','',
    '| 덱 장수 | '+SCENARIO_OBJECTIVES[scan.objective].label+' | 원본 대비 | 상태 |',
    '|---:|---:|---:|---|');
  for(const row of scan.rows){
    lines.push('| '+row.size+' | '+(row.valid?fmt(row.scenario[scan.objective]):'계산 불가')+
      ' | '+(row.valid?delta(row.deltas[scan.objective]):'—')+
      ' | '+(row.valid?'가상 비교':'보호 카드 초과')+' |');
  }
  lines.push('','동일 조건의 해당 지표 최상위: '+(scan.best?scan.best.size+'장 ('+
    fmt(scan.best.scenario[scan.objective])+')':'자료 미지정/계산 불가'), '',
    '> '+scan.note,'','OCG 금제·실제 전개 성공률·패말림 발생률은 별도 검증이 필요합니다.','');
  return lines.join('\n');
}
