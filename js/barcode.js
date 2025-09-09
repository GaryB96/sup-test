// Scan with BarcodeDetector (where supported), open a modal, try Open Food Facts autofill,
// and (Option A) show handy Search links to Health Canada LNHPD + Google if data is missing.
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
#barcodeModal .bm-actions { display: flex; gap: 10px; justify-content: space-between; align-items: center; margin-top: 14px; flex-wrap: wrap; }
#barcodeModal .bm-btn { border: 0; padding: 10px 14px; border-radius: 8px; cursor: pointer; font-size: 14px; }
#barcodeModal .bm-btn.primary { background: #111827; color: #fff; }
#barcodeModal .bm-btn.secondary { background: #e5e7eb; color: #111827; }
#barcodeModal .bm-links { display: flex; gap: 8px; flex-wrap: wrap; }
#barcodeModal .bm-link {
  display: inline-block; text-decoration: none; padding: 8px 10px; border-radius: 8px; background: #f3f4f6; color: #111827; font-size: 13px;
}
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
          <div class="bm-links">
            <a id="bm_link_off"   class="bm-link" target="_blank" rel="noopener">Open Food Facts</a>
            <a id="bm_link_hc"    class="bm-link" target="_blank" rel="noopener">Search Health Canada</a>
            <a id="bm_link_ggl"   class="bm-link" target="_blank" rel="noopener">Google</a>
          </div>
          <div>
            <button type="button" class="bm-btn secondary" id="bm_closeBtn">Close</button>
            <button type="button" class="bm-btn primary"   id="bm_saveBtn">Save</button>
          </div>
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
        code: document.getElementById('bm_codeValue').textContent || '',
        name: (document.getElementById('bm_name').value || '').trim(),
        brand: (document.getElementById('bm_brand').value || '').trim(),
        serving: (document.getElementById('bm_serving').value || '').trim(),
        servingsPerContainer: (document.getElementById('bm_servings').value || '').trim(),
      };
      document.dispatchEvent(new CustomEvent('barcode:save', { detail }));
      overlay.click(); // close
    });
  }

  function setStatus(msg) {
    const el = document.getElementById('bm_status');
    if (el) el.textContent = msg || '';
  }

  // Build helpful search links (no fetch; just URLs in new tabs)
  function setSearchLinks({ code, name, brand }) {
    const off   = document.getElementById('bm_link_off');
    const hc    = document.getElementById('bm_link_hc');
    const ggl   = document.getElementById('bm_link_ggl');

    const qName = (name && name.trim()) ? name.trim() : '';
    const qBase = qName || code || '';
    const encQ  = encodeURIComponent(qBase);

    if (off) off.href = code ? `https://world.openfoodfacts.org/product/${encodeURIComponent(code)}` : 'https://world.openfoodfacts.org/';
    // Health Canada LNHPD doesn’t have a simple JSON API; use a Google site search
    // Restrict to the official LNHPD host path:
    const hcQuery = `site:health-products.canada.ca/lnhpd-bdpsnh ${qBase}`;
    if (hc) hc.href = `https://www.google.com/search?q=${encodeURIComponent(hcQuery)}`;

    // General Google search fallback (prefer name if present)
    if (ggl) {
      let g = qName;
      if (brand) g = `${brand} ${g}`.trim();
      if (!g) g = code || '';
      ggl.href = `https://www.google.com/search?q=${encodeURIComponent(g)}`;
    }
  }

  // --- Health Canada LNHPD fetch (free API) ---
// Query by brand and/or product name; if neither is available yet, try the raw barcode via `search=`.
async function fetchProductInfoFromHC({ name = '', brand = '', code = '' }, { timeoutMs = 8000 } = {}) {
  const base = 'https://health-products.canada.ca/api/natural-licences/';
  const q = (brand || name || code || '').trim();
  if (!q) return null;

  const urls = [
    `${base}?lang=en&type=json&search=${encodeURIComponent(q)}`,
    `${base}?lang=en&type=json&brandname=${encodeURIComponent(q)}`,
    `${base}?lang=en&type=json&productname=${encodeURIComponent(q)}`
  ];

  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), timeoutMs);

  try {
    for (const url of urls) {
      try {
        const res = await fetch(url, { signal: ac.signal, headers: { 'Accept': 'application/json' } });
        if (!res.ok) continue;
        const data = await res.json();
        const first = Array.isArray(data) ? data[0] : (data && data.results ? data.results[0] : null);
        if (!first) continue;

        // Pull likely fields; schema can vary across endpoints
        const getFirst = (obj, keys) => {
          for (const k of keys) {
            if (obj && obj[k] != null && String(obj[k]).trim() !== '') return String(obj[k]).trim();
          }
          return '';
        };

        const mapped = {
          name:   getFirst(first, ['product_name_en', 'product_name', 'licence_name_en', 'licence_name', 'name']),
          brand:  getFirst(first, ['brand_name_en', 'brand_name', 'brandname', 'brand']),
          dose:   getFirst(first, ['recommended_dose', 'dose', 'posology', 'serving_size']),
          serves: getFirst(first, ['servings_per_container', 'servings', 'net_content', 'unit_count'])
        };

        if (mapped.name || mapped.brand || mapped.dose || mapped.serves) return mapped;
      } catch {
        // try next url
      }
    }
    return null;
  } finally {
    clearTimeout(to);
  }
}


