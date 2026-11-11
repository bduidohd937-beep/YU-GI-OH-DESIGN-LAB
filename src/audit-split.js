// V0.5.3: 검수 목록/본문 너비 조절. 기존 카드 데이터와 선택 상태는 변경하지 않습니다.
export const AUDIT_SPLIT_KEY = 'design-lab:audit-split:v1';
export const AUDIT_SPLIT_DEFAULT = 25;
export const AUDIT_SPLIT_MIN = 15;
export const AUDIT_SPLIT_MAX = 40;

export function clampAuditWidth(value, gridWidth = 0) {
  const requested = Number.isFinite(Number(value)) ? Number(value) : AUDIT_SPLIT_DEFAULT;
  const min = gridWidth > 0 ? Math.max(AUDIT_SPLIT_MIN, (190 / gridWidth) * 100) : AUDIT_SPLIT_MIN;
  const max = gridWidth > 0 ? Math.min(AUDIT_SPLIT_MAX, ((gridWidth - 500) / gridWidth) * 100) : AUDIT_SPLIT_MAX;
  if (max < min) return Math.min(AUDIT_SPLIT_MAX, Math.max(AUDIT_SPLIT_MIN, requested));
  return Math.round(Math.min(max, Math.max(min, requested)) * 10) / 10;
}

function setupAuditSplit() {
  const grid = document.getElementById('audit-split');
  const handle = document.getElementById('audit-splitter');
  const toggle = document.getElementById('audit-list-toggle');
  const list = document.getElementById('audit-results');
  if (!grid || !handle || !toggle || !list) return;

  const read = () => {
    try {
      const value = JSON.parse(window.localStorage.getItem(AUDIT_SPLIT_KEY) || '{}');
      return {
        width: clampAuditWidth(value.width),
        collapsed: value.collapsed === true
      };
    } catch {
      return { width: AUDIT_SPLIT_DEFAULT, collapsed: false };
    }
  };
  const saved = read();
  let width = saved.width;
  let collapsed = saved.collapsed;

  const save = () => {
    try { window.localStorage.setItem(AUDIT_SPLIT_KEY, JSON.stringify({ width, collapsed })); }
    catch { /* 차단된 브라우저 저장소는 현재 탭에서만 적용 */ }
  };
  const setWidth = (next, persist = false) => {
    width = clampAuditWidth(next, grid.getBoundingClientRect().width);
    grid.style.setProperty('--audit-list-width', width + '%');
    handle.setAttribute('aria-valuenow', String(Math.round(width)));
    handle.setAttribute('aria-valuetext', '카드 목록 ' + Math.round(width) + '퍼센트, 상세 본문 약 ' + Math.round(100 - width) + '퍼센트');
    if (persist) save();
  };
  const setCollapsed = (next, persist = false) => {
    collapsed = !!next;
    grid.classList.toggle('audit-list-collapsed', collapsed);
    list.inert = collapsed;
    handle.inert = collapsed;
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-pressed', String(collapsed));
    toggle.textContent = collapsed ? '◧ 목록 펼치기 · 탐색 모드' : '◧ 목록 접기 · 본문 넓히기';
    if (persist) save();
  };

  let activePointer = null;
  let widthBeforeDrag = width;
  const stopDrag = (event, cancel = false) => {
    if (activePointer === null || (event?.pointerId !== undefined && event.pointerId !== activePointer)) return;
    try { handle.releasePointerCapture(activePointer); } catch { /* 포인터 캡처가 이미 종료됨 */ }
    activePointer = null;
    grid.classList.remove('audit-split-dragging');
    document.body.classList.remove('audit-split-dragging-body');
    if (cancel) setWidth(widthBeforeDrag);
    else save();
  };
  handle.addEventListener('pointerdown', (event) => {
    if (collapsed || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    widthBeforeDrag = width;
    activePointer = event.pointerId;
    handle.setPointerCapture(event.pointerId);
    handle.focus();
    grid.classList.add('audit-split-dragging');
    document.body.classList.add('audit-split-dragging-body');
  });
  handle.addEventListener('pointermove', (event) => {
    if (activePointer !== event.pointerId || collapsed) return;
    const rect = grid.getBoundingClientRect();
    if (rect.width) setWidth(((event.clientX - rect.left) / rect.width) * 100);
  });
  handle.addEventListener('pointerup', (event) => stopDrag(event));
  handle.addEventListener('pointercancel', (event) => stopDrag(event, true));
  handle.addEventListener('lostpointercapture', () => {
    if (activePointer !== null) {
      activePointer = null;
      grid.classList.remove('audit-split-dragging');
      document.body.classList.remove('audit-split-dragging-body');
      save();
    }
  });
  handle.addEventListener('keydown', (event) => {
    const controls = { ArrowLeft: -2, ArrowRight: 2, Home: -100, End: 100 };
    if (!(event.key in controls) || collapsed) return;
    event.preventDefault();
    const next = event.key === 'Home' ? AUDIT_SPLIT_MIN :
      event.key === 'End' ? AUDIT_SPLIT_MAX : width + controls[event.key];
    setWidth(next, true);
  });
  handle.addEventListener('dblclick', () => setWidth(AUDIT_SPLIT_DEFAULT, true));
  toggle.addEventListener('click', () => setCollapsed(!collapsed, true));
  window.addEventListener('resize', () => {
    if (!collapsed && window.innerWidth > 760) setWidth(width);
  });
  setWidth(width);
  setCollapsed(collapsed);
}

if (typeof document !== 'undefined') setupAuditSplit();
