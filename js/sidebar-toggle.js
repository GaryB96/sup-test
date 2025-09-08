// Sidebar collapse/expand logic – lightweight & SPA-friendly (debounced observer)
(function () {
  const STORAGE_KEY = 'sidebar_collapsed_v1';
  let lastSidebar = null;
  let initialized = false;
  let debounceTimer = null;

  function qs(sel, root = document) { return root.querySelector(sel); }

  function getEls() {
    const sidebar = document.getElementById('sidebar');
    // Accept multiple possible tab selectors
    const tab = qs('#sidebarTab') || qs('#sidebar .sidebar-tab') || qs('[data-role="sidebar-tab"]');
    const iconEl = tab ? (tab.querySelector('.sidebar-tab-icon') || tab) : null;
    return { sidebar, tab, iconEl };
  }

  function setCollapsed(sidebar, tab, iconEl, collapsed) {
    if (!sidebar) return;
    sidebar.setAttribute('data-collapsed', String(collapsed));
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    // Only change text if tab uses text chevrons
    if (iconEl && !iconEl.dataset.lockText) {
      iconEl.textContent = collapsed ? '❯' : '❮';
    }
    if (tab) tab.setAttribute('aria-expanded', String(!collapsed));
    try { localStorage.setItem(STORAGE_KEY, String(collapsed)); } catch {}
  }

  function computeInitial(sidebar) {
    // Priority: persisted -> attribute -> media query
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'true' || stored === 'false') return (stored === 'true');
    } catch {}
    if (sidebar && sidebar.hasAttribute('data-collapsed')) {
      return sidebar.getAttribute('data-collapsed') === 'true';
    }
    return window.matchMedia('(max-width: 600px)').matches;
  }

  function initIfPossible() {
    const { sidebar, tab, iconEl } = getEls();
    if (!sidebar) return false;

    // Initialize state only once per sidebar element
    if (sidebar !== lastSidebar) {
      lastSidebar = sidebar;
      const initial = computeInitial(sidebar);
      setCollapsed(sidebar, tab, iconEl, initial);
    }

    if (!initialized) {
      // Event delegation for clicks on the tab
      document.addEventListener('click', onDocClick, true);
      // Re-apply on navigation-like events
      window.addEventListener('pageshow', scheduleCheck, { passive: true });
      document.addEventListener('visibilitychange', scheduleCheck, { passive: true });
      window.addEventListener('popstate', scheduleCheck, { passive: true });
      initialized = true;
    }
    return true;
  }

  function onDocClick(e) {
    const target = e.target;
    const matchSel = '#sidebarTab, #sidebar .sidebar-tab, [data-role="sidebar-tab"]';
    let tabEl = null;
    if (target && target.closest) tabEl = target.closest(matchSel);
    if (!tabEl) return;

    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    // Only stop events for the tab click, not globally
    e.preventDefault();
    e.stopPropagation();

    const collapsed = sidebar.getAttribute('data-collapsed') === 'true';
    const iconEl = tabEl.querySelector('.sidebar-tab-icon') || tabEl;
    setCollapsed(sidebar, tabEl, iconEl, !collapsed);
  }

  function scheduleCheck() {
    if (debounceTimer) return;
    debounceTimer = requestAnimationFrame(() => {
      debounceTimer = null;
      initIfPossible();
    });
  }

  // Initial run (after DOM ready)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initIfPossible(), { once: true });
  } else {
    initIfPossible();
  }

  // Lightweight observer: only cares if #sidebar node identity changes
  const observer = new MutationObserver(() => scheduleCheck());
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