async function fetchProductInfoFromOFF(code, { timeoutMs = 6000 } = {}) {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`;
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const p = data && data.product ? data.product : null;
    if (!p) return null;
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
    document.getElementById('bm_codeValue').textContent = code || '—';
    document.getElementById('bm_name').value = name;
    document.getElementById('bm_brand').value = brand;
    document.getElementById('bm_serving').value = dose;
    document.getElementById('bm_servings').value = serves;
    setSearchLinks({ code, name, brand });
  }

  async function openModalWithAutoFill(code) {
  ensureModal();
  setStatus('Looking up product info…');

  const overlay = document.getElementById('barcodeOverlay');
  const modal   = document.getElementById('barcodeModal');
  overlay.style.display = 'block';
  modal.style.display   = 'flex';
  document.body.style.overflow = 'hidden';

  // Start with barcode only
  populateModalFields({ code });

  // 1) Try Health Canada first (may succeed if their search matches code text)
  let best = await fetchProductInfoFromHC({ code });
  if (best) {
    populateModalFields({
      code,
      name:   best.name,
      brand:  best.brand,
      dose:   best.dose,
      serves: best.serves
    });
  }

  // 2) Try Open Food Facts next (often provides name/brand when HC-by-code didn’t)
  const off = await fetchProductInfoFromOFF(code);
  if (off) {
    // Only fill fields that are still empty so we don’t clobber HC results
    const curr = {
      name:   document.getElementById('bm_name').value.trim(),
      brand:  document.getElementById('bm_brand').value.trim(),
      dose:   document.getElementById('bm_serving').value.trim(),
      serves: document.getElementById('bm_servings').value.trim(),
    };
    populateModalFields({
      code,
      name:   curr.name   || off.name   || '',
      brand:  curr.brand  || off.brand  || '',
      dose:   curr.dose   || off.dose   || '',
      serves: curr.serves || off.serves || ''
    });

    // 3) If HC didn’t give dose/servings, but OFF provided name/brand, re-try HC with better query
    if ((!curr.dose && !curr.serves) && (off.name || off.brand)) {
      const hc2 = await fetchProductInfoFromHC({ name: off.name || '', brand: off.brand || '' });
      if (hc2) {
        const nowDose   = document.getElementById('bm_serving').value.trim();
        const nowServes = document.getElementById('bm_servings').value.trim();
        if (!nowDose   && hc2.dose)   document.getElementById('bm_serving').value  = hc2.dose;
        if (!nowServes && hc2.serves) document.getElementById('bm_servings').value = hc2.serves;
      }
    }
  }

  // Done
  setStatus('');
  // Wire HC manual fetch button (in case the user edits name/brand and tries again)
  
  modal.querySelector('#bm_name').focus();
}

// Try multiple ways to get a bitmap-like source the detector can read.
async function makeBitmapFromFile(file, maxW = 1600) {
  // 1) Fast path: ImageBitmap with resize (where supported)
  try {
    return await createImageBitmap(file, { resizeWidth: maxW, resizeQuality: 'high' });
  } catch (e) { /* continue */ }
  // 2) ImageBitmap without resize
  try {
    return await createImageBitmap(file);
  } catch (e) { /* continue */ }

  // 3) Fallback: load via <img>, downscale on <canvas>, then create ImageBitmap from canvas
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });

    const scale = img.width > maxW ? (maxW / img.width) : 1;
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);

    if ('createImageBitmap' in window) {
      try { return await createImageBitmap(canvas); } catch (e) { /* fall through */ }
    }
    // Some implementations accept HTMLCanvasElement directly as an ImageBitmapSource
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

  // --- Scanner (photo → decode) ---
  onReady(() => {
    const btn = document.getElementById('barcodeBtn');
    if (!btn) return;

    const cameraInput = document.createElement('input');
    cameraInput.type = 'file';
    cameraInput.accept = 'image/jpeg,image/png';
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

        let bmp;
try {
  bmp = await makeBitmapFromFile(file, 1600);
} catch (e) {
  console.error('Bitmap build threw:', e);
}
        if (!bmp) {
  alert('Could not read the image (unsupported format). Please try again with a standard photo.');
  return;
}
if (!bmp) {
  alert('Could not read the image (format/reader issue). Please try again with a JPEG/PNG photo.');
  cameraInput.value = '';
  return;
}

// 2) Run the detector


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