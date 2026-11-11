// V0.7.3 — EDOPro 수동 시험 기록. 원문과 로그는 브라우저 내부에만 보관합니다.
// 기록 없는 시험의 상태는 항상 미실행. 입력 로그는 실제 엔진 실행 증거가 아닙니다.
import {versionFromFilename,compareVersions} from './package-versions.js';

export const TEST_RECORDS_KEY = 'design-lab:edopro-manual-results:v1';
export const MAX_RECORDS = 1200;
export const STATUSES = Object.freeze({
  pass: '통과', fail: '실패', blocked: '보류', retest: '재검증 필요'
});
const bound = (value, limit) => String(value ?? '').slice(0,limit);
const textField = (value, limit) => typeof value === 'string' ? value.slice(0,limit) : '';
const validStatus = (value) => Object.prototype.hasOwnProperty.call(STATUSES,value);

export function parseLuaErrorReferences(log = '') {
  const matches = [];
  const text = String(log).slice(0,16000);
  const regex = /\bc(\d{6,10})\.lua(?::(\d{1,6}))?/gim;
  const seen = new Set();
  for (const hit of text.matchAll(regex)) {
    const key = hit[1] + ':' + (hit[2] || '');
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({cardId:hit[1],line:hit[2] ? Number(hit[2]) : null});
    if (matches.length>=20) break;
  }
  return matches;
}

export function sanitizeTestEntry(value) {
  if (!value || typeof value !== 'object' || !validStatus(value.status)) return null;
  if (typeof value.caseKey !== 'string' || !value.caseKey.trim() || value.caseKey.length>350) return null;
  if (typeof value.id !== 'string' || !value.id || value.id.length>150) return null;
  const date = new Date(value.time);
  if (!Number.isFinite(date.getTime())) return null;
  const log = textField(value.log,12000);
  return {
    id: value.id,
    time: date.toISOString(),
    caseKey:value.caseKey,
    cardId:textField(value.cardId,15),
    cardName:textField(value.cardName,160),
    theme:textField(value.theme,70),
    caseTitle:textField(value.caseTitle,200),
    status:value.status,
    installedVersion:textField(value.installedVersion,120),
    expectedText:textField(value.expectedText,2000),
    notes:textField(value.notes,2500),
    log,
    references:parseLuaErrorReferences(log)
  };
}

