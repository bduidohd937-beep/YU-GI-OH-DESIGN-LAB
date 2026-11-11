import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseDocuments} from '../src/parser.js';
import {buildAudit} from '../src/audit.js';
import {categorizeImportNotices} from '../src/import-notice-ui.js';

const txt=(name,text)=>({name,text});
const source=txt('천망성역_V0.9_전체카드_최종개정원문.txt',
  '《천망성역》 V0.9\n[카드 원문]\n[990470100] 천망성역－예언자 노에마\n①: 특수 소환한다.\n[변경 및 검증 메모]');

test('천망성역 패키지 SHA 검수보고서 설치안내 TXT는 오류가 아닌 제외 목록',()=>{
  const info=[
    txt('천망성역_V0.9.1_SHA256.txt','a'.repeat(64)+'  c990470100.lua'),
    txt('천망성역_V0.9.1_안정화_검수보고서.txt','Lua 초기화 시험'),
    txt('천망성역_V0.9_검수보고서.txt','CDB 점검 보고서'),
    txt('검수_및_설치안내.txt','EDOPro 설치 안내')
  ];
  const parsed=parseDocuments([source,...info]);
  assert.equal(parsed.documents.length,1);
  assert.deepEqual(parsed.skippedDocuments,info.map(x=>x.name));
  assert.equal(parsed.warnings.length,0);
});

test('원문 파일이라는 이름인데 카드 원문 구역이 없으면 진짜 경고 남김',()=>{
  const parsed=parseDocuments([txt('천망성역_원문.txt','잘못된 형식')]);
  assert.equal(parsed.skippedDocuments.length,0);
  assert.ok(parsed.warnings.some(x=>x.includes('카드 원문 구역을 찾을 수 없습니다')));
});

test('같은 버전의 서로 다른 내용은 해결되지 않은 충돌로 유지',()=>{
  const a=source;
  const b={...a,name:'천망성역_다른_원문.txt',text:a.text.replace('특수 소환한다.','패에 넣는다.')};
  const parsed=parseDocuments([a,b]);
  assert.equal(parsed.documents.length,1);
  assert.ok(parsed.warnings.some(x=>x.includes('원문 버전 충돌 확인 필요:')));
});

test('중복 동일 문구는 경고 없이 원문 하나로 합침',()=>{
  const parsed=parseDocuments([source,source]);
  assert.equal(parsed.documents.length,1);
  assert.equal(parsed.warnings.length,0);
});

test('실제 검사 결과에 자동 제외된 참고 TXT 목록 포함',()=>{
  const result=buildAudit({textFiles:[source,txt('검수_및_설치안내.txt','설치 안내')]});
  assert.equal(result.counts.source,1);
  assert.equal(result.skippedDocuments.length,1);
});

test('버전 안내는 정보이고 내용 충돌·읽기 실패는 확인 필요',()=>{
  const result=categorizeImportNotices({
    warnings:[
      '천망성역.zip : 별도 선택 설치용 TXT/CDB/Lua 3개는 본체 자동 검수에서 제외했습니다.',
      '테마 원문 버전 안내: 천망성역 원문 2개 중 V0.9.1 사용',
      '원문 버전 충돌 확인 필요: 천망성역 원문 2개, 같은 버전 문구 차이',
      'CDB 읽기 실패 — 잘못된 sqlite'
    ],
    skippedDocuments:['천망성역_V0.9.1_SHA256.txt','검수_및_설치안내.txt']
  });
  assert.equal(result.infoCount,2);
  assert.equal(result.reviewCount,2);
  assert.equal(result.skipped.length,2);
  assert.match(result.exportText,/검사 대상이 아닌 TXT/);
});

test('경고 영역은 별도 dialog 화면이 열리고 닫기·복사 버튼이 존재',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const js=readFileSync(new URL('../src/import-notice-ui.js',import.meta.url),'utf8');
  const css=readFileSync(new URL('../src/import-notices.css',import.meta.url),'utf8');
  const audit=readFileSync(new URL('../src/audit-ui.js',import.meta.url),'utf8');
  for(const id of ['audit-notices-dialog','audit-notices-title','audit-notices-subtitle',
    'audit-notices-body','audit-notices-copy','audit-notices-close','audit-warnings'])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(js,/dialog\.showModal\(\)/);
  assert.match(js,/dialog\.close\(\)/);
  assert.match(js,/clipboard\.writeText/);
  assert.match(css,/height:min\(86vh,820px\)/);
  assert.match(audit,/importNotices\.render\(result\)/);
});

test('경고로 전달된 파일명·설명은 HTML이 아닌 안전한 텍스트 출력',()=>{
  const s=readFileSync(new URL('../src/import-notice-ui.js',import.meta.url),'utf8');
  assert.match(s,/textContent = text/);
  assert.doesNotMatch(s,/innerHTML|eval\(/);
});

test('검수 카드의 정적 분석과 실전 미검증 표기는 유지',()=>{
  const r=buildAudit({textFiles:[source]});
  assert.equal(r.coverage.hasCdb,false);
  assert.equal(r.coverage.hasLua,false);
  assert.match(r.note,/실제 효과 발동/);
});
