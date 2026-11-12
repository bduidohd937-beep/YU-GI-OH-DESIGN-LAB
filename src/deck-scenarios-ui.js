// V0.8.2 — 원본 YDK를 수정하지 않는 가상 덱 장수 비교 UI
import {SCENARIO_OBJECTIVES,sanitizeScenario,compareScenario,compareDeckSizes,scenarioReportMarkdown} from './deck-scenarios.js';
const $=id=>document.getElementById(id);
const el=(tag,cls='',value)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(value!==undefined)e.textContent=value;return e;};
const KEY='design-lab:deck-scenarios:v1';
const pct=n=>n===null?'미지정':(n*100).toFixed(2)+'%';
const delta=n=>n===null?'—':(n>=0?'+':'')+(n*100).toFixed(2)+'%p';
export function createDeckScenarioUI({getDeck,getAnalysis,getHandSize,getSelection,getRecipes}){
  const dialog=$('deck-scenario-dialog'),openBtn=$('deck-scenario-open'),closeBtn=$('deck-scenario-close');
  const sizeInput=$('deck-scenario-size'),objectiveInput=$('deck-scenario-objective');
  const copies=$('deck-scenario-copies'),validation=$('deck-scenario-validation');
  const headline=$('deck-scenario-headline'),metrics=$('deck-scenario-metrics');
  const best=$('deck-scenario-best'),table=$('deck-scenario-table-body');
  const status=$('deck-scenario-status'),exportBtn=$('deck-scenario-export');
  const reset=$('deck-scenario-reset'),inline=$('deck-scenario-inline');
  if(![dialog,openBtn,closeBtn,sizeInput,objectiveInput,copies,validation,headline,metrics,
    best,table,status,exportBtn,reset,inline].every(Boolean))throw Error('덱 시뮬레이터 요소 누락');
  let stored={};
  try{
    const value=JSON.parse(localStorage.getItem(KEY)||'{}');
    if(value&&typeof value==='object'&&!Array.isArray(value))stored=value;
  }catch{/* 브라우저 기록 접근 불가: 이번 탭만 사용 */}
  let previousFocus=null;
  function getState(){
    const d=getDeck();if(!d)return null;
    const src=stored[d.key]||{},target=Number(src.targetSize);
    return {
      targetSize:Number.isInteger(target)&&target>=40&&target<=60?target:
        Math.max(40,Math.min(60,d.parsed.zones.main.length)),
      objective:Object.prototype.hasOwnProperty.call(SCENARIO_OBJECTIVES,src.objective)?src.objective:'starter',
      copyOverrides:src.copyOverrides&&typeof src.copyOverrides==='object'&&!Array.isArray(src.copyOverrides)?src.copyOverrides:{}
    };
  }
  function getOptions(){
    const state=getState();
    return state?{...getSelection(),recipes:getRecipes(),handSize:getHandSize(),...state}:null;
  }
  function save(patch){
    const d=getDeck();if(!d)return;
    const next={...getState(),...patch};
    const safe=sanitizeScenario(d.parsed,{...getSelection(),recipes:getRecipes(),...next});
    stored[d.key]={targetSize:safe.targetSize,objective:next.objective,copyOverrides:safe.copyOverrides};
    try{
      localStorage.setItem(KEY,JSON.stringify(stored));
      status.textContent='가상 시나리오를 이 브라우저에 저장했습니다.';
    }catch{status.textContent='로컬 저장 불가 · 종료 전에 Markdown 보고서로 기록하세요.';}
  }
  function renderCopies(cfg,analysis){
    copies.replaceChildren();
    if(!cfg.protectedIds.length)
      copies.append(el('p','deck-scenario-empty','초동·연장·부담 카드나 투핸드 레시피를 먼저 지정하세요. 비지정 카드 효과를 자동으로 추측하지 않습니다.'));
    const names=new Map(analysis.sections.main.map(x=>[x.id,x.name]));
    const selected=getSelection(),recipes=getRecipes();
    for(const id of cfg.protectedIds){
      const before=cfg.baseCopies[id],after=cfg.copyOverrides[id]??before;
      const row=el('label','deck-scenario-copy');
      const name=el('span','deck-scenario-copy-name',names.get(id)||'미확인 카드 '+id);
      name.append(el('small','',id+' · 원본 '+before+'장'));
      const roles=[];
      if(selected.starterIds.includes(id))roles.push('초동');
      if(selected.extenderIds.includes(id))roles.push('연장');
      if(selected.riskIds.includes(id))roles.push('부담');
      if(recipes.some(x=>x.groupA.includes(id)||x.groupB.includes(id)))roles.push('투핸드');
      if(roles.length)name.append(el('em','',roles.join(' · ')));
      const input=el('input');
      input.type='number';input.min='0';input.max='3';input.step='1';input.value=String(after);
      input.setAttribute('aria-label',(names.get(id)||id)+' 가상 매수');
      input.addEventListener('change',()=>{
        const n=Number(input.value);
        if(!Number.isInteger(n)||n<0||n>3){
          status.textContent='가상 매수는 0~3장의 정수만 입력할 수 있습니다.';
          input.value=String(after);return;
        }
        save({copyOverrides:{...getState().copyOverrides,[id]:n}});render();
      });
      row.append(name,input);copies.append(row);
    }
  }
  function renderMetrics(cmp){
    headline.replaceChildren();metrics.replaceChildren();
    if(!cmp.valid){
      headline.append(el('h3','','계산할 수 없는 가상 구성'),el('p','',cmp.reason));
      validation.textContent=cmp.reason;return;
    }
    headline.append(el('h3','','원본 '+cmp.baseline.size+'장 → 가상 '+cmp.scenario.size+'장'),
      el('p','','지정 핵심 카드 '+cmp.protectedCopies+'장 · 가상 중립 슬롯 '+cmp.neutralSlots+'장 · 시작 패 '+cmp.scenario.handSize+'장'));
    validation.textContent='계산 가능 · 비지정 카드 자리는 효과 없는 가상 슬롯이며 YDK는 변경되지 않습니다.';
    for(const [key,meta] of Object.entries(SCENARIO_OBJECTIVES)){
      const card=el('article','deck-scenario-metric');
      card.append(el('span','',meta.label));
      const values=el('div','deck-scenario-metric-values');
      values.append(el('small','','원본 '+pct(cmp.baseline[key])),
        el('strong','',pct(cmp.scenario[key])));
      card.append(values,el('small','deck-scenario-delta','변화 '+delta(cmp.deltas[key])));
      metrics.append(card);
    }
  }
  function renderTable(scan,state){
    table.replaceChildren();
    for(const row of scan.rows){
      const tr=el('tr',row.size===state.targetSize?'selected':'');
      if(scan.best?.size===row.size)tr.classList.add('best');
      const first=el('td'),btn=el('button','deck-scenario-pick',row.size+'장');
      btn.type='button';btn.addEventListener('click',()=>{save({targetSize:row.size});render();});
      first.append(btn);
      const second=el('td','deck-scenario-cell-rate');
      if(row.valid){
        second.append(el('strong','',pct(row.scenario[scan.objective])));
        const bar=el('div','deck-scenario-track'),fill=el('span');
        fill.style.width=(100*Math.max(0,row.scenario[scan.objective]??0)).toFixed(2)+'%';
        bar.append(fill);second.append(bar);
      }else second.append(el('span','','계산 불가'));
      tr.append(first,second,
        el('td','',row.valid?delta(row.deltas[scan.objective]):'—'),
        el('td','',!row.valid?'핵심 카드 초과':row.size===state.targetSize?'선택됨':
          scan.best?.size===row.size?'이 지표 최상위':''));
      table.append(tr);
    }
  }
  function render(){
    const d=getDeck(),state=getState();
    openBtn.disabled=!d;
    inline.textContent=d?
      '원본 '+d.parsed.zones.main.length+'장 · 가상 목표 '+state.targetSize+'장 · 실제 덱은 변경하지 않습니다.'
      :'YDK 파일을 등록하면 가상 덱 장수 비교를 시작할 수 있습니다.';
    if(!dialog.open)return;
    if(!d){dialog.close();return;}
    const opts=getOptions();
    const cmp=compareScenario(d.parsed,opts),scan=compareDeckSizes(d.parsed,opts);
    const cfg=sanitizeScenario(d.parsed,opts);
    sizeInput.value=String(state.targetSize);objectiveInput.value=state.objective;
    renderCopies(cfg,getAnalysis());
    renderMetrics(cmp);
    best.replaceChildren();
    if(scan.best){
      best.append(el('strong','','「'+SCENARIO_OBJECTIVES[state.objective].label+'」 기준 최상위: '+
        scan.best.size+'장 · '+pct(scan.best.scenario[state.objective])),
        el('p','','핵심 카드 매수 고정 + 중립 슬롯 조건입니다. 실제 최적 덱 추천이 아닙니다.'));
    }else best.append(el('p','','해당 지표가 미지정이거나 계산 가능한 가상 덱이 없어 최상위를 선택하지 않았습니다.'));
    renderTable(scan,state);
    exportBtn.disabled=!cmp.valid;
  }
  openBtn.addEventListener('click',()=>{
    if(!getDeck())return;
    previousFocus=document.activeElement;
    dialog.showModal();render();closeBtn.focus();
  });
  closeBtn.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{previousFocus?.focus?.();previousFocus=null;});
  sizeInput.addEventListener('change',()=>{
    const n=Number(sizeInput.value);
    if(!Number.isInteger(n)||n<40||n>60){
      status.textContent='목표 덱 장수는 40~60장 정수로 설정하세요.';
      sizeInput.value=String(getState().targetSize);return;
    }
    save({targetSize:n});render();
  });
  objectiveInput.addEventListener('change',()=>{save({objective:objectiveInput.value});render();});
  reset.addEventListener('click',()=>{save({copyOverrides:{}});render();});
  exportBtn.addEventListener('click',()=>{
    const d=getDeck(),opts=getOptions();
    if(!d||!compareScenario(d.parsed,opts).valid)return;
    const md=scenarioReportMarkdown(d.parsed,getAnalysis(),opts);
    const url=URL.createObjectURL(new Blob([md],{type:'text/markdown;charset=utf-8'}));
    const a=el('a');
    a.href=url;
    a.download='덱연구소_'+d.name.replace(/\.ydk$/i,'').replace(/[\\/:*?"<>|]/g,'_').slice(0,60)+
      '_가상장수비교_V0.8.2.md';
    document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2000);
  });
  return {sync:render,getOptions,getStoredKey:()=>KEY};
}
