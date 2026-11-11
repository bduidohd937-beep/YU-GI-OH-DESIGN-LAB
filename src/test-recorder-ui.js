// V0.7.3 — 수동 EDOPro 검증 기록 UI. 로그는 업로드하지 않고 브라우저에만 저장합니다.
import {buildManualTestPlan} from './smart-audit.js';
import {TEST_RECORDS_KEY,STATUSES,MAX_RECORDS,decodeTestRecords,encodeTestRecords,
  makeTestEntry,mergeTestRecords,latestForCases,summarizeRecordedTests,recordedTestMarkdown,effectiveTestStatus} from './test-records.js';
import {TRIAGE_KEY,decodeInvestigations,encodeInvestigations,makeInvestigation,
  mergeInvestigations,buildFailureQueue,failureQueueMarkdown} from './failure-triage.js';
import {createFailureInvestigationPanel} from './failure-triage-ui.js';

const $=(id)=>document.getElementById(id);
function el(tag,className='',text) {
  const item=document.createElement(tag);
  if(className)item.className=className;
  if(text!==undefined)item.textContent=text;
  return item;
}
function downloadText(filename,content,type='text/plain;charset=utf-8') {
  const url=URL.createObjectURL(new Blob([content],{type}));
  const a=el('a');
  a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2500);
}

