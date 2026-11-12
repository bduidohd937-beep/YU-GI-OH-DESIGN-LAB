// V0.8.3 — YDK 원본을 건드리지 않는 브라우저 내부 실제 카드 편집.
import {REAL_EDITOR_KEY,eligibleCatalog,cleanRealOverrides,compareRealDeck,
  serializeEditedYdk,realDeckReportMarkdown} from './deck-real-editor.js';
const $=id=>document.getElementById(id);
const el=(tag,cls='',text)=>{
  const node=document.createElement(tag);
  if(cls)node.className=cls;
  if(text!==undefined)node.textContent=text;
  return node;
};
const percent=x=>x===null?'미지정':(100*x).toFixed(2)+'%';
const difference=x=>x===null?'—':(x>=0?'+':'')+(100*x).toFixed(2)+'%p';
function download(filename,data,type){
  const url=URL.createObjectURL(new Blob([data],{type}));
  const a=el('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2200);
}
const filename=name=>String(name||'덱').replace(/\.ydk$/i,'').replace(/[\\/:*?"<>|]/g,'_').slice(0,65);
export function createRealDeckEditorUI({getDeck,getCatalog,getAnalysis,getSelection,getHandSize,getRecipes}){
  const dialog=$('deck-real-dialog'),openButton=$('deck-real-open'),close=$('deck-real-close');
  const current=$('deck-real-current'),reset=$('deck-real-reset'),search=$('deck-real-search');
  const catalog=$('deck-real-catalog'),counts=$('deck-real-counts'),state=$('deck-real-state');
  const diff=$('deck-real-diff'),metrics=$('deck-real-metrics'),preview=$('deck-real-preview');
  const status=$('deck-real-message'),report=$('deck-real-report'),exportYdk=$('deck-real-ydk');
  const inline=$('deck-real-inline');
  if(![dialog,openButton,close,current,reset,search,catalog,counts,state,diff,metrics,
    preview,status,report,exportYdk,inline].every(Boolean))throw Error('실제 덱 편집 UI 일부가 없습니다.');
  let saved={};
  try{
    const values=JSON.parse(localStorage.getItem(REAL_EDITOR_KEY)||'{}');
    if(values&&typeof values==='object'&&!Array.isArray(values))saved=values;
  }catch{/* 차단되면 탭 내 임시 상태 */}
  let lastFocus=null;
  function getOverrides(){
    const deck=getDeck();
    if(!deck)return {};
    return cleanRealOverrides(deck.parsed,getCatalog(),saved[deck.key]||{});
  }
  function persist(overrides){
    const deck=getDeck();if(!deck)return;
    saved[deck.key]=cleanRealOverrides(deck.parsed,getCatalog(),overrides);
    try{
      localStorage.setItem(REAL_EDITOR_KEY,JSON.stringify(saved));
      status.textContent='덱 변경안은 이 브라우저에만 저장됐습니다. 원본 YDK는 변경하지 않았습니다.';
    }catch{status.textContent='브라우저 저장이 불가능합니다. 종료 전에 덱 비교 보고서를 내려받으세요.';}
  }
  function options(){
    return {...getSelection(),handSize:getHandSize(),recipes:getRecipes()};
  }
  function compare(){
    const d=getDeck();
    return d?compareRealDeck(d.parsed,getCatalog(),getOverrides(),options()):null;
  }
  function update(id,value){
    const deck=getDeck();if(!deck)return;
    const n=Number(value);
    if(!Number.isInteger(n)||n<0||n>3){status.textContent='매수는 0~3장의 정수만 입력하세요.';render();return;}
    const next={...getOverrides(),[id]:n};
    persist(next);render();
  }
  function renderCurrent(result,analysis){
    const remembered=current.scrollTop;
    current.replaceChildren();
    const original=new Map(analysis.sections.main.map(row=>[row.id,row]));
    const ids=[...original.keys()];
    for(const change of result.changes)if(change.before===0&&!ids.includes(change.id))ids.push(change.id);
    const revisedCounts=new Map();
    for(const id of result.deck?.zones.main||[])revisedCounts.set(id,(revisedCounts.get(id)||0)+1);
    const newNames=new Map(eligibleCatalog(getCatalog()).map(x=>[x.id,x.name]));
    if(!ids.length)current.append(el('p','deck-real-placeholder','등록된 카드가 없습니다.'));
    for(const id of ids){
      const row=original.get(id),before=row?.count||0,after=revisedCounts.get(id)||0;
      const label=el('label','deck-real-edit-row'+(before!==after?' change':''));
      const name=el('span','deck-real-card-name',row?.name||newNames.get(id)||'ID '+id);
      name.append(el('small','',id+' · 원본 '+before+'장'));
      if(before===0)name.append(el('em','','CDB에서 새로 추가한 카드'));
      const input=el('input');
      input.type='number';input.min='0';input.max='3';input.step='1';
      input.value=String(after);
      input.setAttribute('aria-label',(row?.name||newNames.get(id)||id)+' 수정 후 매수');
      input.addEventListener('change',()=>update(id,input.value));
      label.append(name,input);current.append(label);
    }
    current.scrollTop=remembered;
  }
  function renderCatalog(){
    catalog.replaceChildren();
    const d=getDeck();if(!d)return;
    const all=eligibleCatalog(getCatalog());
    const q=search.value.trim().toLocaleLowerCase('ko');
    if(!all.length){catalog.append(el('p','deck-real-placeholder',
      '등록된 CDB에서 메인 덱에 넣을 수 있는 카드가 없습니다. 보관함에 CDB를 추가하세요.'));return;}
    if(!q){catalog.append(el('p','deck-real-placeholder',
      '카드명이나 ID를 입력하면 등록된 CDB 카드 중 추가 가능한 카드를 찾습니다.'));return;}
    const originals=new Set(d.parsed.zones.main);
    const visible=all.filter(card=>(card.name.toLocaleLowerCase('ko').includes(q)||card.id.includes(q)) &&
      !originals.has(card.id));
    if(!visible.length){catalog.append(el('p','deck-real-placeholder',
      '추가 가능한 카드가 없습니다. 이미 원본 덱에 있는 카드는 위 매수 목록에서 변경하세요.'));return;}
    for(const card of visible.slice(0,35)){
      const row=el('div','deck-real-candidate');
      const name=el('span','',card.name);
      name.append(el('small','',card.id));
      const button=el('button','',Object.prototype.hasOwnProperty.call(getOverrides(),card.id)?'매수 변경 ↑':'1장 추가');
      button.type='button';
      button.addEventListener('click',()=>{
        update(card.id,1);
        search.value='';
        renderCatalog();
      });
      row.append(name,button);catalog.append(row);
    }
    if(visible.length>35)catalog.append(el('p','deck-real-tip','검색 결과 '+visible.length+'건 중 처음 35건만 표시합니다. 검색어를 좁혀주세요.'));
  }
  function renderCounts(result){
    counts.replaceChildren();
    const d=getDeck(),before=d.parsed.counts;
    for(const [title,b,a,hint] of [
      ['메인 덱',before.main,result.deck?.counts.main,'40~60장 필요'],
      ['증가 카드',0,result.totalAdded,'원본 대비'],
      ['감소 카드',0,result.totalRemoved,'원본 대비']
    ]){
      const box=el('article','deck-real-count');
      box.append(el('span','',title),el('strong','',title==='메인 덱'?b+' → '+a:a+'장'),
        el('small','',hint));
      counts.append(box);
    }
  }
  function renderDiff(result){
    diff.replaceChildren();
    if(!result.changes.length){diff.append(el('p','deck-real-placeholder','아직 변경한 카드가 없습니다. 원본 덱을 그대로 유지합니다.'));return;}
    for(const c of result.changes){
      const row=el('div','deck-real-change-row');
      const name=el('span','',c.name);
      name.append(el('small','',c.id));
      row.append(name,el('strong','',c.before+'장 → '+c.after+'장 ('+(c.delta>=0?'+':'')+c.delta+')'));
      diff.append(row);
    }
  }
  function renderMetrics(result){
    metrics.replaceChildren();
    const labels={
      starter:'초동 1장 이상',combo:'투핸드 조합 1개 이상',
      noStarter:'초동이 없는 패',risk:'부담 카드 1장 이상',
      stranded:'초동 없음 + 부담 카드'
    };
    for(const [key,title] of Object.entries(labels)){
      const box=el('article','deck-real-metric');
      box.append(el('span','',title),
        el('strong','',percent(result.baseline[key])+' → '+percent(result.edited?.[key]??null)),
        el('small','','변화 '+difference(result.deltas[key])));
      metrics.append(box);
    }
  }
  function renderPreview(result){
    preview.replaceChildren();
    if(!result.deck){preview.append(el('p','deck-real-placeholder','검사할 수정 덱이 없습니다.'));return;}
    const cdb=new Map(eligibleCatalog(getCatalog()).map(c=>[c.id,c.name]));
    const original=new Map(getAnalysis().sections.main.map(c=>[c.id,c.name]));
    const freq=new Map();
    for(const id of result.deck.zones.main)freq.set(id,(freq.get(id)||0)+1);
    for(const [id,n] of freq){
      const row=el('div','deck-real-preview-row');
      row.append(el('span','',cdb.get(id)||original.get(id)||'CDB 미확인 ID '+id),
        el('strong','',n+'장'));
      preview.append(row);
    }
    if(!freq.size)preview.append(el('p','deck-real-placeholder','카드가 없습니다.'));
  }
  function render(){
    const deck=getDeck();
    openButton.disabled=!deck;
    const data=compare();
    inline.textContent=!deck?'YDK를 등록하면 실제 카드 매수 변경안과 원본을 비교할 수 있습니다.':
      '원본 '+deck.parsed.counts.main+'장 · 현재 변경안 '+(data?.deck?.counts.main||0)+
      '장 · 증감 '+(data?.changes.length||0)+'종'+
      (data&&!data.valid?' · 새 YDK 생성 불가':'');
    if(!dialog.open)return;
    if(!deck){dialog.close();return;}
    const result=data,analysis=getAnalysis();
    state.className='deck-real-state'+(result.valid?'':' blocked');
    state.textContent=result.valid?
      '기본 구조 검증 통과 · 원본 YDK 보존 · OCG 금제와 실전 전개는 미검증':
      'YDK 내보내기 차단: '+(result.errors||[]).join(' / ');
    renderCurrent(result,analysis);
    renderCatalog();
    renderCounts(result);renderDiff(result);renderMetrics(result);renderPreview(result);
    report.disabled=false;
    exportYdk.disabled=!result.valid;
  }
  openButton.addEventListener('click',()=>{
    if(!getDeck())return;
    lastFocus=document.activeElement;
    dialog.showModal();render();close.focus();
  });
  close.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{lastFocus?.focus?.();lastFocus=null;});
  reset.addEventListener('click',()=>{persist({});search.value='';render();});
  search.addEventListener('input',renderCatalog);
  report.addEventListener('click',()=>{
    const d=getDeck(),result=compare();
    if(!d||!result)return;
    download('덱연구소_'+filename(d.name)+'_실제카드증감_비교_V0.8.3.md',
      realDeckReportMarkdown(result,options()),'text/markdown;charset=utf-8');
  });
  exportYdk.addEventListener('click',()=>{
    const d=getDeck(),result=compare();
    if(!d||!result?.valid)return;
    try{
      const ydktxt=serializeEditedYdk(result);
      download('덱연구소_'+filename(d.name)+'_실제수정안_V0.8.3.ydk',ydktxt,'text/plain;charset=utf-8');
      status.textContent='수정한 별도 YDK를 내려받았습니다. 원본은 그대로 있습니다.';
    }catch(error){status.textContent='YDK 내보내기 실패: '+error.message;}
  });
  return {sync:render,getResult:compare,getOverrides,getStoredKey:()=>REAL_EDITOR_KEY};
}
