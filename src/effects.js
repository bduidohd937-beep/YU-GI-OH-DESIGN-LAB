// 효과 텍스트를 표시용으로만 나눕니다. 카드 원문은 수정하지 않습니다.
const EFFECT_HEAD = /^\s*([①②③④⑤⑥⑦⑧⑨⑩])\s*[:：]/;
const PENDULUM_HEAD = /^\s*【\s*펜듈럼\s*효과\s*】\s*$/;
const MONSTER_HEAD = /^\s*【\s*몬스터\s*효과\s*】\s*$/;

export function splitCardEffects(original = '') {
  const raw = String(original).replace(/\r\n?/g, '\n');
  const prefix = [];
  const blocks = [];
  let section = '';
  let current = null;
  function flush() {
    if (current) {
      current.text = current.lines.join('\n').trim();
      delete current.lines;
      blocks.push(current);
      current = null;
    }
  }
  for (const line of raw.split('\n')) {
    if (PENDULUM_HEAD.test(line)) {
      flush();
      section = '펜듈럼 효과';
      continue;
    }
    if (MONSTER_HEAD.test(line)) {
      flush();
      section = '몬스터 효과';
      continue;
    }
    const matched = line.match(EFFECT_HEAD);
    if (matched) {
      flush();
      current = { key: section + ':' + matched[1] + ':' + blocks.length, label: matched[1],
        section: section || '카드 효과', lines: [line] };
      continue;
    }
    if (current) current.lines.push(line);
    else prefix.push(line);
  }
  flush();
  if (!blocks.length) return { prefix: '', blocks: [], fallback: raw };
  const intro = prefix.join('\n').trim();
  return { prefix: intro, blocks, fallback: null };
}
