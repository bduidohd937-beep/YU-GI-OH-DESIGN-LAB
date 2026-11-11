export const THEMES = ['혈성', '영각시계', '심연묘역', '천망성역', '파계잔영'];

const HEADER_PATTERN = /^(?:\[(\d{2,9})\]\s*(.+)|(\d{2})\.\s+(.+))\s*$/gm;
const STOP_MARKERS = ['[변경 및 검증 메모]', '[토큰 / 기술용]', '[공용 기본 아벨]', '[백업 종료]'];

export function detectTheme(fileName, content = '') {
  const matched = THEMES.find((name) => fileName.includes(name));
  if (matched) return matched;
  const head = content.slice(0, 700);
  return THEMES.find((name) => head.includes('《' + name + '》')) || null;
}

export function parseDocument(fileName, original) {
  const text = original.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const theme = detectTheme(fileName, text);
  if (!theme) throw new Error('테마를 식별할 수 없습니다: ' + fileName);
  const section = text.indexOf('[카드 원문]');
  if (section < 0) throw new Error('카드 원문 구역을 찾을 수 없습니다: ' + fileName);

  const head = text.slice(0, section);
  const version = (head.match(/\bV\d+(?:\.\d+){1,2}\b/) || ['버전 미상'])[0];
  const bodyStart = section + '[카드 원문]'.length;
  const remaining = text.slice(bodyStart);
  const stops = STOP_MARKERS.map((marker) => remaining.indexOf(marker)).filter((n) => n >= 0);
  const body = remaining.slice(0, stops.length ? Math.min(...stops) : remaining.length);
  const markers = [...body.matchAll(new RegExp(HEADER_PATTERN.source, 'gm'))];
  if (!markers.length) throw new Error('카드 제목을 파싱하지 못했습니다: ' + fileName);

  const cards = markers.map((match, i) => {
    const label = match[2] || match[4];
    const number = match[1] || match[3];
    const idFromLabel = label.match(/\|\s*ID\s*(\d{9})\s*$/);
    const id = idFromLabel ? idFromLabel[1] : (number.length === 9 ? number : null);
    const name = label.replace(/\|\s*ID\s*\d{9}\s*$/, '').replace(/^《/, '').replace(/》$/, '').trim();
    const end = i + 1 < markers.length ? markers[i + 1].index : body.length;
    const description = body.slice(match.index + match[0].length, end)
      .replace(/^\s*\n/, '').replace(/^\s*={6,}\s*$/gm, '').trim();
    return {
      key: theme + ':' + (id || number),
      theme, version, fileName, index: number, id, name,
      description,
      raw: name + '\n' + description
    };
  });
  const notes = text.includes('[변경 및 검증 메모]')
    ? text.slice(text.indexOf('[변경 및 검증 메모]') + '[변경 및 검증 메모]'.length)
      .split('[백업 종료]')[0].replace(/^={5,}/gm, '').trim()
    : '';
  return { theme, version, fileName, cards, notes };
}

export function parseDocuments(files) {
  const documents = [];
  const warnings = [];
  for (const file of files) {
    if (!/\.txt$/i.test(file.name)) continue;
    try {
      documents.push(parseDocument(file.name, file.text));
    } catch (error) {
      warnings.push(file.name + ': ' + error.message);
    }
  }
  const deduped = new Map();
  for (const doc of documents) deduped.set(doc.theme, doc);
  if (deduped.size !== documents.length) warnings.push('중복 테마 원문이 있어 마지막 파일을 사용했습니다.');
  return {
    documents: [...deduped.values()].sort((a, b) => THEMES.indexOf(a.theme) - THEMES.indexOf(b.theme)),
    warnings
  };
}
