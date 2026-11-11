// V0.7.4 — 수동 실패 기록과 최신 Lua/CDB 정적 근거를 연결하는 검토 대기열.
// 자동 원인 확정·Lua 수정·EDOPro 시험은 수행하지 않습니다.
import {latestForCases,effectiveTestStatus} from './test-records.js';
import {versionFromFilename,compareVersions} from './package-versions.js';

export const TRIAGE_KEY = 'design-lab:edopro-investigation:v1';
export const TRIAGE_STATES = Object.freeze({
  investigating:'원인 조사 중',
  proposed:'수정안 검토',
  awaiting_retest:'수정 후 재시험 대기'
});
const LIMIT=700;
const bounded=(value,size)=>typeof value==='string'?value.slice(0,size):'';
const STATES=new Set(Object.keys(TRIAGE_STATES));

export function sanitizeInvestigation(value) {
  if(!value||typeof value!=='object') return null;
  const {caseKey,state,updatedAt}=value;
  if(typeof caseKey!=='string'||!caseKey.trim()||caseKey.length>350||!STATES.has(state))return null;
  const date=new Date(updatedAt);
  if(!Number.isFinite(date.getTime()))return null;
  return {caseKey,state,updatedAt:date.toISOString(),
    hypothesis:bounded(value.hypothesis,1600),
    suggestedChange:bounded(value.suggestedChange,2200),
    retestSteps:bounded(value.retestSteps,1600)};
}
export function decodeInvestigations(raw) {
  if(!raw)return [];
  let obj;
  try{obj=typeof raw==='string'?JSON.parse(raw):raw;}catch{return [];}
  if(!obj||obj.schema!==1||!Array.isArray(obj.items))return [];
  const map=new Map();
  for(const rawItem of obj.items.slice(-LIMIT)){
    const v=sanitizeInvestigation(rawItem);
    if(v && (!map.has(v.caseKey)||map.get(v.caseKey).updatedAt<=v.updatedAt))map.set(v.caseKey,v);
  }
  return [...map.values()].sort((a,b)=>a.updatedAt.localeCompare(b.updatedAt)).slice(-LIMIT);
}
export function encodeInvestigations(items){
  return JSON.stringify({schema:1,items:items.slice(-LIMIT).map(sanitizeInvestigation).filter(Boolean)},null,2);
}
export function mergeInvestigations(existing,incoming){
  return decodeInvestigations({schema:1,items:[...existing,...incoming]});
}

export function makeInvestigation({caseKey,state,hypothesis='',suggestedChange='',retestSteps='',updatedAt}){
  const value=sanitizeInvestigation({caseKey,state,hypothesis,suggestedChange,retestSteps,updatedAt:updatedAt||new Date().toISOString()});
  if(!value)throw new Error('조사 상태와 시험 대상을 확인하세요.');
  if(state==='proposed'&&!value.suggestedChange.trim())
    throw new Error('수정안 검토 상태에는 검토할 수정 방향을 입력해야 합니다.');
  if(state==='awaiting_retest'&&(!value.suggestedChange.trim()||!value.retestSteps.trim()))
    throw new Error('재시험 대기 상태에는 수정 방향과 재현 절차가 필요합니다.');
  return value;
}

export function compareInstalledVersion(test,entry) {
  if(!entry)return 'unrecorded';
  const current=versionFromFilename(test.lua||'');
  const installed=versionFromFilename(entry.installedVersion||'');
  if(!current||!installed)return 'unknown';
  return compareVersions(current,installed)===0?'same':'different';
}

export function getLineContext(source,line,range=2) {
  if(typeof source!=='string'||!Number.isSafeInteger(line)||line<=0)return null;
  const lines=source.replace(/\r\n?/g,'\n').split('\n');
  if(line>lines.length)return null;
  const start=Math.max(1,line-range),end=Math.min(lines.length,line+range);
  return {line,from:start,to:end,code:lines.slice(start-1,end)
    .map((value,i)=>(start+i===line?'→ ':'  ')+(start+i)+' | '+value)
    .join('\n').slice(0,2400)};
}
const relevantIssue=(issue)=>issue&&['error','warning','info'].includes(issue.severity) &&
  !['CDB_NOT_IMPORTED','LUA_NOT_IMPORTED','SOURCE_ID_UNSPECIFIED','CDB_THEME_NOT_IMPORTED','LUA_THEME_NOT_IMPORTED','SOURCE_NOT_IMPORTED'].includes(issue.code);
function candidateGuidance(entry,card,logHits){
  const steps=[
    '① 실제 설치된 CDB·Lua 버전을 기록된 시험 버전과 대조한다.',
    '② 원문 효과의 발동 조건·체인 처리·효과 사용 제한을 시험 상황과 비교한다.'
  ];
  if(logHits.length)steps.push('③ 로그에 나타난 Lua 파일·줄번호를 확인하고 동일 버전 코드에서 해당 줄을 재현한다.');
  else steps.push('③ 오류 로그가 없다면 실패 상황의 필드·소재·체인 상태를 구체적으로 기록한다.');
  if(card?.issues?.some(x=>x.code==='OPTIONAL_TRIGGER_TIMING'))steps.push('④ 유발 효과의 타이밍 및 EFFECT_FLAG_DELAY 적용 여부를 확인한다.');
  if(card?.issues?.some(x=>x.code==='REASON_BITMASK_COMPARE'))steps.push('④ 소재·묘지 이동 사유 판정의 비트 연산을 확인한다.');
  if(/attempt to (?:call|index)|nil value/i.test(entry?.log||''))steps.push('⑤ 로그의 nil 호출·접근 대상이 어떤 값인지 동일 버전 Lua에서 확인한다.');
  steps.push('⑥ 수정안을 승인하고 백업한 뒤 패치하여 같은 조건 및 반대 조건으로 재시험한다.');
  return steps;
}

