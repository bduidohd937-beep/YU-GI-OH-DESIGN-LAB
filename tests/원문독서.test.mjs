import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { splitCardEffects } from '../src/effects.js';

const html = readFileSync(new URL('../index.html',import.meta.url),'utf8');
const reader = readFileSync(new URL('../src/reader.js',import.meta.url),'utf8');
const css = readFileSync(new URL('../src/reader.css',import.meta.url),'utf8');
const layoutCss = readFileSync(new URL('../src/layout.css',import.meta.url),'utf8');
const main = readFileSync(new URL('../src/main.js',import.meta.url),'utf8');

test('원문 집중 읽기와 닫기·이전·다음·글씨 크기 버튼이 실제 연결됨', () => {
  for (const id of ['reader-open','reader-overlay','reader-prev','reader-next','reader-close',
    'reader-content','reader-list','reader-search','reader-font-down','reader-font-up','reader-copy']) {
    assert.match(html,new RegExp('id="' + id + '"'));
    if (id !== 'reader-overlay' && id !== 'reader-content') {
      assert.match(reader,new RegExp("'"+id+"'"));
    }
  }
  assert.match(html,/src\/reader\.css/);
  assert.match(main,/createReader\(/);
  assert.match(main,/reader\.sync\(\)/);
});

test('읽기 모드가 원문 글씨를 18px 기본값으로 사용하고 화면 전체를 점유', () => {
  assert.match(reader,/let fontSize = 18/);
  assert.match(css,/\.reader-overlay\s*\{[^}]*position:\s*fixed;\s*inset:\s*0/);
  assert.match(css,/\.reader-prose\s*\{[^}]*font-size:\s*var\(--reading-font-size,18px\)/);
  assert.match(css,/\.reader-content\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(css,/\.reader-body\s*\{[^}]*grid-template-columns:/);
});

test('원문을 불러오면 상단 업로드 스트립은 숨기고 카드 상세 공간을 확장',()=>{
  assert.match(main,/classList\.toggle\('has-library-data'/);
  assert.match(css,/\.has-library-data \.file-strip\s*\{\s*display:\s*none/);
  assert.match(css,/\.has-library-data \.quick-summary/);
});

test('카드 효과 ① ② ③과 원문 머리말은 독서 모드에서 보존', ()=>{
  const example = '레벨 4 / 어둠 / 악마족\n【펜듈럼 효과】\n①: 첫 효과.\n②: 두번째 효과.\n【몬스터 효과】\n①: 특수 소환했다면 발동.';
  const parts = splitCardEffects(example);
  assert.match(parts.prefix,/레벨 4/);
  assert.deepEqual(parts.blocks.map(x=>x.section+' '+x.label),['펜듈럼 효과 ①','펜듈럼 효과 ②','몬스터 효과 ①']);
  assert.match(reader,/effect\.text/);
  assert.match(reader,/card\.description/);
});

test('키보드 Escape·좌우 이동과 카드 목록 검색을 지원',()=>{
  assert.match(reader,/event\.key === 'Escape'/);
  assert.match(reader,/event\.key === 'ArrowLeft'/);
  assert.match(reader,/event\.key === 'ArrowRight'/);
  assert.match(reader,/reader-card/);
  assert.match(reader,/toLocaleLowerCase/);
});

test('기존 자료실·검수실은 분리 유지',()=>{
  for(const id of ['view-library','view-audit','card-list','card-detail','audit-results','audit-detail']) {
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  assert.match(layoutCss,/\[hidden\]\s*\{\s*display:\s*none\s*!important/);
});
