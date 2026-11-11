// V0.3 레이아웃 컨트롤러: 화면만 전환하고 원문/CDB/Lua 메모리 상태는 유지합니다.
export const VIEW_NAMES = Object.freeze({library: '카드 자료실', audit: '교차 검수', deck: '덱 연구소'});

export function normalizeView(value) {
  return Object.prototype.hasOwnProperty.call(VIEW_NAMES, value) ? value : 'library';
}

function initWorkspace() {
  const panels = {
    library: document.getElementById('view-library'),
    audit: document.getElementById('view-audit'),
    deck: document.getElementById('view-deck')
  };
  const controls = [...document.querySelectorAll('[data-workspace-target]')];
  const activeLabel = document.getElementById('current-view-name');
  const tabs = controls.filter((element) => element.getAttribute('role') === 'tab');
  if (Object.values(panels).some((panel) => !panel) || !activeLabel) return;

  function showView(value, { updateHash = true, focusTab = false } = {}) {
    const next = normalizeView(value);
    for (const [name, panel] of Object.entries(panels)) {
      panel.hidden = name !== next;
    }
    for (const control of controls) {
      const active = control.dataset.workspaceTarget === next;
      control.classList.toggle('active', active);
      if (control.getAttribute('role') === 'tab') {
        control.setAttribute('aria-selected', String(active));
        control.tabIndex = active ? 0 : -1;
        if (active && focusTab) control.focus();
      } else if (control.closest('.side-nav')) {
        if (active) control.setAttribute('aria-current', 'page');
        else control.removeAttribute('aria-current');
      }
    }
    activeLabel.textContent = VIEW_NAMES[next];
    document.title = 'YU-GI-OH DESIGN LAB · ' + VIEW_NAMES[next];
    if (updateHash && window.location.hash !== '#' + next) {
      window.history.replaceState(null, '', '#' + next);
    }
  }

  for (const control of controls) {
    control.addEventListener('click', () => showView(control.dataset.workspaceTarget));
  }

  for (const tab of tabs) {
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = tabs.indexOf(tab);
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
        (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
      showView(tabs[nextIndex].dataset.workspaceTarget, { focusTab: true });
    });
  }

  window.addEventListener('hashchange', () => showView(window.location.hash.slice(1), { updateHash: false }));
  showView(window.location.hash.slice(1), { updateHash: false });
}

if (typeof document !== 'undefined') initWorkspace();
