// V0.8 — 저장된 YDK 덱을 브라우저에서만 분석. CDB는 기존 교차 검수의 읽기 결과를 재사용합니다.
import {parseYdk,analyzeDeck,analyzeOpeners,deckReportMarkdown,DECK_ZONES} from './deck-analysis.js';
import {createDeckComboUI} from './deck-combos-ui.js';
import {comboResearchMarkdown} from './deck-combos.js';

const $=id=>document.getElementById(id);
const make=(tag,cls='',text)=>{
  const node=document.createElement(tag);
  if(cls)node.className=cls;
  if(text!==undefined)node.textContent=text;
  return node;
};
const KEY='design-lab:deck-openers:v1';
let decks=[],selectedKey=null,cdbCards=[],tags={};
let handSize=5;
const comboUI=createDeckComboUI({
  getDeck:current,getAnalysis:currentAnalysis,getHandSize:()=>handSize,
  getSelection:()=>selection(current())
});
try{const saved=JSON.parse(localStorage.getItem(KEY)||'{}');
  if(saved&&typeof saved==='object'&&!Array.isArray(saved))tags=saved;
}catch{/* storage blocked or malformed: temporary selection */}
function saveTags(){
  try{localStorage.setItem(KEY,JSON.stringify(tags));}catch{/* session-only */}
}
function hash(value){
  let code=2166136261;
  for(let i=0;i<value.length;i++)code=Math.imul(code^value.charCodeAt(i),16777619);
  return (code>>>0).toString(16);
}
function setMessage(text,error=false){
  const div=$('deck-message');
  div.textContent=text;div.classList.toggle('is-error',error);
}
function safeFileName(value){
  return value.replace(/[\\/:*?"<>|]/g,'_').slice(0,90);
}
function current(){
  const found=decks.find(x=>x.key===selectedKey);
  return found||decks[0]||null;
}
function selection(deck){
  const record=tags[deck.key]||{};
  const present=new Set(deck.zones.main);
  return {
    starterIds:(Array.isArray(record.starterIds)?record.starterIds:[]).filter(id=>present.has(id)),
    extenderIds:(Array.isArray(record.extenderIds)?record.extenderIds:[]).filter(id=>present.has(id)),
    riskIds:(Array.isArray(record.riskIds)?record.riskIds:[]).filter(id=>present.has(id))
  };
}
function setTag(deck,id,type,checked){
  if(!tags[deck.key])tags[deck.key]={starterIds:[],extenderIds:[]};
  const key=type==='starter'?'starterIds':type==='extender'?'extenderIds':'riskIds';
  const next=new Set(tags[deck.key][key]||[]);
  if(checked)next.add(id);else next.delete(id);
  tags[deck.key][key]=[...next];
  saveTags();
}
function currentAnalysis(){
  const deck=current();
  if(!deck)return null;
  return analyzeDeck(deck.parsed,cdbCards);
}
function renderProb(analysis){
  const deck=current(),sel=selection(deck);
  const opener=analyzeOpeners(analysis.deck,{...sel,handSize});
  const pct=x=>x===null?'계산 불가':(100*x).toFixed(2)+'%';
  const container=$('deck-prob-metrics');
  container.replaceChildren();
  for(const [label,value,note] of [
    ['초동 ≥1장',pct(opener.atLeastOne),'시작 패 '+handSize+'장'],
    ['초동 ≥2장',pct(opener.atLeastTwo),'직접 지정 '+opener.first+'장'],
    ['초동 + 연장',pct(opener.starterPlusExtender),'서로 다른 실제 2장'],
    ['지정 카드 총수',String(opener.union)+'장','중복 지정 '+opener.overlap+'장 제외']
  ]){
    const card=make('div','deck-prob-card');
    card.append(make('span','',label),make('strong','',value),make('small','',note));
    container.append(card);
  }
}
function renderTags(analysis){
  const deck=current(),selected=selection(deck);
  const parents=$('deck-opener-list');
  parents.replaceChildren();
  if(!analysis.sections.main.length){
    parents.append(make('p','deck-empty','메인 덱 카드가 없어 초동을 지정할 수 없습니다.'));
    return;
  }
  for(const row of analysis.sections.main){
    const item=make('div','deck-opener-item');
    const name=make('span','deck-opener-name',row.name);
    name.append(make('small','',row.count+'장'));
    const controls=make('div','deck-tag-choice');
    for(const [kind,label,ids] of [
      ['starter','초동',selected.starterIds],
      ['extender','연장',selected.extenderIds],
      ['risk','부담',selected.riskIds]
    ]){
      const holder=make('label');
      const checkbox=make('input');checkbox.type='checkbox';checkbox.checked=ids.includes(row.id);
      checkbox.setAttribute('aria-label',row.name+' '+label+' 지정');
      checkbox.addEventListener('change',()=>{
        setTag(deck,row.id,kind,checkbox.checked);
        renderProb(analysis);
        comboUI.sync();
      });
      holder.append(checkbox,make('span','',label));
      controls.append(holder);
    }
    item.append(name,controls);
    parents.append(item);
  }
}
function renderZones(analysis){
  const target=$('deck-zones');
  target.replaceChildren();
  const match=analysis.deck.total-analysis.unresolved;
  $('deck-match-count').textContent='CDB 확인 '+match+'/'+analysis.deck.total+'장';
  for(const [zone,label] of Object.entries(DECK_ZONES)){
    const container=make('section','deck-zone');
    container.append(make('h3','',label+' 덱 · '+analysis.deck.counts[zone]+'장'));
    const list=make('div','deck-zone-list');
    for(const row of analysis.sections[zone]){
      const element=make('div','deck-card-row'+(row.known?'':' unknown'));
      element.append(make('span','deck-qty',row.count+'×'),
        make('span','deck-card-name',row.name),make('small','deck-card-id',row.id));
      list.append(element);
    }
    if(!analysis.sections[zone].length)list.append(make('div','deck-empty','등록된 카드 없음'));
    container.append(list);target.append(container);
  }
}
function renderSummary(analysis){
  const summary=$('deck-summary');summary.replaceChildren();
  const c=analysis.deck.counts;
  const x=analysis.composition;
  const rows=[
    ['메인 덱',c.main,'40~60장 고정 아님'],
    ['엑스트라',c.extra,'현재 구성'],
    ['사이드',c.side,'현재 구성'],
    ['메인 카드 타입',x.monster+' / '+x.spell+' / '+x.trap,
      '몬스터 / 마법 / 함정 · 미확인 '+x.unknown]
  ];
  for(const [label,value,hint] of rows){
    const box=make('div','deck-summary-card');
    box.append(make('span','',label),make('strong','',String(value)),make('small','',hint));
    summary.append(box);
  }
}
function renderWarnings(analysis){
  const box=$('deck-warnings');box.replaceChildren();
  const arr=analysis.warnings;
  box.hidden=!arr.length;
  if(!arr.length)return;
  box.append(make('strong','','확인할 덱 구성 안내 · '+arr.length+'건'));
  const ul=make('ul');
  for(const message of arr)ul.append(make('li','',message));
  box.append(ul);
}
function render(){
  const select=$('deck-select');
  const currentDeck=current();
  select.replaceChildren();
  for(const item of decks){
    const option=make('option','',item.name);
    option.value=item.key;
    select.append(option);
  }
  if(!currentDeck){
    const option=make('option','','등록된 YDK 없음');option.value='';
    select.append(option);select.value='';
    $('deck-summary').replaceChildren();
    $('deck-zones').replaceChildren(make('p','deck-empty','상단에서 YDK를 추가하거나 보관함에 저장된 덱을 선택하세요.'));
    $('deck-opener-list').replaceChildren();
    $('deck-prob-metrics').replaceChildren();
    $('deck-export').disabled=true;
    $('deck-metadata').textContent='CDB를 함께 등록하면 카드명을 연결합니다.';
    $('deck-warnings').hidden=true;
    $('deck-match-count').textContent='미분석';
    comboUI.sync();
    return;
  }
  selectedKey=currentDeck.key;
  select.value=selectedKey;
  const analysis=currentAnalysis();
  $('deck-metadata').textContent='총 '+analysis.deck.total+'장 · 고유 카드 '+analysis.deck.ids.length+
    '종 · CDB 미확인 '+analysis.unresolved+'장';
  $('deck-export').disabled=false;
  renderSummary(analysis);renderZones(analysis);renderTags(analysis);renderProb(analysis);
  comboUI.sync();renderWarnings(analysis);
}
const DECK_LIMIT=1000000;
async function extractDecks(files){
  const found=[],warnings=[];
  for(const file of files){
    try{
      if(/\.ydk$/i.test(file.name)){
        if(file.size>DECK_LIMIT){warnings.push(file.name+' — YDK 1MB 제한 초과');continue;}
        found.push({name:file.name,text:await file.text()});
      }else if(/\.zip$/i.test(file.name)){
        if(file.size>20*1024*1024)continue;
        if(!globalThis.JSZip)continue;
        const zip=await globalThis.JSZip.loadAsync(file,{checkCRC32:true});
        const entries=Object.values(zip.files).filter(item=>!item.dir&&/\.ydk$/i.test(item.name));
        if(entries.length>80){warnings.push(file.name+' — YDK 항목 80개 초과');continue;}
        for(const item of entries){
          const name=item.name.replace(/\\/g,'/');
          if(name.startsWith('/')||name.split('/').includes('..'))continue;
          if(item._data?.uncompressedSize>DECK_LIMIT){warnings.push(name+' — 압축 해제 크기 제한 초과');continue;}
          const text=await item.async('string');
          if(text.length>DECK_LIMIT){warnings.push(name+' — 텍스트 크기 제한 초과');continue;}
          found.push({name:file.name+' / '+name,text});
        }
      }
      if(found.length>100)throw new Error('YDK 덱 100개 제한 초과');
    }catch(error){warnings.push(file.name+' — '+error.message);}
  }
  return {found,warnings};
}
export async function refreshDeck(files=[]){
  const {found,warnings}=await extractDecks(files);
  const next=[];
  for(const entry of found){
    try{
      const parsed=parseYdk(entry.text,entry.name);
      const key=hash(entry.name+'\n'+entry.text);
      if(!next.some(deck=>deck.key===key))next.push({key,name:entry.name,parsed});
    }catch(error){warnings.push(entry.name+' — '+error.message);}
  }
  decks=next;
  if(!decks.some(deck=>deck.key===selectedKey))selectedKey=decks[0]?.key||null;
  render();
  setMessage(decks.length?decks.length+'개 YDK 덱 분석 준비 완료 · 실제 듀얼 검증은 수행하지 않습니다.'+
    (warnings.length?' · 읽기 문제 '+warnings.length+'건: '+warnings.slice(0,2).join(' / '):''):
    '등록된 YDK 덱이 없습니다. 상단에서 .ydk 또는 ZIP을 추가하세요.'+
    (warnings.length?' · '+warnings.slice(0,2).join(' / '):''),!!warnings.length);
}
window.addEventListener('designlab:audit-data',event=>{
  cdbCards=Array.isArray(event.detail?.cdbCards)?event.detail.cdbCards:[];
  render();
});
$('deck-select').addEventListener('change',event=>{selectedKey=event.target.value;render();});
$('deck-hand-size').addEventListener('change',event=>{
  handSize=Number(event.target.value)===6?6:5;
  const a=currentAnalysis();
  if(a){renderProb(a);comboUI.sync();}
});
$('deck-reset-tags').addEventListener('click',()=>{
  const deck=current();if(!deck)return;
  delete tags[deck.key];saveTags();
  comboUI.clear();
  const analysis=currentAnalysis();renderTags(analysis);renderProb(analysis);comboUI.sync();
});
$('deck-export').addEventListener('click',()=>{
  const a=currentAnalysis();if(!a)return;
  const deck=current(),selectionValues=selection(deck);
  const txt=deckReportMarkdown(a,analyzeOpeners(a.deck,{...selectionValues,handSize}))+'\n---\n\n'+
    comboResearchMarkdown(a.deck,a,{
      ...selectionValues,handSize,recipes:comboUI.getRecipes()
    });
  const blob=new Blob([txt],{type:'text/markdown;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const link=make('a');link.href=url;
  link.download='덱연구소_'+safeFileName(deck.name.replace(/\.ydk$/i,''))+'_분석_V0.8.1.md';
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2500);
});
render();
