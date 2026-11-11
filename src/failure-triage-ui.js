// V0.7.4 — 수동 실패 조사표: 정적 코드와 사용자 로그를 명확히 구분합니다.
import {TRIAGE_STATES} from './failure-triage.js';

const el=(tag,cls='',text)=>{
  const node=document.createElement(tag);
  if(cls)node.className=cls;
  if(text!==undefined)node.textContent=text;
  return node;
};
function field(label,tag='textarea',rows=3,maxLength=1600,value=''){
  const outer=el('div','runtime-field');
  const name=el('label','',label);
  const input=el(tag);
  if(tag==='textarea')input.rows=rows;
  input.maxLength=maxLength;
  input.value=value;
  outer.append(name,input);
  return {outer,input};
}
function itemRow(label,value){
  const row=el('p','triage-fact');
  row.append(el('strong','',label+' · '),document.createTextNode(value||'기록 없음'));
  return row;
}

export function createFailureInvestigationPanel(item,{onSave}={}){
  const panel=el('section','triage-panel');
  panel.append(el('div','triage-eyebrow','실패 원인 조사 · 자동 판정 아님'));
  panel.append(el('h4','',item.effectiveStatus==='fail'?'실패 상황 조사'
    :item.effectiveStatus==='retest'?'재검증 계획':'보류된 시험 조사'));
  const sub=el('p','triage-hint','아래는 사용자가 입력한 결과 및 등록된 Lua 정적 근거입니다. 실제 오류 원인을 확정하거나 파일을 변경하지 않습니다.');
  panel.append(sub);
  if(item.entry){
    const facts=el('div','triage-facts');
    facts.append(
      itemRow('실제로 시험한 패키지',item.entry.installedVersion),
      itemRow('검사기에 연결된 Lua',item.test.lua),
      itemRow('실제 관찰',item.entry.notes),
      itemRow('수동 시험 시각',item.entry.time)
    );
    panel.append(facts);
  }
  if(item.logHits.length){
    const section=el('section','triage-section');
    section.append(el('h5','','Lua 로그 참조 · '+item.logHits.length+'건'));
    for(const hit of item.logHits){
      const row=el('article','triage-hit');
      const target=hit.cardName?' · '+hit.cardName:' · 연결된 카드 없음';
      row.append(el('strong','',
        'c'+hit.cardId+'.lua'+(hit.line?':'+hit.line:'')+target));
      row.append(el('p','triage-note',
        hit.otherCard
          ? '다른 카드의 Lua가 로그에 등장합니다. 이 카드의 오류 원인이라고 단정할 수 없습니다.'
          :hit.versionRelation==='different'
            ? '시험 당시 패키지와 등록된 Lua 버전이 달라 코드 줄번호 대조를 보류했습니다.'
            :hit.versionRelation==='unknown'
              ? '두 버전의 일치 여부를 파일명만으로 확인하지 못했습니다. 줄번호 근거를 확정하지 않습니다.'
              :'현재 등록된 Lua와 시험 버전 표기가 일치합니다. 실제 설치본도 동일한지 확인하세요.'));
      if(hit.context){
        row.append(el('div','triage-context-label','등록 Lua · '+hit.context.from+'~'+hit.context.to+'행 (단서)'));
        row.append(el('pre','triage-code',hit.context.code));
      }
      section.append(row);
    }
    panel.append(section);
  }else if(item.entry?.log){
    panel.append(el('p','triage-note','오류 로그는 있지만 c숫자.lua:줄 형식의 파일 위치를 찾지 못했습니다. 로그 원문을 확인하세요.'));
  }

  if(item.issues.length){
    const section=el('section','triage-section');
    section.append(el('h5','','관련 카드의 정적 검사 후보 · '+item.issues.length+'건'));
    for(const issue of item.issues){
      const row=el('div','triage-static');
      row.append(el('strong','', '['+issue.code+'] '+issue.title));
      row.append(el('p','',issue.detail||'정적 근거 설명 없음'));
      if(issue.line)row.append(el('small','',(issue.file||item.card?.lua||'Lua')+':'+issue.line));
      section.append(row);
    }
    panel.append(section);
  }else{
    panel.append(el('p','triage-note','관련 카드에서 현재 확인 가능한 정적 검사 문제 후보가 없습니다. 이는 효과가 정상이라는 증명이 아닙니다.'));
  }
  const checklist=el('section','triage-section');
  checklist.append(el('h5','','원인 조사·재시험 체크리스트'));
  const list=el('ol','triage-checklist');
  for(const step of item.guidance)list.append(el('li','',step.replace(/^[①②③④⑤⑥]\s*/,'').trim()));
  checklist.append(list);panel.append(checklist);

  const form=el('form','triage-form');
  form.append(el('h5','','조사 메모·수정 검토안 기록'));
  const stateRow=el('div','runtime-field');
  stateRow.append(el('label','','조사 진행 상태'));
  const state=el('select');
  for(const [key,title] of Object.entries(TRIAGE_STATES)){
    const option=el('option','',title);option.value=key;state.append(option);
  }
  state.value=item.investigation?.state||'investigating';
  stateRow.append(state);
  const hypothesis=field('조사 가설 (확정 원인이 아니라 추정임)', 'textarea',3,1600,item.investigation?.hypothesis||'');
  const suggested=field('수정 검토안 (승인 전 코드 변경 금지)','textarea',4,2200,item.investigation?.suggestedChange||'');
  const retest=field('수정 후 재시험 시나리오','textarea',3,1600,item.investigation?.retestSteps||'');
  form.append(stateRow,hypothesis.outer,suggested.outer,retest.outer);
  const actions=el('div','runtime-form-actions');
  const save=el('button','runtime-save','조사 기록 저장');
  save.type='submit';actions.append(save);form.append(actions);
  form.addEventListener('submit',e=>{
    e.preventDefault();
    onSave?.({caseKey:item.key,state:state.value,
      hypothesis:hypothesis.input.value,suggestedChange:suggested.input.value,
      retestSteps:retest.input.value});
  });
  panel.append(form);
  return panel;
}
