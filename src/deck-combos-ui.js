// V0.8.1 — 투핸드 조합 및 부담 카드 UI. 실제 전개 가능성은 자동 검증하지 않습니다.
import {MAX_COMBO_RECIPES,cleanComboRecipes,analyzeComboRecipes,analyzeHandRisks} from './deck-combos.js';

const $=id=>document.getElementById(id);
const el=(tag,cls='',text)=>{
  const n=document.createElement(tag);
  if(cls)n.className=cls;
  if(text!==undefined)n.textContent=text;
  return n;
};
const KEY='design-lab:deck-combo-plans:v1';
const percent=n=>n===null?'미지정':(n*100).toFixed(2)+'%';

export function createDeckComboUI({getDeck,getAnalysis,getHandSize,getSelection}){
  const dialog=$('deck-combo-dialog'),openButton=$('deck-combo-open');
  const closeButton=$('deck-combo-close'),addButton=$('deck-combo-add');
  const chooser=$('deck-combo-recipe-list'),editor=$('deck-combo-editor-content');
  const summary=$('deck-combo-summary'),riskMetrics=$('deck-risk-metrics'),status=$('deck-combo-status');
  if(![dialog,openButton,closeButton,addButton,chooser,editor,summary,riskMetrics,status].every(Boolean))
    throw new Error('덱 조합 편집기 UI 일부를 찾을 수 없습니다.');
  let saved={};
  try{
    const value=JSON.parse(localStorage.getItem(KEY)||'{}');
    if(value&&typeof value==='object'&&!Array.isArray(value))saved=value;
  }catch{/* 임시 사용 */}
  let activeId=null,restoreFocus=null,serial=0;

  function getRecipes(){
    const deck=getDeck();
    return deck?cleanComboRecipes(deck.parsed,saved[deck.key]||[]):[];
  }
  function persist(items){
    const deck=getDeck();if(!deck)return;
    saved[deck.key]=cleanComboRecipes(deck.parsed,items);
    try{localStorage.setItem(KEY,JSON.stringify(saved));
      status.textContent='현재 덱의 조합 설정을 브라우저에 저장했습니다.';
    }catch{
      status.textContent='브라우저에 저장할 수 없어 탭을 닫으면 조합 설정이 사라질 수 있습니다.';
    }
  }
  function updateRecipe(id,change){
    const data=getRecipes();
    const target=data.find(item=>item.id===id);
    if(!target)return;
    change(target);
    persist(data);
    render();
  }
  function renderRisk(){
    riskMetrics.replaceChildren();
    const deck=getDeck();
    if(!deck)return;
    const sel=getSelection();
    const risk=analyzeHandRisks(deck.parsed,{...sel,handSize:getHandSize()});
    for(const [label,value,detail] of [
      ['초동 없음',risk.noStarter,'초동 직접 지정 후 계산'],
      ['부담 카드 ≥1장',risk.riskAtLeastOne,'지정한 카드 '+risk.riskCopies+'장'],
      ['부담 카드 ≥2장',risk.riskAtLeastTwo,'시작 패 기준'],
      ['초동 없음 + 부담 카드',risk.noStarterAndRisk,'두 조건 동시 발생']
    ]){
      const card=el('div','deck-prob-card deck-risk-card');
      card.append(el('span','',label),el('strong','',percent(value)),el('small','',detail));
      riskMetrics.append(card);
    }
  }
  function renderSummary(){
    summary.replaceChildren();
    const deck=getDeck();
    if(!deck)return;
    const report=analyzeComboRecipes(deck.parsed,getRecipes(),getHandSize());
    const box=el('div','deck-combo-union');
    box.append(el('span','','등록 조합 중 하나 이상 충족'),
      el('strong','',percent(report.anyProbability)),
      el('small','',report.activeCount+'개 조합 · 서로 다른 실제 카드 2장 필요'));
    summary.append(box);
    if(!report.recipes.length){
      summary.append(el('p','deck-combo-empty','조합을 아직 정의하지 않았어. 「조합 편집」에서 예: A군(노에마·세피르) + B군(역사의 역전)을 지정하면 돼.'));
    }
    for(const recipe of report.recipes){
      const line=el('div','deck-combo-result');
      line.append(el('span','',recipe.name),el('strong','',percent(recipe.probability)));
      summary.append(line);
    }
    summary.append(el('p','deck-combo-note','조합 간 겹치는 시작 패는 중복 합산하지 않아. 실제 전개·효과 성립 여부는 직접 확인해야 해.'));
  }
  function renderChooser(){
    chooser.replaceChildren();
    const recipes=getRecipes();
    addButton.disabled=!getDeck()||recipes.length>=MAX_COMBO_RECIPES;
    if(!recipes.some(x=>x.id===activeId))activeId=recipes[0]?.id||null;
    for(const recipe of recipes){
      const b=el('button','deck-combo-recipe'+(recipe.id===activeId?' active':''),recipe.name);
      b.type='button';b.setAttribute('aria-pressed',String(recipe.id===activeId));
      b.addEventListener('click',()=>{activeId=recipe.id;renderChooser();renderEditor();});
      chooser.append(b);
    }
    if(!recipes.length)chooser.append(el('p','deck-combo-empty','＋ 조합 추가를 눌러 2장 전개 조건을 정의해 줘.'));
  }
  function renderEditor(){
    const oldScroll=editor.parentElement?.scrollTop||0;
    editor.replaceChildren();
    const deck=getDeck(),analysis=getAnalysis(),recipe=getRecipes().find(x=>x.id===activeId);
    if(!deck||!analysis||!recipe){
      editor.append(el('div','deck-combo-empty','왼쪽에서 조합을 새로 만들거나 선택하세요.'));
      return;
    }
    const h=el('div','deck-combo-editor-head');
    h.append(el('h3','','전개 조합 설정'));
    const remove=el('button','deck-combo-delete','이 조합 삭제');
    remove.type='button';
    remove.addEventListener('click',()=>{
      persist(getRecipes().filter(x=>x.id!==recipe.id));
      activeId=null;render();
    });
    h.append(remove);editor.append(h);

    const nameField=el('label','deck-combo-name');
    nameField.append(el('span','','전개 루트 이름'));
    const nameInput=el('input');nameInput.type='text';nameInput.maxLength=55;
    nameInput.value=recipe.name;nameInput.placeholder='예: 세피르 + 역사의 역전';
    nameInput.addEventListener('change',()=>{
      updateRecipe(recipe.id,r=>{r.name=nameInput.value.trim().slice(0,55)||'이름 없는 조합';});
    });
    nameField.append(nameInput);editor.append(nameField);

    const hint=el('p','deck-combo-editor-hint',
      'A군 1장 + B군 1장을 직접 선택해. 여러 카드를 한 군에 넣으면 그중 아무 카드 1장으로 충족해. 같은 카드가 양쪽에 있어도 실제 2장이 필요해.');
    editor.append(hint);
    const header=el('div','deck-combo-group-header');
    header.append(el('strong','','메인 덱 카드'),el('strong','','A군'),el('strong','','B군'));
    editor.append(header);
    const list=el('div','deck-combo-group-list');
    for(const card of analysis.sections.main){
      const row=el('div','deck-combo-group-row');
      const label=el('span','deck-combo-group-name',card.name);
      label.append(el('small','',card.count+'장 · '+card.id));
      row.append(label);
      for(const [field,title] of [['groupA','A군'],['groupB','B군']]){
        const holder=el('label','deck-combo-check');
        const input=el('input');input.type='checkbox';input.checked=recipe[field].includes(card.id);
        input.setAttribute('aria-label',card.name+' '+title);
        input.addEventListener('change',()=>{
          updateRecipe(recipe.id,r=>{
            const values=new Set(r[field]);
            if(input.checked)values.add(card.id);else values.delete(card.id);
            r[field]=[...values];
          });
        });
        holder.append(input,el('span','',title));row.append(holder);
      }
      list.append(row);
    }
    editor.append(list);
    const probability=analyzeComboRecipes(deck.parsed,[recipe],getHandSize()).recipes[0];
    const total=el('div','deck-combo-edit-result');
    total.append(el('span','','이 조합의 시작 패 충족 확률'),
      el('strong','',percent(probability.probability)));
    editor.append(total);
    if(editor.parentElement)editor.parentElement.scrollTop=oldScroll;
  }
  function render(){
    openButton.disabled=!getDeck();
    renderRisk();renderSummary();
    if(dialog.open){renderChooser();renderEditor();}
  }
  function open(){
    if(!getDeck())return;
    restoreFocus=document.activeElement;
    dialog.showModal();renderChooser();renderEditor();closeButton.focus();
  }
  openButton.addEventListener('click',open);
  closeButton.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{restoreFocus?.focus?.();restoreFocus=null;});
  addButton.addEventListener('click',()=>{
    const deck=getDeck();if(!deck)return;
    const recipes=getRecipes();
    if(recipes.length>=MAX_COMBO_RECIPES)return;
    serial++;
    const id='recipe-'+Date.now().toString(36)+'-'+serial;
    const newRecipe={id,name:'투핸드 조합 '+(recipes.length+1),groupA:[],groupB:[]};
    persist([...recipes,newRecipe]);activeId=id;render();
  });
  return {sync:render,getRecipes,clear:()=>{persist([]);activeId=null;render();},getStoredKey:()=>KEY};
}
