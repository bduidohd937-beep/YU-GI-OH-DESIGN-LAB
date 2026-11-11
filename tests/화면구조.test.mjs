import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { splitCardEffects } from '../src/effects.js';
import { normalizeView, VIEW_NAMES } from '../src/layout.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const audit = readFileSync(new URL('../src/audit-ui.js', import.meta.url), 'utf8');
const layoutCss = readFileSync(new URL('../src/layout.css', import.meta.url), 'utf8');

test('V0.3 세 작업실의 탭과 독립 뷰가 존재한다', () => {
  for (const id of Object.keys(VIEW_NAMES)) {
    assert.match(html, new RegExp('id="tab-' + id + '"'));
    assert.match(html, new RegExp('id="view-' + id + '"'));
  }
  assert.match(html, /id="view-audit"[^>]*\bhidden\b/);
  assert.match(html, /id="view-deck"[^>]*\bhidden\b/);
});

test('탭 변경 시 알 수 없는 경로는 자료실로 안전하게 돌아간다', () => {
  assert.equal(normalizeView('audit'), 'audit');
  assert.equal(normalizeView('deck'), 'deck');
  assert.equal(normalizeView('unknown'), 'library');
  assert.equal(normalizeView('__proto__'), 'library');
});

test('새 레이아웃이 기존 자료실 이벤트 ID를 보존한다', () => {
  for (const id of ['file-input','dropzone','message','theme-tabs','card-list','card-detail',
    'document-notes','search','keyword-filter','result-count','export-report',
    'stat-themes','stat-cards','stat-keywords']) {
    assert.match(html, new RegExp('id="' + id + '"'), id);
  }
  assert.match(main, /renderDetail\(/);
});

test('V0.2 검수 기능 ID와 UI 스크립트 연결을 보존한다', () => {
  for (const id of ['audit-input','audit-message','audit-stat-source','audit-stat-cdb',
    'audit-stat-lua','audit-stat-issues','audit-results','audit-detail','audit-filter',
    'audit-export','audit-warnings']) {
    assert.match(html, new RegExp('id="' + id + '"'), id);
  }
  assert.match(html, /src\/audit-ui\.js/);
  assert.match(audit, /buildAudit\(/);
});

test('모바일과 데스크톱 독립 스크롤 스타일을 정의한다', () => {
  assert.match(layoutCss, /height:\s*100dvh/);
  assert.match(layoutCss, /overscroll-behavior:\s*contain/);
  assert.match(layoutCss, /@media\(max-width:710px\)/);
});

test('펜듈럼과 몬스터 효과 ①을 다른 효과로 구분한다', () => {
  const input = '레벨 4 / 어둠 / 악마족\n【펜듈럼 효과】\n①: P 효과.\n②: 다른 P 효과.\n【몬스터 효과】\n①: 소환 성공 시 효과.';
  const parts = splitCardEffects(input);
  assert.equal(parts.prefix, '레벨 4 / 어둠 / 악마족');
  assert.deepEqual(parts.blocks.map((b) => b.section), ['펜듈럼 효과','펜듈럼 효과','몬스터 효과']);
  assert.deepEqual(parts.blocks.map((b) => b.label), ['①','②','①']);
});

test('효과 줄바꿈과 본문을 생략하지 않는다', () => {
  const input = '기본 정보\n①: 효과 조건.\n● 파괴 처리.\n②： 다음 효과.\n여러 줄 설명.';
  const parts = splitCardEffects(input);
  assert.equal(parts.blocks.length, 2);
  assert.match(parts.blocks[0].text, /● 파괴 처리/);
  assert.match(parts.blocks[1].text, /여러 줄 설명/);
});

test('효과 번호 없는 원문은 원형 그대로 표시할 수 있다', () => {
  const input = '이 카드는 마법 카드입니다.\n지속적으로 적용합니다.';
  const parts = splitCardEffects(input);
  assert.equal(parts.blocks.length, 0);
  assert.equal(parts.fallback, input);
});

test('UI 변경 시 파일은 여전히 브라우저 내부에서만 처리한다', () => {
  assert.doesNotMatch(html, /<form\b/i);
  assert.match(main, /JSZip\.loadAsync/);
  assert.match(audit, /readImportFiles/);
});
