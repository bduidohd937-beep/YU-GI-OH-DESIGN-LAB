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

function shouldParseCardDocument(file) {
  // 안내·해시·검수 보고서는 카드 원문으로 파싱하지 않습니다.
  // 이름은 비표준이어도 [카드 원문] 표식이 있으면 검사 대상으로 간주합니다.
  return String(file.text || '').includes('[카드 원문]') ||
    /(?:원문|card[_-]?source)/i.test(String(file.name || ''));
}

function cardTextSignature(document) {
  return JSON.stringify(document.cards.map((card) => [card.id,card.name,card.description]));
}

function compareDocumentVersion(left, right) {
  const parse = (version) => {
    const m = String(version || '').match(/V(\d+)\.(\d+)(?:\.(\d+))?/i);
    return m ? [Number(m[1]),Number(m[2]),Number(m[3] || 0)] : null;
  };
  const a = parse(left.version), b = parse(right.version);
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]-b[i];
  return 0;
}

export function parseDocuments(files) {
  const documents = [];
  const warnings = [];
  const skippedDocuments = [];
  for (const file of files) {
    if (!/\.txt$/i.test(file.name)) continue;
    if (!shouldParseCardDocument(file)) {
      skippedDocuments.push(file.name);
      continue;
    }
    try {
      documents.push(parseDocument(file.name, file.text));
    } catch (error) {
      warnings.push(file.name + ': ' + error.message);
    }
  }
  const groups = new Map();
  for (const doc of documents) {
    if (!groups.has(doc.theme)) groups.set(doc.theme, []);
    groups.get(doc.theme).push(doc);
  }
  const deduped = [];
  for (const [theme, list] of groups) {
    let selected = list[0];
    for (const doc of list.slice(1)) {
      // 버전이 같으면 마지막 문서를 기준으로 하되, 동등한 카드 원문은 중복 경고하지 않습니다.
      if (compareDocumentVersion(doc, selected) >= 0) selected = doc;
    }
    deduped.push(selected);
    const signatures = new Set(list.map(cardTextSignature));
    if (signatures.size > 1) {
      const hasSameVersionConflict = list.some((doc) =>
        doc !== selected && compareDocumentVersion(doc, selected) === 0 &&
        cardTextSignature(doc) !== cardTextSignature(selected));
      const titles = [...new Set(list.map((doc) => doc.version + ' · ' + doc.fileName))];
      warnings.push((hasSameVersionConflict
        ? '원문 버전 충돌 확인 필요: ' : '테마 원문 버전 안내: ') +
        theme + ' 원문 ' + list.length + '개 중 ' + selected.version + ' (' + selected.fileName +
        ')을 기준본으로 선택했습니다. 입력된 원문: ' + titles.join(' / '));
    }
  }
  return {
    documents: deduped.sort((a, b) => THEMES.indexOf(a.theme) - THEMES.indexOf(b.theme)),
    warnings,
    skippedDocuments
  };
}
