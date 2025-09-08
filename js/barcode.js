// js/barcode.js
// Scan with BarcodeDetector (where supported), then open a modal and try to populate fields
// from Open Food Facts (free). If no data is found, inputs remain empty.
(() => {
  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else { fn(); }
  }

  // --- Modal UI (injected once) ---
  function ensureModal() {
    if (document.getElementById('barcodeModal')) return;

    if (!document.getElementById('barcode-modal-styles')) {
      const style = document.createElement('style');
      style.id = 'barcode-modal-styles';
      style.textContent = `
#barcodeOverlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: none; z-index: 9999; }
#barcodeModal { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; z-index: 10000; }
#barcodeModal .bm-card {
  background: #fff; width: min(92vw, 420px); border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,.25);
  padding: 18px; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}
#barcodeModal h2 { margin: 0 0 8px; font-size: 18px; }
#barcodeModal .bm-sub { color: #555; font-size: 12px; margin-bottom: 12px; min-height: 16px; }
#barcodeModal .bm-row { display: grid; grid-template-columns: 110px 1fr; gap: 10px; align-items: center; margin: 8px 0; }
#barcodeModal label { font-size: 12px; color: #333; }
#barcodeModal input[type="text"] {
  width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px;
}
#barcodeModal .bm-code {
  padding: 8px 10px; background: #f6f7f8; border-radius: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px;
}
#barcodeModal .bm-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 14px; }
#barcodeModal .bm-btn { border: 0; padding: 10px 14px; border-radius: 8px; cursor: pointer; font-size: 14px; }
#barcodeModal .bm-btn.primary { background: #111827; color: #fff; }
#barcodeModal .bm-btn.secondary { background: #e5e7eb; color: #111827; }
      `;
      document.head.appendChild(style);
    }

    const overlay = document.createElement('div');
    overlay.id = 'barcodeOverlay';
    overlay.setAttribute('aria-hidden', 'true');

    const modal = document.createElement('div');
    modal.id = 'barcodeModal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `
      <div class="bm-card" role="document">
        <h2>Scan result</h2>
        <div class="bm-sub" id="bm_status"></div>

        <div class="bm-row">
          <label>Barcode</label>
          <div class="bm-code">
            <span id="bm_codeValue">—</span>
            <button type="button" class="bm-btn secondary" id="bm_copyBtn">Copy</button>
          </div>
        </div>

        <div class="bm-row">
          <label for="bm_name">Product name</label>
          <input id="bm_name" type="text" value="">
        </div>

        <div class="bm-row">
          <label for="bm_brand">Brand</label>
          <input id="bm_brand" type="text" value="">
        </div>

        <div class="bm-row">
          <label for="bm_serving">Serving size / dose</label>
          <input id="bm_serving" type="text" value="">
        </div>

        <div class="bm-row">
          <label for="bm_servings">Servings per container</label>
          <input id="bm_servings" type="text" value="">
        </div>

        <div class="bm-actions">
          <button type="button" class="bm-btn secondary" id="bm_closeBtn">Close</button>
          <button type="button" class="bm-btn primary" id="bm_saveBtn">Save</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(modal);

    // Close handlers
    const hide = () => {
      overlay.style.display = 'none';
      modal.style.display = 'none';
      document.body.style.overflow = '';
    };
    overlay.addEventListener('click', hide);
    modal.querySelector('#bm_closeBtn').addEventListener('click', hide);
    modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });

    // Copy handler
    modal.querySelector('#bm_copyBtn').addEventListener('click', async () => {
      const codeText = modal.querySelector('#bm_codeValue').textContent || '';
      try { await navigator.clipboard.writeText(codeText); } catch {}
    });

    // Save handler – dispatch a custom event your app can catch
    modal.querySelector('#bm_saveBtn').addEventListener('click', () => {
      const detail = {
        code: modal.querySelector('#bm_codeValue').textContent || '',
        name: (modal.querySelector('#bm_name').value || '').trim(),
        brand: (modal.querySelector('#bm_brand').value || '').trim(),
        serving: (modal.querySelector('#bm_serving').value || '').trim(),
        servingsPerContainer: (modal.querySelector('#bm_servings').value || '').trim(),
      };
      document.dispatchEvent(new CustomEvent('barcode:save', { detail }));
      overlay.click(); // close
    });
  }

  function setStatus(msg) {
    const el = document.getElementById('bm_status');
    if (el) el.textContent = msg || '';
  }

  async function fetchProductInfoFromOFF(code, { timeoutMs = 6000 } = {}) {
    // Open Food Facts v2 product endpoint (free)
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`;
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ac.signal, headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const p = data && data.product ? data.product : null;
      if (!p) return null;

      // Map fields with sensible fallbacks
      const name   = (p.product_name || '').trim();
      const brand  = (p.brands || '').split(',')[0]?.trim() || '';
      const dose   = (p.serving_size || (p.nutriments && p.nutriments.serving_size) || '').trim();
      const serves = (p.number_of_servings != null ? String(p.number_of_servings)
                      : (p.servings != null ? String(p.servings) : '')).trim();

      return { name, brand, dose, serves };
    } catch (err) {
      console.warn('OFF lookup failed or blocked:', err);
      return null;
    } finally {
      clearTimeout(to);
    }
  }

  function populateModalFields({ code, name = '', brand = '', dose = '', serves = '' } = {}) {
    ensureModal();
    document.getElementById('bm_codeValue').textContent = code || '—';
    document.getElementById('bm_name').value = name;
    document.getElementById('bm_brand').value = brand;
    document.getElementById('bm_serving').value = dose;
    document.getElementById('bm_servings').value = serves;
  }

  async function openModalWithAutoFill(code) {
    ensureModal();
    setStatus('Looking up product info…');
    populateModalFields({ code }); // start empty; fill when/if we get data

    // Show modal now (while we look up)
    const overlay = document.getElementById('barcodeOverlay');
    const modal   = document.getElementById('barcodeModal');
    overlay.style.display = 'block';
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // Try Open Food Facts
    const info = await fetchProductInfoFromOFF(code);
    if (info) {
      populateModalFields({
        code,
        name: info.name,
        brand: info.brand,
        dose: info.dose,
        serves: info.serves
      });
      setStatus(''); // clear
    } else {
      setStatus(''); // no data; leave fields blank
    }

    // Focus first field
    modal.querySelector('#bm_name').focus();
  }

  // --- Scanner (photo → decode) ---
  onReady(() => {
    const btn = document.getElementById('barcodeBtn');
    if (!btn) return;

    const cameraInput = document.createElement('input');
    cameraInput.type = 'file';
    cameraInput.accept = 'image/*';
    cameraInput.capture = 'environment';
    cameraInput.style.display = 'none';
    document.body.appendChild(cameraInput);

    btn.addEventListener('click', () => cameraInput.click());

    cameraInput.addEventListener('change', async () => {
      const file = cameraInput.files && cameraInput.files[0];
      if (!file) return;

      try {
        if (!('BarcodeDetector' in window)) {
          alert('Barcode scanning is not supported on this browser. (Works on Chrome/Android; iOS needs fallback.)');
          return;
        }

        // Downscale very large images for speed/reliability
        const maxW = 1600;
        let bmp;
        try {
          bmp = await createImageBitmap(file, { resizeWidth: maxW, resizeQuality: 'high' });
        } catch {
          bmp = await createImageBitmap(file);
        }

        const detector = new window.BarcodeDetector({
          formats: ['ean_13','ean_8','upc_a','upc_e','code_128','code_39','qr_code']
        });

        const results = await detector.detect(bmp);
        if (results && results.length) {
          const preferred = results.find(r =>
            ['ean_13','upc_a','upc_e','ean_8'].includes((r.format || '').toLowerCase())
          ) || results[0];

          const code = (preferred.rawValue || '').trim();
          if (code) {
            await openModalWithAutoFill(code);
          } else {
            alert('A barcode was detected, but no value was read. Please try again with better lighting.');
          }
        } else {
          alert('No barcode detected. Try a clearer, well-lit shot filling the frame.');
        }
      } catch (err) {
        console.error('Barcode scan error:', err);
        alert('Could not read the image. Please try again.');
      } finally {
        cameraInput.value = ''; // allow re-selecting the same file
      }
    });
  });
})();