export function buildFailureQueue(result,plan,records=[],investigations=[]) {
  const cards=result?.cards||[];
  const cardById=new Map(cards.filter(c=>c.id).map(c=>[String(c.id),c]));
  const latest=latestForCases(records);
  const byCase=new Map(investigations.map(item=>[item.caseKey,item]));
  const items=[];
  for(const test of plan?.cases||[]) {
    const entry=latest.get(test.key)||null;
    const effective=effectiveTestStatus(test,entry);
    if(!['fail','retest','blocked'].includes(effective))continue;
    const primary=cardById.get(String(test.id))||null;
    const issues=(primary?.issues||[]).filter(relevantIssue);
    const logHits=(entry?.references||[]).map(ref=>{
      const card=cardById.get(String(ref.cardId))||null;
      const related=String(ref.cardId)!==String(test.id);
      const isCurrent=compareInstalledVersion(test,entry);
      // 패치 버전이 다르면 현재 Lua 줄번호를 옛 로그의 줄번호라고 표현하지 않습니다.
      const canShow=card && !!card.luaSource && isCurrent==='same' && !related;
      return {cardId:String(ref.cardId),line:ref.line,cardName:card?.name||null,
        script:card?.lua||null,otherCard:related,
        versionRelation:isCurrent,
        context:canShow?getLineContext(card.luaSource,ref.line):null};
    });
    const investigation=byCase.get(test.key)||null;
    items.push({
      key:test.key,test,entry,card:primary,effectiveStatus:effective,
      investigation,issues:issues.slice(0,12),logHits,
      guidance:candidateGuidance(entry,primary,logHits),
      priority:effective==='fail'?1:effective==='retest'?2:3
    });
  }
  items.sort((a,b)=>a.priority-b.priority||(b.entry?.time||'').localeCompare(a.entry?.time||''));
  return {theme:plan?.theme||'전체',items,
    counts:{fail:items.filter(x=>x.effectiveStatus==='fail').length,
      retest:items.filter(x=>x.effectiveStatus==='retest').length,
      blocked:items.filter(x=>x.effectiveStatus==='blocked').length},
    note:'자동 조사 대기열이며 문제의 실제 원인은 확정되지 않았습니다. 로그는 사용자가 입력한 기록입니다.'};
}

export function failureQueueMarkdown(queue) {
  const out=[
    '# DESIGN LAB V0.7.4 — 실전 실패 원인 조사·수정 검토 목록','',
    '대상 테마: '+queue.theme,
    '실패 '+queue.counts.fail+'건 / 재검증 필요 '+queue.counts.retest+
      '건 / 보류 '+queue.counts.blocked+'건','',
    '> 이 보고서는 사용자의 EDOPro 수동 기록과 정적 코드 근거를 결합한 조사 목록입니다. 자동 원인 확정이나 카드 패치는 하지 않았습니다.',''
  ];
  for(const [i,item] of queue.items.entries()){
    const {test,entry,investigation}=item;
    out.push('## '+(i+1)+'. '+test.theme+' / '+test.name+' ['+test.id+']','',
      '- 시험: '+test.title,
      '- 현재 상태: '+({fail:'실패',retest:'재검증 필요',blocked:'보류'}[item.effectiveStatus]),
      '- 실제 설치 버전: '+(entry?.installedVersion||'미기록'),
      '- 입력된 Lua 파일: '+(test.lua||'미등록'),
      '- 실행 절차: '+test.steps,
      '- 기대 결과: '+test.expected,
      '- 실제 관찰: '+(entry?.notes||'구체적인 증상 미기록'),
      '- 조사 상태: '+(investigation?.state?TRIAGE_STATES[investigation.state]:'미착수'),'');
    if(item.logHits.length){
      out.push('### 로그 파일 참조 (원인 확정 아님)','');
      for(const hit of item.logHits){
        out.push('- c'+hit.cardId+'.lua'+(hit.line?':'+hit.line:'')+
          (hit.otherCard?' · 다른 카드 참조':'')+
          ' · 현재 버전 비교: '+hit.versionRelation);
        if(hit.context)out.push('','    '+hit.context.code.replace(/\n/g,'\n    '),'');
      }
    }
    if(item.issues.length){
      out.push('### 기존 정적 검사 후보','');
      for(const x of item.issues)out.push('- ['+x.code+'] '+x.title+': '+x.detail);
      out.push('');
    }
    if(investigation){
      if(investigation.hypothesis)out.push('- 조사 가설: '+investigation.hypothesis);
      if(investigation.suggestedChange)out.push('- 제안 수정 방향: '+investigation.suggestedChange);
      if(investigation.retestSteps)out.push('- 재시험 절차: '+investigation.retestSteps);
      out.push('');
    }
    out.push('### 조사·재현 체크리스트','',...item.guidance.map(s=>'- [ ] '+s),'');
  }
  if(!queue.items.length)out.push('현재 실패·재검증·보류로 남은 수동 시험 기록이 없습니다. 실제 시험 후 상태를 기록하세요.','');
  return out.join('\n');
}
