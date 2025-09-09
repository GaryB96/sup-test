
// Scan with BarcodeDetector (where supported), open a modal, try Open Food Facts autofill,
// Health Canada LNHPD lookups, and (fallback) do on-device OCR of the front label via Tesseract.js.
(() => {
  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else { fn(); }
  }

  // --- Modal UI (injected once) ---
function ensureModal() {
  const overlay = document.getElementById('barcodeOverlay');
  const modal   = document.getElementById('barcodeModal');
  if (!overlay || !modal) { 
    console.warn('barcode modal not found in DOM.');
    return; 
  }

  // Wire once
  if (!modal.dataset.wired) {
    const hide = () => {
      overlay.style.display = 'none';
      modal.style.display   = 'none';
      document.body.style.overflow = '';
    };

    // Close handlers
    overlay.addEventListener('click', hide);
    modal.querySelector('#bm_closeBtn')?.addEventListener('click', hide);
    modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });

    // Copy handler
    modal.querySelector('#bm_copyBtn')?.addEventListener('click', async () => {
      const codeText = modal.querySelector('#bm_codeValue')?.textContent || '';
      try { await navigator.clipboard.writeText(codeText); } catch {}
    });

    // Save handler (fires a CustomEvent your app can listen for)
    modal.querySelector('#bm_saveBtn')?.addEventListener('click', () => {
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

    modal.dataset.wired = '1';
  }
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

    if (off) off.href = code ? `https://world.openfoodfacts.org/product/${encodeURIComponent(code)}` : 'https://world.openfoodfacts.org/';
    // Health Canada LNHPD doesn’t have a simple JSON API; use a Google site search
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

  // OFF lookup with UPC-A -> EAN-13 fallback (leading zero)
  async function fetchProductInfoFromOFF(code, { timeoutMs = 6000 } = {}) {
    const candidates = [code];
    if (/^\d{12}$/.test(code)) candidates.push('0' + code);

    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), timeoutMs);
    try {
      for (const c of candidates) {
        const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(c)}.json`;
        try {
          const res = await fetch(url, { signal: ac.signal, headers: { 'Accept': 'application/json' } });
          if (!res.ok) continue;
          const data = await res.json();
          const p = data && data.product ? data.product : null;
          if (!p) continue;
          const name   = (p.product_name || '').trim();
          const brand  = (p.brands || '').split(',')[0]?.trim() || '';
          const dose   = (p.serving_size || (p.nutriments && p.nutriments.serving_size) || '').trim();
          const serves = (p.number_of_servings != null ? String(p.number_of_servings)
                          : (p.servings != null ? String(p.servings) : '')).trim();
          if (name || brand || dose || serves) return { name, brand, dose, serves };
        } catch (e) {
          // try next candidate
        }
      }
      return null;
    } catch (err) {
      console.warn('OFF lookup failed or blocked:', err);
      return null;
    } finally {
      clearTimeout(to);
    }
  }

  // --- OCR helpers (Tesseract.js optional) ---
  function matchBest(text, regs) {
    for (const r of regs) {
      const m = text.match(r);
      if (m && m[1]) return m[1].trim();
    }
    return '';
  }

  function parseLabelText(text) {
    const brand = matchBest(text, [
      /(?:by|from)\s+([A-Z][\w&\- ]{2,30})/i,
      /^([A-Z][\w&\- ]{2,30})\b(?:®|™)?\s+(?:\w+)/i,
    ]);
    const npn   = matchBest(text, [/NPN[:\s-]*([0-9]{8})/i]);
    const din   = matchBest(text, [/DIN[:\s-]*([0-9]{8})/i]);
    const dose  = matchBest(text, [
      /(\d+\s?(?:mg|mcg|µg|ug|g|IU)\b.*?(?:per|\/)\s?(?:tablet|capsule|softgel|softgels|serving|dose))/i,
      /serving size[:\s-]*([A-Za-z0-9 ,./-]+)$/i
    ]);
    const name = matchBest(text, [
      /\b([A-Z][\w'&\- ]{3,40})(?:\s+(?:capsules|tablets|softgels|powder|liquid|drops))?/i
    ]);
    return { name: name || '', brand: brand || '', dose: dose || '', npn: npn || '', din: din || '' };
  }

  async function ocrFrontLabel(file, { lang = 'eng', maxW = 1600 } = {}) {
    if (!(window.Tesseract && window.Tesseract.recognize)) throw new Error('Tesseract.js not available');
    const bmp = await makeBitmapFromFile(file, maxW);
    const canvas = (bmp instanceof HTMLCanvasElement) ? bmp : (() => {
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      return c;
    })();

    async function decodeFileWithZXing(file) {
  if (!(window.ZXing && ZXing.BrowserMultiFormatReader)) {
    throw new Error('ZXing not loaded');
  }

  // Hint ZXing toward 1D retail codes for better reliability
  const hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
    ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.UPC_A,
    ZXing.BarcodeFormat.EAN_8,  ZXing.BarcodeFormat.UPC_E,
    ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.CODE_39
  ]);

  const reader = new ZXing.BrowserMultiFormatReader(hints);
  const url = URL.createObjectURL(file);
  try {
    const result = await reader.decodeFromImageUrl(url);
    return (result && (result.text || result.getText?.())) || '';
  } catch (e) {
    console.warn('ZXing decode failed:', e);
    return '';
  } finally {
    URL.revokeObjectURL(url);
    reader.reset();
  }
}

    // Simple contrast bump
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const factor = 1.15;
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i]   = Math.min(255, img.data[i]   * factor);
      img.data[i+1] = Math.min(255, img.data[i+1] * factor);
      img.data[i+2] = Math.min(255, img.data[i+2] * factor);
    }
    ctx.putImageData(img, 0, 0);

    const { data } = await window.Tesseract.recognize(canvas, lang);
    const text = (data.text || '').replace(/\s+/g, ' ').trim();
    return parseLabelText(text);
  }

  function getCurrentFieldValues() {
    return {
      name:   document.getElementById('bm_name').value.trim(),
      brand:  document.getElementById('bm_brand').value.trim(),
      dose:   document.getElementById('bm_serving').value.trim(),
      serves: document.getElementById('bm_servings').value.trim(),
    };
  }

  function anyFilled(curr) {
    return !!(curr.name || curr.brand || curr.dose || curr.serves);
  }

  function populateModalFields({ code, name = '', brand = '', dose = '', serves = '' } = {}) {
    document.getElementById('bm_codeValue').textContent = code || '—';
    document.getElementById('bm_name').value = name;
    document.getElementById('bm_brand').value = brand;
    document.getElementById('bm_serving').value = dose;
    document.getElementById('bm_servings').value = serves;
    setSearchLinks({ code, name, brand });
  }

  async function openModalWithAutoFill(code, fileForOCR = null) {
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

    // 2) Try Open Food Facts next (barcode-based)
    const off = await fetchProductInfoFromOFF(code);
    if (off) {
      const curr = getCurrentFieldValues();
      populateModalFields({
        code,
        name:   curr.name   || off.name   || '',
        brand:  curr.brand  || off.brand  || '',
        dose:   curr.dose   || off.dose   || '',
        serves: curr.serves || off.serves || ''
      });

      // 3) If HC didn’t give dose/servings, but OFF provided name/brand, re-try HC with better query
      const after = getCurrentFieldValues();
      if ((!after.dose && !after.serves) && (after.name || after.brand)) {
        const hc2 = await fetchProductInfoFromHC({ name: after.name || '', brand: after.brand || '' });
        if (hc2) {
          const nowDose   = document.getElementById('bm_serving').value.trim();
          const nowServes = document.getElementById('bm_servings').value.trim();
          if (!nowDose   && hc2.dose)   document.getElementById('bm_serving').value  = hc2.dose;
          if (!nowServes && hc2.serves) document.getElementById('bm_servings').value = hc2.serves;
        }
      }
    }

    // 4) If still nothing and we have a file + Tesseract, try OCR
    const finalCurr = getCurrentFieldValues();
    if (!anyFilled(finalCurr) && fileForOCR && window.Tesseract && window.Tesseract.recognize) {
      try {
        setStatus('No barcode match—reading label text…');
        const ocr = await ocrFrontLabel(fileForOCR);
        if (ocr) {
          const merged = {
            code,
            name:   finalCurr.name   || ocr.name  || '',
            brand:  finalCurr.brand  || ocr.brand || '',
            dose:   finalCurr.dose   || ocr.dose  || '',
            serves: finalCurr.serves || ''
          };
          populateModalFields(merged);

          // If NPN/DIN or name/brand found, try HC again
          if (ocr.npn || ocr.din || ocr.name || ocr.brand) {
            const hc3 = await fetchProductInfoFromHC({
              name:  ocr.name || '',
              brand: ocr.brand || '',
              code:  ocr.npn || ocr.din || ''
            });
            if (hc3) {
              const nowDose   = document.getElementById('bm_serving').value.trim();
              const nowServes = document.getElementById('bm_servings').value.trim();
              if (!nowDose   && hc3.dose)   document.getElementById('bm_serving').value  = hc3.dose;
              if (!nowServes && hc3.serves) document.getElementById('bm_servings').value = hc3.serves;
            }
          }
        }
      } catch (e) {
        console.warn('OCR failed:', e);
      }
    }

    // Done
    setStatus('');
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
    let code = '';

    // Try native BarcodeDetector first (Android/desktop Chrome)
    if ('BarcodeDetector' in window) {
      try {
        const bmp = await makeBitmapFromFile(file, 1600);
        if (bmp) {
          const det = new window.BarcodeDetector({
            formats: ['ean_13','ean_8','upc_a','upc_e','code_128','code_39','qr_code']
          });
          const res = await det.detect(bmp);
          if (res && res.length) {
            code = String(res[0].rawValue || '').trim();
          }
        }
      } catch (_) {
        // fall back to ZXing
      }
    }

    // iPhone/Safari fallback (or if BD found nothing)
    if (!code) {
      code = await decodeFileWithZXing(file);
    }

    if (code) {
      await openModalWithAutoFill(code, file);
    } else {
      alert('No barcode detected. Try a closer, well-lit shot filling the frame.');
    }
  } catch (err) {
    console.error('Scan error:', err);
    alert('Could not read the image. Please try again.');
  } finally {
    cameraInput.value = ''; // allow re-selecting the same photo
  }
});
});

  // Open the modal without scanning (global for inline onclick)
window.openBarcodeModal = () => {
  ensureModal();
  const overlay = document.getElementById('barcodeOverlay');
  const modal   = document.getElementById('barcodeModal');
  overlay.style.display = 'block';
  modal.style.display   = 'flex';
  document.body.style.overflow = 'hidden';
  setStatus(''); // optional
  modal.querySelector('#bm_name')?.focus();
};


})();