export function createTestRecorder({getResult,getThemeFilter,getSelectedKey}) {
  const dialog=$('runtime-dialog'),openButton=$('runtime-open');
  const stats=$('runtime-stats'),list=$('runtime-list'),detail=$('runtime-detail');
  const search=$('runtime-search'),filter=$('runtime-filter'),notice=$('runtime-notice');
  const summary=$('runtime-summary');
  const close=$('runtime-close'),jsonExport=$('runtime-export-json');
  const markdownExport=$('runtime-export-md'),jsonImport=$('runtime-import-input');
  const triageExport=$('runtime-export-triage'),triageShortcut=$('runtime-review-shortcut');
  if(![dialog,openButton,stats,list,detail,search,filter,notice,summary,close,jsonExport,markdownExport,jsonImport,triageExport,triageShortcut].every(Boolean))
    throw new Error('실전 검증 기록 UI 일부를 찾지 못했습니다.');

  let records=[];
  let storageAvailable=true;
  try {records=decodeTestRecords(window.localStorage.getItem(TEST_RECORDS_KEY));}
  catch {storageAvailable=false;}
  let investigations=[];
  try{investigations=decodeInvestigations(window.localStorage.getItem(TRIAGE_KEY));}
  catch{storageAvailable=false;}
  let selectedCaseKey=null;
  let lastFocus=null;

  const plan=()=>buildManualTestPlan(getResult(),{theme:getThemeFilter()});
  const queue=()=>buildFailureQueue(getResult(),plan(),records,investigations);
  const currentCases=()=> {
    const q=search.value.toLocaleLowerCase('ko').trim();
    const status=filter.value;
    const current=plan();
    const latest=latestForCases(records);
    return current.cases.filter((item)=>{
      const saved=latest.get(item.key);
      const actual=effectiveTestStatus(item,saved);
      return (status==='all' || (status==='needs_review'
        ? ['fail','retest','blocked'].includes(actual) : actual===status)) &&
        (!q || (item.name+' '+item.title+' '+item.id).toLocaleLowerCase('ko').includes(q));
    });
  };
  function setNotice(message,isError=false) {
    notice.textContent=message;
    notice.classList.toggle('is-error',isError);
  }
  function persist(next) {
    if(storageAvailable) {
      try{window.localStorage.setItem(TEST_RECORDS_KEY,encodeTestRecords(next));}
      catch(error) { throw new Error('브라우저 기록 저장 실패: '+(error?.message||'저장 공간/권한을 확인하세요')+
        '. JSON으로 이전 기록을 백업하거나 브라우저 저장소를 점검하세요.'); }
    }
    records=next;
  }
  function persistInvestigation(next) {
    if(storageAvailable) {
      try{window.localStorage.setItem(TRIAGE_KEY,encodeInvestigations(next));}
      catch(error){throw new Error('조사 기록 저장 실패: '+(error?.message||'저장 공간을 확인하세요')+
        '. JSON 백업을 보관하고 브라우저 저장소를 확인하세요.');}
    }
    investigations=next;
  }
  function statusLabel(test,saved) {
    const computed=effectiveTestStatus(test,saved);
    return computed==='untested' ? '미실행' : STATUSES[computed];
  }
  function formatTime(iso) {
    try{return new Date(iso).toLocaleString('ko-KR');}
    catch{return iso;}
  }
  function renderDetail(test) {
    detail.replaceChildren();
    if(!test) {
      detail.append(el('p','runtime-empty','표시할 시험 항목이 없습니다. 전체 항목으로 필터를 변경해 보세요.'));
      return;
    }
    const recent=records.filter((entry)=>entry.caseKey===test.key).sort((a,b)=>b.time.localeCompare(a.time));
    const latest=recent[0]||null;
    detail.append(el('div','runtime-eyebrow',test.theme+' / '+test.id+' / '+statusLabel(test,latest)));
    detail.append(el('h3','runtime-case-title',test.name));
    detail.append(el('h4','runtime-case-subtitle',test.title));
    const task=el('section','runtime-task');
    task.append(el('strong','','실행 절차'),el('p','',test.steps),
      el('strong','','기대 결과 · 원문 기준'),el('p','',test.expected),
      el('div','runtime-task-source','자료에 연결된 Lua: '+(test.lua||'미연결')+
        ' · 실제 설치 여부는 사용자가 확인해야 합니다.'));
    detail.append(task);
    const investigationItem=queue().items.find(item=>item.key===test.key);
    if(investigationItem) {
      detail.append(createFailureInvestigationPanel(investigationItem,{
        onSave:(value)=>{
          try {
            const saved=makeInvestigation(value);
            persistInvestigation(mergeInvestigations(investigations,[saved]));
            setNotice(storageAvailable?'원인 조사 기록을 브라우저에 저장했습니다.':'임시 조사 기록입니다. 종료 전에 JSON 백업을 저장하세요.');
            render();
          }catch(error){setNotice(error.message,true);}
        }
      }));
    }
    if(latest && effectiveTestStatus(test,latest)==='retest' && latest.status!=='retest') {
      detail.append(el('p','runtime-retest-notice',
        '검사에 등록된 Lua 파일 버전 또는 효과 문구가 마지막 수동 시험 기록과 달라졌습니다. 이전 판정은 기록에 남기고 현재 버전은 재검증 필요로 분류합니다.'));
    }

    const form=el('form','runtime-result-form');
    const head=el('h4','',latest?'새 시험 결과 추가 · 이전 기록 보존':'첫 시험 결과 기록');
    form.append(head);
    const statusBox=el('div','runtime-field');
    const statusLabelEl=el('label','','수동 시험 판정');
    const statusSelect=el('select');
    statusSelect.required=true;
    statusSelect.append(new Option('시험 후 판정 선택',''));
    for(const [value,name] of Object.entries(STATUSES)) statusSelect.append(new Option(name,value));
    statusBox.append(statusLabelEl,statusSelect);
    const versionBox=el('div','runtime-field');
    const versionLabel=el('label','','EDOPro에 실제 설치한 패키지 버전');
    const version=el('input');version.type='text';version.maxLength=120;version.required=true;
    version.value=latest?.installedVersion||'';
    version.placeholder='예: 천망성역 V0.9.2 (실제 설치 확인한 버전)';
    versionBox.append(versionLabel,version);
    const notesBox=el('div','runtime-field');
    const notesLabel=el('label','','실행 과정·결과·실패 증상');
    const notes=el('textarea');notes.rows=4;notes.maxLength=2500;
    notes.placeholder='예: 링크 소재로 사용했지만 발동창이 나타나지 않음. 상대 필드에는 ...';
    notesBox.append(notesLabel,notes);
    const logBox=el('div','runtime-field');
    const logLabel=el('label','','EDOPro Lua 오류 로그 (선택)');
    const log=el('textarea');log.rows=4;log.maxLength=12000;
    log.placeholder='예: script/c990470109.lua:42: attempt to call a nil value';
    logBox.append(logLabel,log);
    const actions=el('div','runtime-form-actions');
    const save=el('button','runtime-save','시험 결과 저장');save.type='submit';
    actions.append(save);
    form.append(statusBox,versionBox,notesBox,logBox,actions);
    form.addEventListener('submit',(event)=>{
      event.preventDefault();
      try {
        const next=makeTestEntry({test,status:statusSelect.value,installedVersion:version.value,
          notes:notes.value,log:log.value});
        // 덮어쓰지 않고 날짜/버전을 포함한 새 기록으로 추가합니다.
        persist(mergeTestRecords(records,[next]));
        selectedCaseKey=test.key;
        setNotice(storageAvailable?'시험 기록을 브라우저에 저장했습니다.':'임시 탭 기록입니다. 종료 전 JSON 백업을 저장하세요.');
        render();
      } catch(error) {setNotice(error.message,true);}
    });
    detail.append(form);

    const history=el('section','runtime-history');
    history.append(el('h4','','검증 이력 · '+recent.length+'건'));
    if(!recent.length) history.append(el('p','runtime-empty','아직 EDOPro 시험 결과를 직접 입력한 적이 없습니다.'));
    for(const entry of recent.slice(0,12)) {
      const row=el('article','runtime-history-item');
      const title=el('div','runtime-history-top',
        STATUSES[entry.status]+' · '+entry.installedVersion+' · '+formatTime(entry.time));
      row.append(title);
      if(entry.notes) row.append(el('p','runtime-history-notes',entry.notes));
      if(entry.references.length){
        const refs=entry.references.map(ref=>'c'+ref.cardId+'.lua'+(ref.line?':'+ref.line:'')).join(', ');
        const hasOther=entry.references.some(ref=>ref.cardId!==test.id);
        row.append(el('p','runtime-log-refs','로그에 등장하는 Lua: '+refs+
          (hasOther?' · 다른 카드 ID도 포함되어 있어 수동 확인 필요':'')));
      }
      if(entry.log) {
        const section=el('details','runtime-log-details');
        section.append(el('summary','','저장한 로그 원문 보기'),el('pre','',entry.log));
        row.append(section);
      }
      history.append(row);
    }
    detail.append(history);
  }
  function render() {
    const current=plan();
    const count=summarizeRecordedTests(current.cases,records);
    const review=queue();
    triageShortcut.disabled=!review.items.length;
    triageExport.disabled=!review.items.length;
    stats.textContent='대상 '+count.total+'건 · 미실행 '+count.untested+
      ' · 통과 '+count.pass+' · 실패 '+count.fail+
      ' · 보류 '+count.blocked+' · 재검증 '+count.retest;
    summary.textContent='수동 시험 기록 '+(count.total-count.untested)+'/'+count.total+'건';
    openButton.disabled=!current.cases.length;
    if(!dialog.open) return;

    const visible=currentCases();
    const matching=visible.find(item=>item.key===selectedCaseKey);
    if(!matching) {
      const currentCard=getSelectedKey();
      selectedCaseKey=visible.find(item=>item.key.startsWith(currentCard+':'))?.key || visible[0]?.key || null;
    }
    const last=list.scrollTop;
    list.replaceChildren();
    const latest=latestForCases(records);
    let lastCard='';
    for(const test of visible){
      const cardKey=test.theme+':'+test.id;
      if(cardKey!==lastCard) {
        list.append(el('div','runtime-list-heading',test.name+' · '+test.id));
        lastCard=cardKey;
      }
      const button=el('button','runtime-case-item'+(selectedCaseKey===test.key?' selected':''));
      button.type='button';
      button.append(el('span','',test.title),
        el('small','runtime-state runtime-'+effectiveTestStatus(test,latest.get(test.key)),
          statusLabel(test,latest.get(test.key))));
      button.addEventListener('click',()=>{
        selectedCaseKey=test.key;
        render();
      });
      list.append(button);
    }
    list.scrollTop=last;
    renderDetail(visible.find(item=>item.key===selectedCaseKey)||null);
    jsonExport.disabled=!records.length&&!investigations.length;
    markdownExport.disabled=!current.cases.length;
    if(!storageAvailable && !notice.textContent)
      setNotice('이 브라우저에서는 영구 저장이 불가능해 임시 기록으로 사용 중입니다. JSON 백업을 권장합니다.',true);
  }
  function open() {
    if(!plan().cases.length) return;
    lastFocus=document.activeElement;
    selectedCaseKey=null;search.value='';filter.value='all';
    setNotice('');
    dialog.showModal();
    render();
    close.focus();
  }
  openButton.addEventListener('click',open);
  close.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>lastFocus?.focus?.());
  search.addEventListener('input',()=>{selectedCaseKey=null;render();});
  filter.addEventListener('change',()=>{selectedCaseKey=null;render();});
  triageShortcut.addEventListener('click',()=>{
    if(!queue().items.length)return;
    filter.value='needs_review';selectedCaseKey=null;render();
  });
  triageExport.addEventListener('click',()=>{
    const review=queue();
    if(!review.items.length)return;
    downloadText('종언성서_'+(review.theme==='전체'?'전체':review.theme)+
      '_실패원인_조사및재시험_V0.7.4.md',
      failureQueueMarkdown(review),'text/markdown;charset=utf-8');
  });
  jsonExport.addEventListener('click',()=>{
    if(!records.length) return;
    const backup=JSON.parse(encodeTestRecords(records));
    backup.investigations=JSON.parse(encodeInvestigations(investigations)).items;
    downloadText('디자인랩_실전시험및조사_백업_V0.7.4.json',
      JSON.stringify(backup,null,2),'application/json;charset=utf-8');
  });
  markdownExport.addEventListener('click',()=>{
    const p=plan();
    if(!p.cases.length) return;
    downloadText('종언성서_'+(p.theme==='전체'?'전체':p.theme)+'_EDOPro_실전검증기록_V0.7.3.md',
      recordedTestMarkdown(p,records),'text/markdown;charset=utf-8');
  });
  jsonImport.addEventListener('change',async()=>{
    const input=jsonImport.files?.[0];jsonImport.value='';
    if(!input) return;
    if(input.size>1000000) {setNotice('JSON 백업은 1MB 이하만 가져올 수 있습니다.',true);return;}
    try {
      const payload=JSON.parse(await input.text());
      if(payload?.schema!==1 || payload?.kind!=='DESIGN_LAB_MANUAL_EDOPRO' || !Array.isArray(payload.entries))
        throw new Error('DESIGN LAB V0.7.3 백업 파일 형식이 아닙니다.');
      if(payload.investigations!==undefined&&!Array.isArray(payload.investigations))
        throw new Error('조사 기록 형식이 올바르지 않습니다.');
      const imported=decodeTestRecords(payload);
      const importedNotes=decodeInvestigations({schema:1,items:payload.investigations||[]});
      if(!imported.length && payload.entries.length)
        throw new Error('유효한 수동 시험 기록이 없습니다.');
      if(payload.investigations?.length && !importedNotes.length)
        throw new Error('유효한 원인 조사 기록이 없습니다.');
      const before=records.length;
      persist(mergeTestRecords(records,imported));
      persistInvestigation(mergeInvestigations(investigations,importedNotes));
      setNotice('시험 기록 '+imported.length+'건, 조사 기록 '+importedNotes.length+
        '건을 가져와 기존 이력과 병합했습니다. 현재 시험 기록 '+records.length+
        '건 (기존 '+before+'건).');
      render();
    }catch(error){setNotice('JSON 가져오기 실패: '+error.message,true);}
  });
  return {sync:render,getRecords:()=>[...records],getInvestigations:()=>[...investigations]};
}
