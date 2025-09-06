
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
      <button class="toast-close" aria-label="Close">×</button>
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
