// Sidebar collapse/expand logic
(function(){
  const sidebar = document.getElementById('sidebar');
  const tab = document.getElementById('sidebarTab');
  if (!sidebar || !tab) return;

  function setCollapsed(collapsed){
    sidebar.setAttribute('data-collapsed', String(collapsed));
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    const icon = tab.querySelector('.sidebar-tab-icon');
    if (icon) icon.textContent = collapsed ? '❯' : '❮';
    tab.setAttribute('aria-expanded', String(!collapsed));
  }

  // Initialize
  const initial = sidebar.getAttribute('data-collapsed');
  if (initial === null){
    const mq = window.matchMedia('(max-width: 600px)');
    setCollapsed(mq.matches);
  } else {
    setCollapsed(initial === 'true');
  }

  tab.addEventListener('click', (e) => {
    e.preventDefault();
    const collapsed = sidebar.getAttribute('data-collapsed') === 'true';
    setCollapsed(!collapsed);
  });
})();
