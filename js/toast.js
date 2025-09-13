
// js/toast.js
export function ensureToastContainer() {
  let tc = document.querySelector('.toast-container');
  if (!tc) {
    tc = document.createElement('div');
    tc.className = 'toast-container';
    document.body.appendChild(tc);
  }
  return tc;
}

export function showToast(message, type = 'info', timeout = 4000) {
  const container = ensureToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-row">
      <div class="toast-msg">${message}</div>
      <button class="toast-close" ari&times;label="Close">×</button>
    </div>
  `;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));

  const close = () => {
    toast.classList.remove('show');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  };

  toast.querySelector('.toast-close').addEventListener('click', close);
  if (timeout > 0) setTimeout(close, timeout);
}

// Confirm-style toast with Yes/No actions. Returns a Promise<boolean>.
export function showConfirmToast(message, opts = {}) {
  const { confirmText = 'Yes', cancelText = 'No', type = 'warn', timeout = 0, anchor = null } = opts || {};
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.setAttribute('role', 'alertdialog');
  toast.innerHTML = `
    <div class="toast-row">
      <div class="toast-msg">${message}</div>
      <div class="toast-actions">
        <button class="toast-btn toast-cancel" type="button">${cancelText}</button>
        <button class="toast-btn toast-confirm" type="button">${confirmText}</button>
        <button class="toast-close" aria-label="Close">&times;</button>
      </div>
    </div>
  `;
  if (anchor && anchor.getBoundingClientRect) {
    toast.classList.add('toast-popover');
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
      try {
        const rect = anchor.getBoundingClientRect();
        const tw = toast.offsetWidth || 220;
        const th = toast.offsetHeight || 64;
        let left = Math.max(8, Math.min(window.innerWidth - tw - 8, rect.left + rect.width/2 - tw/2));
        let top  = rect.top - th - 10;
        if (top < 8) top = rect.bottom + 10;
        toast.style.position = 'fixed';
        toast.style.left = `${left}px`;
        toast.style.top  = `${top}px`;
        toast.classList.add('show');
      } catch { toast.classList.add('show'); }
    });
  } else {
    const container = ensureToastContainer();
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
  }
  const close = () => { toast.classList.remove('show'); toast.addEventListener('transitionend', () => toast.remove(), { once:true }); };
  return new Promise((resolve) => {
    const onConfirm = () => { close(); resolve(true); };
    const onCancel  = () => { close(); resolve(false); };
    toast.querySelector('.toast-confirm').addEventListener('click', onConfirm);
    toast.querySelector('.toast-cancel').addEventListener('click', onCancel);
    toast.querySelector('.toast-close').addEventListener('click', onCancel);
    if (timeout > 0) setTimeout(onCancel, timeout);
  });
}


