// V0.8 — YDK 정적 덱 분석. 실전 전개 성공/승률은 계산하지 않습니다.
export const DECK_ZONES=Object.freeze({main:'메인',extra:'엑스트라',side:'사이드'});
export const DEFAULT_HAND=5;
export function parseYdk(text,name='덱.ydk'){
  if(typeof text!=='string'||text.length>1000000)throw new Error('YDK 텍스트가 없거나 1MB를 초과했습니다.');
  const zones={main:[],extra:[],side:[]},warnings=[];
  let zone=null, invalid=0;
  for(const [index,raw] of text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split('\n').entries()){
    const line=raw.trim();
    if(!line)continue;
    const lower=line.toLowerCase();
    if(lower==='#main'){zone='main';continue;}
    if(lower==='#extra'){zone='extra';continue;}
    if(lower==='!side'){zone='side';continue;}
    if(line.startsWith('#')||line.startsWith('!'))continue;
    // 표준 .ydk는 양의 정수 ID가 1줄에 1개 있어야 합니다.
    if(!/^[1-9]\d{0,11}$/.test(line)){
      invalid++;
      if(invalid<=8)warnings.push((index+1)+'행: 카드 ID가 아닌 줄은 제외했습니다 ('+line.slice(0,45)+')');
      continue;
    }
    if(!zone){warnings.push((index+1)+'행: 구역 표기(#main/#extra/!side) 이전 카드 ID는 제외했습니다.');continue;}
    zones[zone].push(line);
    if(Object.values(zones).reduce((n,items)=>n+items.length,0)>250)
      throw new Error('덱 항목이 250장을 초과해 파일 분석을 중단했습니다.');
  }
  if(invalid>8)warnings.push('잘못된 카드 ID 행이 총 '+invalid+'개이며 처음 8개만 표시했습니다.');
  const counts=Object.fromEntries(Object.entries(zones).map(([k,v])=>[k,v.length]));
  if(!counts.main&&!counts.extra&&!counts.side)warnings.push('분석 가능한 카드 ID가 없습니다.');
  if(counts.main<40||counts.main>60)warnings.push('메인 덱 '+counts.main+'장 — 일반적인 구성 범위 40~60장을 벗어났습니다.');
  if(counts.extra>15)warnings.push('엑스트라 덱 '+counts.extra+'장 — 일반적인 상한 15장 초과.');
  if(counts.side>15)warnings.push('사이드 덱 '+counts.side+'장 — 일반적인 상한 15장 초과.');
  const all=Object.values(zones).flat(),freq=new Map();
  for(const id of all)freq.set(id,(freq.get(id)||0)+1);
  for(const [id,n] of freq)if(n>3)warnings.push('ID '+id+' 전체 '+n+'장 — 기본 동일 카드 3장 제한 초과 의심.');
  const duplicatesAcrossZones=[...new Set(zones.main.filter(id=>zones.extra.includes(id)))];
  if(duplicatesAcrossZones.length)warnings.push('메인·엑스트라에 동시에 들어간 ID '+duplicatesAcrossZones.length+'종 — 카드 종류/구역을 확인하세요.');
  return {name,zones,counts,total:all.length,warnings,ids:[...freq.keys()]};
}
export function collapseZone(ids=[]){
  const counts=new Map();
  for(const id of ids)counts.set(id,(counts.get(id)||0)+1);
  return [...counts.entries()].map(([id,count])=>({id,count}));
}
export function analyzeDeck(deck,cdbCards=[]){
  const lookup=new Map();
  for(const c of cdbCards){const key=String(c.id);if(key)lookup.set(key,c);}
  const sections={};let unresolved=0;
  const zoneNames=Object.keys(DECK_ZONES);
  for(const zone of zoneNames){
    sections[zone]=collapseZone(deck.zones[zone]).map(row=>{
      const card=lookup.get(row.id);
      if(!card)unresolved+=row.count;
      return {...row,name:card?.name||'미확인 카드 '+row.id,
        type:card?.type??null,known:!!card,origin:card?.origin||null};
    });
  }
  const main=sections.main;
  const monster=main.filter(row=>row.type!==null&&(row.type&0x1)).reduce((s,x)=>s+x.count,0);
  const spell=main.filter(row=>row.type!==null&&(row.type&0x2)).reduce((s,x)=>s+x.count,0);
  const trap=main.filter(row=>row.type!==null&&(row.type&0x4)).reduce((s,x)=>s+x.count,0);
  const unknown=main.filter(row=>row.type===null).reduce((s,x)=>s+x.count,0);
  const placement=[];
  for(const row of sections.extra)if(row.type!==null &&
     !(row.type&(0x40|0x2000|0x800000|0x4000000)))
    placement.push('엑스트라 '+row.name+' ('+row.id+'): 카드 타입과 구역이 맞는지 확인');
  for(const row of sections.main)if(row.type!==null &&
     (row.type&(0x40|0x2000|0x800000|0x4000000)))
    placement.push('메인 '+row.name+' ('+row.id+'): 엑스트라 소환 타입이 메인 덱에 포함됨');
  return {deck,sections,cdbIndexed:lookup.size,unresolved,
    composition:{monster,spell,trap,unknown},warnings:[...deck.warnings,...placement]};
}
function comb(n,k){
  if(!Number.isInteger(n)||!Number.isInteger(k)||k<0||n<0||k>n)return 0;
  const r=Math.min(k,n-k);let x=1;
  for(let i=1;i<=r;i++)x=x*(n-r+i)/i;
  return x;
}
export function probabilityAtLeast(deckSize,hitCount,handSize=DEFAULT_HAND,atLeast=1){
  if(![deckSize,hitCount,handSize,atLeast].every(Number.isInteger)||deckSize<1||
    hitCount<0||hitCount>deckSize||handSize<0||handSize>deckSize||atLeast<1)
    return null;
  const ways=comb(deckSize,handSize);
  if(!ways)return null;
  let successes=0;
  for(let i=atLeast;i<=Math.min(hitCount,handSize);i++)
    successes+=comb(hitCount,i)*comb(deckSize-hitCount,handSize-i);
  return Math.max(0,Math.min(1,successes/ways));
}
export function analyzeOpeners(deck,{starterIds=[],extenderIds=[],handSize=5}={}){
  const main=deck.zones.main;const n=main.length;
  const starters=new Set(starterIds.map(String));
  const extenders=new Set(extenderIds.map(String));
  const first=main.filter(id=>starters.has(id)).length;
  const second=main.filter(id=>extenders.has(id)).length;
  const overlap=main.filter(id=>starters.has(id)&&extenders.has(id)).length;
  const union=first+second-overlap;
  // 포함배제. 겹치는 카드는 스타터와 익스텐더를 동시에 충족함.
  const total=comb(n,handSize);
  const starterPlusExtender=total ? Math.max(0,Math.min(1,
    (total-comb(n-first,handSize)-comb(n-second,handSize)+comb(n-union,handSize))/total)) : null;
  return {n,handSize,first,second,overlap,union,
    atLeastOne:probabilityAtLeast(n,first,handSize,1),
    atLeastTwo:probabilityAtLeast(n,first,handSize,2),
    starterPlusExtender,
    note:'직접 선택한 초동·연장 카드가 시작 패에 잡힐 조합 확률입니다. 카드 효과의 발동 가능성, 전개 성공률, 방해 관통력 또는 승률이 아닙니다.'};
}
export function deckReportMarkdown(analysis,opener){
  const {deck,sections,composition,warnings}=analysis;
  const rate=x=>x===null?'계산 불가':(x*100).toFixed(2)+'%';
  const lines=[
    '# DESIGN LAB V0.8 — 덱 구성·패 확률 정적 분석','',
    '파일: '+deck.name,
    '메인 '+deck.counts.main+'장 / 엑스트라 '+deck.counts.extra+'장 / 사이드 '+deck.counts.side+'장',
    '메인 타입: 몬스터 '+composition.monster+' / 마법 '+composition.spell+
      ' / 함정 '+composition.trap+' / 미확인 '+composition.unknown,
    'CDB 미연결 카드 수(장수 기준): '+analysis.unresolved,'',
    '## 사용자 지정 초동 확률','',
    '시작 패: '+opener.handSize+'장 · 초동 '+opener.first+'장 · 연장 '+opener.second+
      '장 · 중복 지정 '+opener.overlap+'장',
    '초동 1장 이상: '+rate(opener.atLeastOne),
    '초동 2장 이상: '+rate(opener.atLeastTwo),
    '초동과 연장 각각 1장 이상: '+rate(opener.starterPlusExtender),'',
    '> '+opener.note,''
  ];
  for(const zone of Object.keys(DECK_ZONES)){
    lines.push('## '+DECK_ZONES[zone]+' 덱 ('+deck.counts[zone]+'장)','');
    for(const row of sections[zone])
      lines.push('- '+row.count+'× '+row.name+' ['+row.id+']'+(row.known?'':' (CDB 미확인)'));
    lines.push('');
  }
  lines.push('## 확인할 항목','',...(warnings.length?warnings.map(w=>'- '+w):['현재 정적 검사 경고 없음.']),'',
    'OCG 최신 금제·룰 적합성, 실제 전개 성공률 및 덱 강도는 검사하지 않았습니다.','');
  return lines.join('\n');
}
