// V0.7.2 — 경고는 좁은 검수 영역이 아닌 별도 큰 읽기 화면에서 확인합니다.
// 입력된 파일을 수정하거나 내용을 네트워크로 전송하지 않습니다.
export function categorizeImportNotices(result) {
  const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
  const skipped = Array.isArray(result?.skippedDocuments) ? result.skippedDocuments : [];
  const notices = warnings.map((detail) => {
    const text = String(detail);
    const informational = text.includes('별도 선택 설치용 TXT/CDB/Lua') ||
      text.startsWith('테마 원문 버전 안내:');
    return {
      severity: informational ? 'info' : 'review',
      title: text.includes('별도 선택 설치용') ? '선택 설치 자료 분리' :
        text.startsWith('테마 원문 버전 안내:') ? '원문 기준 버전 자동 선택' :
        text.startsWith('원문 버전 충돌 확인 필요:') ? '같은 버전 원문 내용 불일치' :
        text.includes('읽기 실패') ? '파일 읽기 확인 필요' :
        text.includes('크기 제한') || text.includes('제한 초과') ? '입력 제한 확인 필요' : '파일·버전 확인',
      detail: text
    };
  });
  return {
    notices,
    skipped,
    reviewCount: notices.filter((item) => item.severity === 'review').length,
    infoCount: notices.filter((item) => item.severity === 'info').length,
    total: notices.length,
    exportText: [
      '# DESIGN LAB — 가져오기·원문 버전 진단',
      '',
      '확인 필요 ' + notices.filter((item) => item.severity === 'review').length +
        '건 / 처리 안내 ' + notices.filter((item) => item.severity === 'info').length +
        '건 / 검사 대상이 아닌 TXT ' + skipped.length + '개',
      '',
      ...notices.flatMap((item,index) => [
        '## ' + (index+1) + '. [' + (item.severity === 'info' ? '안내' : '확인 필요') +
          '] ' + item.title, item.detail, ''
      ]),
      '## 카드 원문이 아닌 TXT (정적 카드 검사에서 제외)', '',
      ...(skipped.length ? skipped.map((name) => '- ' + name) : ['없음']),
      '',
      '> 검사 대상에서 제외해도 원본 파일은 브라우저 보관함에 그대로 남아 있습니다.'
    ].join('\n')
  };
}

const element = (tag, className = '', text) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
};

export function createImportNoticeViewer() {
  const bar = document.getElementById('audit-warnings');
  const dialog = document.getElementById('audit-notices-dialog');
  const body = document.getElementById('audit-notices-body');
  const subtitle = document.getElementById('audit-notices-subtitle');
  const copyButton = document.getElementById('audit-notices-copy');
  const closeButton = document.getElementById('audit-notices-close');
  if (![bar,dialog,body,subtitle,copyButton,closeButton].every(Boolean))
    throw new Error('가져오기 진단 UI 일부를 찾을 수 없습니다.');
  let current = categorizeImportNotices(null);
  let previousFocus = null;
  closeButton.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{
    previousFocus?.focus?.();
    previousFocus = null;
  });
  copyButton.addEventListener('click',async()=>{
    try {
      await navigator.clipboard.writeText(current.exportText);
      copyButton.textContent = '전체 내용 복사됨 ✓';
    } catch {
      copyButton.textContent = '복사 실패 · 내용을 직접 선택하세요';
    }
  });

  function drawDialog() {
    body.replaceChildren();
    subtitle.textContent = '확인 필요 ' + current.reviewCount + '건 · 처리 안내 ' +
      current.infoCount + '건 · 자동 제외 TXT ' + current.skipped.length + '개';
    if (!current.total && !current.skipped.length) {
      body.append(element('p','import-notices-empty','등록 파일에 관한 추가 안내가 없습니다.'));
      return;
    }
    const groups = [
      { title: '확인할 항목', severity: 'review', items: current.notices.filter((item)=>item.severity === 'review') },
      { title: '정상적인 처리 안내', severity: 'info', items: current.notices.filter((item)=>item.severity === 'info') }
    ];
    for (const group of groups) {
      if (!group.items.length) continue;
      const section = element('section','import-notices-section');
      section.append(element('h3','',group.title + ' · ' + group.items.length + '건'));
      group.items.forEach((item, index)=>{
        const card = element('article','import-notices-item import-notices-' + group.severity);
        const title = element('h4','', (index+1)+'. '+item.title);
        card.append(title,element('p','',item.detail));
        section.append(card);
      });
      body.append(section);
    }
    if (current.skipped.length) {
      const section = element('section','import-notices-section');
      section.append(element('h3','','검사 대상이 아닌 TXT · ' + current.skipped.length + '개'),
        element('p','import-notices-help','SHA256 목록, 설치안내, 검수보고서처럼 [카드 원문]이 없는 문서는 카드 검사 대상에서 제외했습니다. 원본 파일은 삭제되지 않습니다.'));
      const list = element('ul','import-notices-file-list');
      for (const filename of current.skipped) list.append(element('li','',filename));
      section.append(list);
      body.append(section);
    }
  }

  function open() {
    drawDialog();
    previousFocus = document.activeElement;
    copyButton.textContent = '전체 내용 복사';
    dialog.showModal();
    closeButton.focus();
  }
  function render(result) {
    current = categorizeImportNotices(result);
    bar.replaceChildren();
    if (!current.total && !current.skipped.length) return;
    const button = element('button','import-notices-launch');
    button.type = 'button';
    button.append(
      element('span','import-notices-count',
        current.reviewCount ? '확인 필요 ' + current.reviewCount + '건' : '가져오기 안내'),
      element('span','import-notices-mini',
        '처리 안내 ' + current.infoCount + '건 · 제외된 문서 ' + current.skipped.length + '개'),
      element('strong','import-notices-open-label','넓게 보기 ↗')
    );
    button.setAttribute('aria-haspopup','dialog');
    button.setAttribute('aria-controls','audit-notices-dialog');
    button.addEventListener('click',open);
    bar.append(button);
    if (dialog.open) drawDialog();
  }
  return {render,open};
}
