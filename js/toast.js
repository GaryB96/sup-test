
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
  const { confirmText = 'Yes', cancelText = 'No', type = 'warn', timeout = 0, anchor = null, outsideClose = false, hideActions } = opts || {};
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.setAttribute('role', 'alertdialog');

  const infoMode = (hideActions === true) || (hideActions === undefined && type === 'info' && !!anchor);
  if (infoMode) {
    // Info popover style: no OK/Cancel, just close
    toast.innerHTML = `
      <div class="toast-row">
        <div class="toast-msg">${message}</div>
        <button class="toast-close" aria-label="Close">&times;</button>
      </div>
    `;
  } else {
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
  }
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
    const closeBtn = toast.querySelector('.toast-close');
    if (!infoMode) {
      toast.querySelector('.toast-confirm').addEventListener('click', onConfirm);
      toast.querySelector('.toast-cancel').addEventListener('click', onCancel);
    }
    if (closeBtn) closeBtn.addEventListener('click', onCancel);
    if (timeout > 0) setTimeout(onCancel, timeout);
    // Close on outside click for infoMode or when explicitly requested
    if (infoMode || outsideClose) {
      const onOutside = (e) => {
        if (!toast.contains(e.target) && (!anchor || !anchor.contains(e.target))) {
          document.removeEventListener('mousedown', onOutside, true);
          onCancel();
        }
      };
      document.addEventListener('mousedown', onOutside, true);
    }
  });
}

// Info popover anchored to an element; closes with X, timeout, or outside click.
export function showInfoPopover(message, opts = {}) {
  const { type = 'info', timeout = 0, anchor = null, position = 'auto', offset = 10 } = opts || {};
  const pop = document.createElement('div');
  pop.className = `toast ${type}`;
  pop.classList.add('toast-popover');
  pop.setAttribute('role', 'dialog');
  pop.innerHTML = `
    <div class="toast-row">
      <div class="toast-msg">${message}</div>
      <button class="toast-close" aria-label="Close">&times;</button>
    </div>
  `;
  document.body.appendChild(pop);

  const positionPop = () => {
    try {
      if (!(anchor && anchor.getBoundingClientRect)) return;
      const rect = anchor.getBoundingClientRect();
      const tw = pop.offsetWidth || 240;
      const th = pop.offsetHeight || 64;
      let left, top;
      if (position === 'right') {
        left = rect.right + offset;
        top  = rect.top + (rect.height - th) / 2;
      } else if (position === 'left') {
        left = rect.left - tw - offset;
        top  = rect.top + (rect.height - th) / 2;
      } else {
        // auto: above else below
        left = rect.left + rect.width/2 - tw/2;
        top  = rect.top - th - offset;
        if (top < 8) top = rect.bottom + offset;
      }
      // clamp within viewport
      left = Math.max(8, Math.min(window.innerWidth - tw - 8, left));
      top  = Math.max(8, Math.min(window.innerHeight - th - 8, top));
      pop.style.position = 'fixed';
      pop.style.left = `${left}px`;
      pop.style.top  = `${top}px`;
    } catch {}
  };

  requestAnimationFrame(() => {
    positionPop();
    pop.classList.add('show');
  });

  const close = () => {
    pop.classList.remove('show');
    pop.addEventListener('transitionend', () => pop.remove(), { once: true });
    document.removeEventListener('mousedown', onOutside, true);
    window.removeEventListener('resize', position);
    window.removeEventListener('scroll', position, true);
    try {
      if (anchor) {
        anchor.dispatchEvent(new CustomEvent('infoPopoverClosed', { bubbles: true }));
      }
    } catch {}
  };
  const onOutside = (e) => {
    if (!pop.contains(e.target) && (!anchor || !anchor.contains(e.target))) close();
  };
  pop.querySelector('.toast-close').addEventListener('click', close);
  document.addEventListener('mousedown', onOutside, true);
  window.addEventListener('resize', positionPop);
  window.addEventListener('scroll', positionPop, true);
  if (timeout > 0) setTimeout(close, timeout);
  return { element: pop, close };
}


