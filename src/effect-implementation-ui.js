// V0.7 — 안전한 DOM 출력. 원문/코드는 모두 textContent로 처리합니다.
const node = (tag, className = '', text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};

export function createImplementationPanel(data, {expanded = false} = {}) {
  const section = node('details', 'implementation-panel');
  if (!data) return section;
  section.open = expanded || data.state === 'count_review' || data.state === 'no_direct_registration';

  const summary = node('summary', '', '효과 구현 구조 대조');
  summary.append(node('span', 'implementation-brief',
    '원문 ' + data.source.length + '개 / CDB ' + data.cdb.length +
    '개 / Lua 직접 등록 ' + data.registrationCount + '건'));
  section.append(summary);

  const body = node('div', 'implementation-body');
  body.append(node('p', 'implementation-status', data.message));
  if (!data.scriptAvailable) {
    body.append(node('p', 'implementation-muted',
      'Lua를 추가하면 직접 RegisterEffect 호출과 코드 줄번호를 확인할 수 있습니다.'));
  }

  if (data.source.length || data.cdb.length) {
    const textBox = node('section', 'implementation-text');
    textBox.append(node('h4', '', '설계 효과 목록'));
    const primary = data.source.length ? data.source : data.cdb;
    for (const effect of primary) {
      const item = node('div', 'implementation-effect');
      item.append(node('h5', '', (data.source.length ? '원문' : 'CDB') + ' / ' +
        effect.section + ' ' + effect.label));
      item.append(node('div', 'implementation-effect-text', effect.text));
      item.append(node('p', 'implementation-unmapped', '이 효과에 대응하는 특정 Lua 등록 함수를 자동으로 확정할 수 없습니다.'));
      textBox.append(item);
    }
    body.append(textBox);
  }

  if (data.scriptAvailable) {
    const lua = node('section', 'implementation-lua');
    lua.append(node('h4', '', 'Lua 등록 근거 · ' + data.registrations.length + '건'));
    for (const reg of data.registrations) {
      const item = node('div', 'implementation-registration');
      item.append(node('div', 'implementation-location', reg.file + ':' + reg.line + ' · 변수 ' + reg.variable));
      item.append(node('code', 'implementation-code', reg.snippet || '(코드 표시 불가)'));
      if (reg.methods.length) item.append(node('p', 'implementation-methods',
        '찾은 속성/처리 설정: ' + reg.methods.join(', ')));
      lua.append(item);
    }
    if (!data.registrations.length) lua.append(node('p','implementation-muted',
      '직접 RegisterEffect 호출을 발견하지 못했습니다. 공용 헬퍼나 다른 등록 방식을 확인하세요.'));
    if (data.helpers.length) {
      lua.append(node('h4', 'implementation-helper-heading', '소환·효과 보조 호출 · ' + data.helpers.length + '건'));
      for (const helper of data.helpers) {
        const item = node('div', 'implementation-registration');
        item.append(node('div', 'implementation-location', helper.file + ':' + helper.line));
        item.append(node('code', 'implementation-code', helper.snippet));
        lua.append(item);
      }
    }
    body.append(lua);
  }
  if (data.source.length && data.cdb.length) {
    const descriptions = node('details', 'implementation-cdb');
    descriptions.append(node('summary', '', 'CDB 효과 문구 펼쳐보기 (' + data.cdb.length + '개)'));
    for (const effect of data.cdb) {
      const item = node('div', 'implementation-effect');
      item.append(node('h5', '', 'CDB / ' + effect.section + ' ' + effect.label));
      item.append(node('div','implementation-effect-text',effect.text));
      descriptions.append(item);
    }
    body.append(descriptions);
  }
  body.append(node('p','implementation-disclaimer',data.notes));
  section.append(body);
  return section;
}
