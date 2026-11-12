// V0.8.3.1 — 실제 카드 증감·CDB 충돌·저장 데이터 입력 검증 안정화.
// 초동/금제/전개 성립은 자동 판정하지 않는다.
import {analyzeDeck,analyzeOpeners} from './deck-analysis.js';
import {scenarioMetrics,SCENARIO_OBJECTIVES} from './deck-scenarios.js';

export const REAL_EDITOR_KEY='design-lab:real-deck-edits:v1';
export const EXTRA_TYPE_MASK=0x40|0x2000|0x800000|0x4000000;
const TOKEN_MASK=0x4000;
const has=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);
const count=(ids)=>{
  const counts=new Map();
  for(const id of ids||[])counts.set(String(id),(counts.get(String(id))||0)+1);
  return counts;
};
const validId=id=>typeof id==='string'&&/^[1-9]\d{0,11}$/.test(id);
export function parseRealCopyCount(value){
  if(typeof value!=='string'&&typeof value!=='number')return null;
  const trimmed=String(value).trim();
  return /^[0-3]$/.test(trimmed)?Number(trimmed):null;
}
export function conflictingCdbIds(cdbCards=[]){
  const fingerprints=new Map(),conflicts=new Set();
  for(const card of Array.isArray(cdbCards)?cdbCards:[]){
    const id=String(card?.id??'');
    if(!validId(id))continue;
    // 동일 카드 정의가 다른 파일에 재수록된 경우는 충돌로 보지 않는다.
    const signature=JSON.stringify([Number(card.type),String(card.name||'').trim(),
      String(card.desc||'').trim()]);
    if(!fingerprints.has(id))fingerprints.set(id,signature);
    else if(fingerprints.get(id)!==signature)conflicts.add(id);
  }
  return conflicts;
}
export function cardIsMainEligible(card){
  const type=Number(card?.type);
  return card&&Number.isSafeInteger(type)&&type>0&&
    !!(type&(0x1|0x2|0x4))&&!(type&(EXTRA_TYPE_MASK|TOKEN_MASK));
}
export function eligibleCatalog(cdbCards=[],max=Number.POSITIVE_INFINITY){
  const unique=new Map(),conflicts=conflictingCdbIds(cdbCards);
  // 전체 CDB를 검색할 수 있도록 4,000종/20,000행 선행 절단을 제거한다.
  for(const c of Array.isArray(cdbCards)?cdbCards:[]){
    const id=String(c?.id??'');
    if(!conflicts.has(id)&&validId(id)&&cardIsMainEligible(c)&&!unique.has(id))unique.set(id,{
      id,name:String(c.name||('ID '+id)).slice(0,180),
      type:Number(c.type),origin:String(c.origin||'').slice(0,260)
    });
    if(unique.size>=max)break;
  }
  return [...unique.values()];
}
export function cleanRealOverrides(base,catalog=[],raw={}){
  const original=count(base?.zones?.main);
  const permitted=new Set([...original.keys(),...eligibleCatalog(catalog).map(c=>c.id)]);
  const result={};
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return result;
  for(const [id,value] of Object.entries(raw).slice(0,300)){
    if(!validId(id)||!permitted.has(id))continue;
    const n=parseRealCopyCount(value);
    if(n===null)continue;
    if(n!==(original.get(id)||0))result[id]=n;
  }
  return result;
}
export function buildRealDeck(base,cdbCards=[],rawOverrides={}){
  const source=base?.zones?.main||[];
  if(!source.length)return {valid:false,reason:'원본 메인 덱이 없습니다.',deck:null,changes:[],warnings:[]};
  const catalog=eligibleCatalog(cdbCards),known=new Map(catalog.map(c=>[c.id,c]));
  const original=count(source),overrides=cleanRealOverrides(base,cdbCards,rawOverrides);
  const updatedCount=new Map(original);
  for(const [id,n] of Object.entries(overrides)){
    if(n===0)updatedCount.delete(id);else updatedCount.set(id,n);
  }
  const main=[],pending=new Map(updatedCount);
  // 수정하지 않은 카드의 원래 순서와 중간에 섞여 있는 동일 ID도 유지한다.
  for(const id of source){
    const remaining=pending.get(id)||0;
    if(remaining>0){
      main.push(id);
      pending.set(id,remaining-1);
    }
  }
  // 증가 매수와 신규 카드는 원본 이후에 추가한다.
  for(const [id,n] of pending)for(let i=0;i<n;i++)main.push(id);
  const extra=[...(base.zones.extra||[])],side=[...(base.zones.side||[])];
  const zoneCounts={main:main.length,extra:extra.length,side:side.length};
  const warnings=[],errors=[];
  if(main.length<40||main.length>60)errors.push('메인 덱 '+main.length+'장: YDK 내보내기는 40~60장에서만 가능합니다.');
  if(extra.length>15||side.length>15)errors.push('엑스트라 또는 사이드 덱의 15장 상한을 초과했습니다.');
  if(!main.every(validId)||!extra.every(validId)||!side.every(validId))
    errors.push('YDK에 카드 ID 형식이 잘못된 항목이 있습니다.');
  const totals=count([...main,...extra,...side]);
  for(const [id,n] of totals)if(n>3)errors.push('ID '+id+'의 전체 매수가 '+n+'장으로 3장 제한을 초과합니다.');
  const conflicts=conflictingCdbIds(cdbCards);
  for(const id of conflicts)if(totals.has(id))
    errors.push('ID '+id+'의 CDB 카드 정의(이름·타입·설명)가 충돌합니다. 중복 CDB 파일을 정리하세요.');
  const allCdb=new Map((Array.isArray(cdbCards)?cdbCards:[]).map(c=>[String(c.id),c]));
  for(const [id,n] of updatedCount){
    const card=allCdb.get(id);
    // 새로 추가된 카드에 대해서는 반드시 CDB 메인 덱 타입 판정 필요.
    if(!original.has(id)&&n>0&&!known.has(id))
      errors.push('추가한 ID '+id+'은 메인 덱에 들어갈 수 있는 CDB 카드로 확인되지 않습니다.');
    if(original.has(id)&&card&&!cardIsMainEligible(card))
      errors.push('ID '+id+'은 CDB 카드 타입상 메인 덱 배치가 의심됩니다.');
    if(!card)warnings.push('ID '+id+'은 CDB 미연결 카드입니다. 기존 YDK 입력을 기반으로만 표시합니다.');
  }
  const changes=[];
  for(const id of new Set([...original.keys(),...updatedCount.keys()])){
    const before=original.get(id)||0,after=updatedCount.get(id)||0;
    if(before===after)continue;
    const info=allCdb.get(id);
    changes.push({id,name:String(info?.name||('CDB 미확인 ID '+id)),before,after,delta:after-before,
      source:info?.origin||null});
  }
  const total=main.length+extra.length+side.length;
  const deck={name:base.name,zones:{main,extra,side},
    counts:zoneCounts,total,ids:[...new Set([...main,...extra,...side])],warnings:[]};
  return {valid:!errors.length,reason:errors[0]||null,errors,warnings,deck,
    changes,overrides,totalAdded:changes.reduce((n,x)=>n+Math.max(0,x.delta),0),
    totalRemoved:changes.reduce((n,x)=>n+Math.max(0,-x.delta),0),
    unchanged:changes.length===0};
}
export function compareRealDeck(base,cdbCards=[],overrides={},options={}){
  const result=buildRealDeck(base,cdbCards,overrides);
  const baseline=scenarioMetrics(base,options);
  const edited=result.deck?scenarioMetrics(result.deck,options):null;
  const deltas={};
  for(const id of Object.keys(SCENARIO_OBJECTIVES))
    deltas[id]=!edited||baseline[id]===null||edited[id]===null?null:edited[id]-baseline[id];
  const original=analyzeDeck(base,cdbCards);
  const after=result.deck?analyzeDeck(result.deck,cdbCards):null;
  const originalHand=analyzeOpeners(base,options);
  const editedHand=result.deck?analyzeOpeners(result.deck,options):null;
  return {...result,baseline,edited,deltas,original,after,originalHand,editedHand};
}
export function serializeEditedYdk(result){
  if(!result?.valid||!result.deck)throw Error('메인 덱 장수·중복·카드 타입 검증을 통과하지 못해 YDK를 생성할 수 없습니다.');
  const {main,extra,side}=result.deck.zones;
  // EDOPro 표준 YDK 구역을 보존하고 카드 ID를 한 줄에 하나씩 기록한다.
  return ['#created by YU-GI-OH DESIGN LAB V0.8.3.1','#main',...main,
    '#extra',...extra,'!side',...side,''].join('\n');
}
export function realDeckReportMarkdown(comparison,options={}){
  const fmt=x=>x===null?'미지정':(100*x).toFixed(2)+'%';
  const pp=x=>x===null?'—':(x>=0?'+':'')+(100*x).toFixed(2)+'%p';
  const {original,after,changes,baseline,edited,deltas,valid,errors,warnings}=comparison;
  const lines=['# DESIGN LAB V0.8.3.1 — 실제 카드 증감 덱 비교','',
    '원본: '+original.deck.name,'메인 '+original.deck.counts.main+'장 → '+
      (after?.deck.counts.main??'?')+'장',
    '엑스트라 '+original.deck.counts.extra+'장 / 사이드 '+original.deck.counts.side+'장 (수정하지 않음)',
    'YDK 구조 검증: '+(valid?'통과':'내보내기 차단'),'',
    '> 이 결과는 사용자 직접 지정 카드 증감에 대한 구성 및 패 확률 비교입니다. 금제·엔진 실행·실전 전개를 검증하지 않습니다.','',
    '## 실제 카드 매수 변경',''];
  for(const card of changes){
    lines.push('- '+card.name+' ['+card.id+']: '+card.before+'장 → '+card.after+
      '장 ('+(card.delta>0?'+':'')+card.delta+')'+(card.source?' · '+card.source:''));
  }
  if(!changes.length)lines.push('- 변경 없음');
  lines.push('','## 패 확보 확률 (사용자 지정 분류)','');
  for(const [id,metric] of Object.entries(SCENARIO_OBJECTIVES)){
    lines.push('- '+metric.label+': 원본 '+fmt(baseline[id])+
      ' / 변경 '+fmt(edited?.[id]??null)+' / 차이 '+pp(deltas[id]));
  }
  lines.push('','## 카드 구성','',
    '원본 몬스터/마법/함정/미확인: '+Object.values(original.composition).join('/'),
    '변경 몬스터/마법/함정/미확인: '+(after?Object.values(after.composition).join('/'): '미계산'),'',
    '## 검증·확인 항목','');
  for(const x of [...errors,...warnings])lines.push('- '+x);
  if(!errors.length&&!warnings.length)lines.push('- 기본 YDK 구조 검사 경고 없음');
  lines.push('','선택하지 않은 카드는 초동·연장·부담으로 자동 분류되지 않습니다.','',
    'OCG 금제/제한, 카드 이름별 중복 판정, 카드 효과의 실제 실행과 덱 성능은 별도 검증 대상입니다.','');
  return lines.join('\n');
}