export function decodeTestRecords(raw) {
  if (!raw) return [];
  let input;
  try { input = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { return []; }
  if (!input || input.schema !== 1 || !Array.isArray(input.entries)) return [];
  const unique = new Map();
  for (const value of input.entries.slice(-MAX_RECORDS)) {
    const item = sanitizeTestEntry(value);
    if (item) unique.set(item.id,item);
  }
  return [...unique.values()].sort((a,b)=>a.time.localeCompare(b.time)).slice(-MAX_RECORDS);
}

export function encodeTestRecords(entries) {
  return JSON.stringify({schema:1,kind:'DESIGN_LAB_MANUAL_EDOPRO',entries:
    entries.slice(-MAX_RECORDS).map(sanitizeTestEntry).filter(Boolean)},null,2);
}

export function latestForCases(entries = []) {
  const byKey = new Map();
  for (const record of entries) {
    if (!validStatus(record.status)) continue;
    const prev=byKey.get(record.caseKey);
    if (!prev || prev.time<=record.time) byKey.set(record.caseKey,record);
  }
  return byKey;
}

export function effectiveTestStatus(test, saved) {
  if (!saved || !validStatus(saved.status)) return 'untested';
  // 이전 실행 기록을 남기되, 파일 버전이나 승인 효과 문안이 바뀌면 재시험 대상으로 봅니다.
  const currentVersion = versionFromFilename(test.lua || '');
  const recordedVersion = versionFromFilename(saved.installedVersion || '');
  if (currentVersion && recordedVersion && compareVersions(currentVersion,recordedVersion)!==0) return 'retest';
  if (saved.expectedText && test.expected && saved.expectedText!==String(test.expected).slice(0,2000)) return 'retest';
  return saved.status;
}

export function summarizeRecordedTests(cases = [], entries = []) {
  const latest = latestForCases(entries);
  const counters = {total:cases.length, untested:0, pass:0, fail:0, blocked:0, retest:0};
  for (const item of cases) {
    const status=effectiveTestStatus(item,latest.get(item.key));
    if (status==='untested') counters.untested++;
    else counters[status]++;
  }
  return counters;
}

export function makeTestEntry({test, status, installedVersion='', notes='', log='', time, id}) {
  if (!test || typeof test.key !== 'string' || !validStatus(status))
    throw new Error('시험 항목과 수동 판정을 선택해 주세요.');
  if (!installedVersion.trim()) throw new Error('EDOPro에 실제 설치한 카드 버전을 입력해 주세요.');
  if (status==='fail' && !String(notes).trim() && !String(log).trim())
    throw new Error('실패 판정에는 실제 증상이나 Lua 로그를 하나 이상 기록해 주세요.');
  const raw = {
    id:id || (typeof crypto!=='undefined' && crypto.randomUUID ? crypto.randomUUID() :
      'local-'+new Date().getTime()+'-'+Math.random().toString(36).slice(2)),
    time:time || new Date().toISOString(),
    caseKey:test.key, cardId:bound(test.id,15), cardName:bound(test.name,160),
    theme:bound(test.theme,70), caseTitle:bound(test.title,200),
    status,installedVersion,notes,log,expectedText:bound(test.expected,2000)
  };
  const entry=sanitizeTestEntry(raw);
  if (!entry) throw new Error('검증 기록 형식이 올바르지 않습니다.');
  return entry;
}

export function mergeTestRecords(current, incoming) {
  const m=new Map();
  for (const item of [...current,...incoming]) {
    const v=sanitizeTestEntry(item);
    if (v) m.set(v.id,v);
  }
  return [...m.values()].sort((a,b)=>a.time.localeCompare(b.time)).slice(-MAX_RECORDS);
}

export function recordedTestMarkdown(plan, entries = []) {
  const latest=latestForCases(entries);
  const count=summarizeRecordedTests(plan.cases,entries);
  const lines=[
    '# DESIGN LAB V0.7.3 — EDOPro 수동 검증 기록',
    '',
    '대상 테마: '+plan.theme,
    '시험 항목: '+count.total+'건 · 미실행 '+count.untested+
      ' / 통과 '+count.pass+' / 실패 '+count.fail+' / 보류 '+count.blocked+
      ' / 재검증 필요 '+count.retest,
    '',
    '> 결과는 사용자가 직접 기록한 판정입니다. DESIGN LAB이 EDOPro를 실행하거나 로그의 진위를 검증하지 않았습니다.',
    ''
  ];
  for(const [i,test] of plan.cases.entries()) {
    const saved=latest.get(test.key);
    const history=entries.filter((e)=>e.caseKey===test.key);
    lines.push('## '+(i+1)+'. '+test.theme+' / '+test.name+' ['+test.id+']',
      '',
      '- 시험: '+test.title,
      '- 준비: '+test.steps,
      '- 기대 결과: '+test.expected,
      '- 상태: '+(saved ? (effectiveTestStatus(test,saved)==='retest' && saved.status!=='retest'
        ? '재검증 필요 (검사 파일 버전/효과 문구 변경; 이전 판정 '+STATUSES[saved.status]+')'
        : STATUSES[effectiveTestStatus(test,saved)]) : '미실행'),
      '- 실제 설치 버전: '+(saved?.installedVersion || '미기록'),
      '- 최근 기록 시각: '+(saved?.time || '미기록'),
      '- 시험 기록 수: '+history.length);
    if(saved?.notes) lines.push('- 실제 결과/메모: '+saved.notes.replace(/\n/g,'\n  '));
    if(saved?.references?.length) lines.push('- 로그에서 발견한 Lua 참조: '+saved.references
      .map((ref)=>'c'+ref.cardId+'.lua'+(ref.line?':'+ref.line:'')).join(', '));
    if(saved?.log) lines.push('','    '+saved.log.split('\n').join('\n    '));
    lines.push('');
  }
  lines.push('---','모든 시험 결과는 수동 입력 기록이며, 다른 버전 코드에 대한 통과 보증이 아닙니다.','');
  return lines.join('\n');
}
