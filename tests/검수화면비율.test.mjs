import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  clampAuditWidth, AUDIT_SPLIT_DEFAULT, AUDIT_SPLIT_MIN, AUDIT_SPLIT_MAX,
  AUDIT_SPLIT_KEY
} from '../src/audit-split.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/audit-layout.css', import.meta.url), 'utf8');
const script = readFileSync(new URL('../src/audit-split.js', import.meta.url), 'utf8');
const auditUi = readFileSync(new URL('../src/audit-ui.js', import.meta.url), 'utf8');

test('기본은 목록 25% / 본문 약 75%, 최소 최대 폭 유효', () => {
  assert.equal(AUDIT_SPLIT_DEFAULT, 25);
  assert.equal(AUDIT_SPLIT_MIN, 15);
  assert.equal(AUDIT_SPLIT_MAX, 40);
  assert.equal(clampAuditWidth(25), 25);
  assert.equal(clampAuditWidth(10), 15);
  assert.equal(clampAuditWidth(90), 40);
  assert.equal(clampAuditWidth('not-a-number'), 25);
});

test('폭이 좁은 PC에서도 목록·본문 최소 폭이 가능한 범위로 제한', () => {
  const width = clampAuditWidth(15, 1000);
  assert.equal(width, 19);
  assert.equal(clampAuditWidth(40, 1000), 40);
  assert.ok(clampAuditWidth(15, 900) >= 21);
  assert.ok(clampAuditWidth(40, 900) <= 40);
});

test('검수 화면에서 목록-분할선-상세 본문 순서가 맞다', () => {
  const a = html.indexOf('id="audit-results"');
  const b = html.indexOf('id="audit-splitter"');
  const c = html.indexOf('id="audit-detail"');
  assert.ok(a >= 0 && b > a && c > b);
  assert.match(html, /id="audit-split"[^>]*--audit-list-width:25%/);
  assert.match(css, /grid-template-columns:\s*minmax\(180px,\s*var\(--audit-list-width,\s*25%\)\)\s*8px\s*minmax\(0,\s*1fr\)/);
});

test('분할선은 포인터 드래그·키보드 좌우/홈/끝·두 번 클릭 초기화 지원', () => {
  assert.match(script, /setPointerCapture/);
  assert.match(script, /pointermove/);
  assert.match(script, /pointerup/);
  assert.match(script, /pointercancel/);
  assert.match(script, /ArrowLeft/);
  assert.match(script, /ArrowRight/);
  assert.match(script, /Home/);
  assert.match(script, /End/);
  assert.match(script, /dblclick/);
  assert.match(html, /role="separator"/);
  assert.match(html, /aria-orientation="vertical"/);
  assert.match(html, /aria-valuemin="15"/);
  assert.match(html, /aria-valuemax="40"/);
});

test('목록 접기 시 본문 전체폭, 상태 유지 및 버튼 접근성', () => {
  assert.match(html, /id="audit-list-toggle"[^>]*aria-controls="audit-results"/);
  assert.match(css, /audit-list-collapsed[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(script, /classList\.toggle\('audit-list-collapsed'/);
  assert.match(script, /aria-expanded/);
  assert.match(script, /aria-pressed/);
  assert.match(script, /localStorage\.setItem/);
  assert.equal(AUDIT_SPLIT_KEY, 'design-lab:audit-split:v1');
});

test('상단 통계 높이를 줄이고 상세 본문 높이와 가독성 확대', () => {
  assert.match(css, /#view-audit \.audit-panel\.audit-has-results \.audit-stats\s*\{\s*display:\s*flex/);
  assert.match(css, /#view-audit \.audit-split #audit-detail\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(css, /#view-audit \.audit-split \.audit-source-preview pre\s*\{[^}]*font-size:\s*15px/);
  assert.match(css, /min-height:\s*0/);
});

test('좁은 화면에서는 목록 위·본문 아래, 분할선 숨김', () => {
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
  assert.match(css, /flex-direction:\s*column/);
  assert.match(css, /#audit-splitter\s*\{\s*display:\s*none\s*!important/);
});

test('기존 검사/보고서/집중 읽기와 파일 데이터 구조 보존', () => {
  for (const id of ['audit-results','audit-detail','audit-export','fix-export',
    'audit-reader-open','audit-stat-source','audit-filter','audit-input','audit-coverage-notice']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(auditUi, /buildAudit/);
  assert.match(auditUi, /createAuditReader/);
  assert.match(html, /src\/audit-reader\.js|src\/audit-ui\.js/);
  assert.match(html, /src\/audit-split\.js/);
  assert.match(html, /src\/audit-layout\.css/);
});
