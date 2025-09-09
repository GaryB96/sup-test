
// barcode.js — merged full version with iPhone ZXing fallback, HC/OFF lookups, optional OCR, and dev helper
(() => {
  // ---------- utils ----------
  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else { fn(); }
  }

  function setStatus(msg) {
    const el = document.getElementById('bm_status');
    if (el) el.textContent = msg || '';
  }

  function setSearchLinks({ code, name, brand }) {
    const off   = document.getElementById('bm_link_off');
    const hc    = document.getElementById('bm_link_hc');
    const ggl   = document.getElementById('bm_link_ggl');

    const qName = (name && name.trim()) ? name.trim() : '';
    const qBase = qName || code || '';

    if (off) off.href = code ? `https://world.openfoodfacts.org/product/${encodeURIComponent(code)}`
                             : 'https://world.openfoodfacts.org/';

    const hcQuery = `site:health-products.canada.ca/lnhpd-bdpsnh ${qBase}`;
    if (hc) hc.href = `https://www.google.com/search?q=${encodeURIComponent(hcQuery)}`;

    if (ggl) {
      let g = qName;
      if (brand) g = `${brand} ${g}`.trim();
      if (!g) g = code || '';
      ggl.href = `https://www.google.com/search?q=${encodeURIComponent(g)}`;
    }
  }

  function populateModalFields({ code, name = '', brand = '', dose = '', serves = '' } = {}) {
    const codeEl = document.getElementById('bm_codeValue');
    if (codeEl) codeEl.textContent = code || '—';
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    set('bm_name',    name);
    set('bm_brand',   brand);
    set('bm_serving', dose);
    set('bm_servings',serves);
    setSearchLinks({ code, name, brand });
  }

  // ---------- ensure modal present & wired ----------
  function ensureModal() {
    const overlay = document.getElementById('barcodeOverlay');
    const modal   = document.getElementById('barcodeModal');
    if (!overlay || !modal) {
      console.warn('barcode modal not found in DOM.');
      return;
    }
    if (!modal.dataset.wired) {
      const hide = () => {
        overlay.style.display = 'none';
        modal.style.display   = 'none';
        document.body.style.overflow = '';
      };
      overlay.addEventListener('click', hide);
      modal.querySelector('#bm_closeBtn')?.addEventListener('click', hide);
      modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });

      modal.querySelector('#bm_copyBtn')?.addEventListener('click', async () => {
        const codeText = document.getElementById('bm_codeValue')?.textContent || '';
        try { await navigator.clipboard.writeText(codeText); } catch {}
      });

      modal.querySelector('#bm_saveBtn')?.addEventListener('click', () => {
        const detail = {
          code: document.getElementById('bm_codeValue')?.textContent || '',
          name: (document.getElementById('bm_name')?.value || '').trim(),
          brand: (document.getElementById('bm_brand')?.value || '').trim(),
          serving: (document.getElementById('bm_serving')?.value || '').trim(),
          servingsPerContainer: (document.getElementById('bm_servings')?.value || '').trim(),
        };
        document.dispatchEvent(new CustomEvent('barcode:save', { detail }));
        overlay.click();
      });

      modal.dataset.wired = '1';
    }
  }

  // Global dev helper to open the modal manually
  window.openBarcodeModal = (code = '012345678905', seed = {}) => {
    ensureModal();
    const overlay = document.getElementById('barcodeOverlay');
    const modal   = document.getElementById('barcodeModal');
    if (!overlay || !modal) return;
    overlay.style.display = 'block';
    modal.style.display   = 'flex';
    document.body.style.overflow = 'hidden';
    populateModalFields({
      code,
      name:  seed.name  || '',
      brand: seed.brand || '',
      dose:  seed.dose  || '',
      serves:seed.serves|| ''
    });
    setStatus('');
    document.getElementById('bm_name')?.focus();
  };

  // ---------- External lookups ----------
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

          const getFirst = (obj, keys) => {
            for (const k of keys) {
              if (obj && obj[k] != null && String(obj[k]).trim() !== '') return String(obj[k]).trim();
            }
            return '';
          };
          const mapped = {
            name:   getFirst(first, ['product_name_en','product_name','licence_name_en','licence_name','name']),
            brand:  getFirst(first, ['brand_name_en','brand_name','brandname','brand']),
            dose:   getFirst(first, ['recommended_dose','dose','posology','serving_size']),
            serves: getFirst(first, ['servings_per_container','servings','net_content','unit_count']),
          };
          if (mapped.name || mapped.brand || mapped.dose || mapped.serves) return mapped;
        } catch {}
      }
      return null;
    } finally { clearTimeout(to); }
  }

  async function fetchProductInfoFromOFF(code, { timeoutMs = 6000 } = {}) {
    const candidates = [code];
    if (/^\d{12}$/.test(code)) candidates.push('0' + code); // UPC-A -> EAN-13
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), timeoutMs);
    try {
      for (const c of candidates) {
        try {
          const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(c)}.json`, {
            signal: ac.signal, headers: { 'Accept': 'application/json' }
          });
          if (!res.ok) continue;
          const data = await res.json();
          const p = data && data.product;
          if (!p) continue;
          const name   = (p.product_name || '').trim();
          const brand  = (p.brands || '').split(',')[0]?.trim() || '';
          const dose   = (p.serving_size || (p.nutriments && p.nutriments.serving_size) || '').trim();
          const serves = (p.number_of_servings != null ? String(p.number_of_servings)
                          : (p.servings != null ? String(p.servings) : '')).trim();
          if (name || brand || dose || serves) return { name, brand, dose, serves };
        } catch {}
      }
      return null;
    } catch (e) {
      console.warn('OFF lookup failed or blocked:', e);
      return null;
    } finally { clearTimeout(to); }
  }

  // ---------- Optional OCR (free, on-device) ----------
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
      c.getContext('2d', { willReadFrequently: true }).drawImage(bmp, 0, 0);
      return c;
    })();
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const factor = 1.15;
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = Math.min(255, img.data[i] * factor);
      img.data[i+1] = Math.min(255, img.data[i+1] * factor);
      img.data[i+2] = Math.min(255, img.data[i+2] * factor);
    }
    ctx.putImageData(img, 0, 0);
    const { data } = await window.Tesseract.recognize(canvas, lang);
    const text = (data.text || '').replace(/\s+/g, ' ').trim();
    return parseLabelText(text);
  }

  // ---------- Image helpers ----------
  async function makeBitmapFromFile(file, maxW = 1600) {
    try { return await createImageBitmap(file, { resizeWidth: maxW, resizeQuality: 'high' }); } catch {}
    try { return await createImageBitmap(file); } catch {}
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
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, w, h);
      if ('createImageBitmap' in window) { try { return await createImageBitmap(canvas); } catch {} }
      return canvas;
    } finally { URL.revokeObjectURL(url); }
  }

  // ---------- ZXing robust fallback (iPhone) ----------
  async function decodeWithZXingRobust(file) {
    if (!(window.ZXing && ZXing.BrowserMultiFormatReader)) {
      console.warn('ZXing not available');
      return '';
    }
    // Load to <img>
    const url = URL.createObjectURL(file);
    let img;
    try {
      img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = url;
      });
    } catch (e) {
      console.warn('Image load failed:', e);
      URL.revokeObjectURL(url);
      return '';
    }
    URL.revokeObjectURL(url);

    const maxW = 2048;
    const makeCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

    const drawVariant = (angleDeg = 0, crop = 'full') => {
      const scale = img.width > maxW ? maxW / img.width : 1;
      const baseW = Math.max(1, Math.round(img.width * scale));
      const baseH = Math.max(1, Math.round(img.height * scale));

      let sx = 0, sy = 0, sw = img.width, sh = img.height;
      if (crop === 'center') {
        const cw = Math.round(img.width * 0.8);
        const ch = Math.round(img.height * 0.8);
        sx = Math.round((img.width - cw) / 2);
        sy = Math.round((img.height - ch) / 2);
        sw = cw; sh = ch;
      }

      const tw = Math.max(1, Math.round(sw * scale));
      const th = Math.max(1, Math.round(sh * scale));

      const rad = angleDeg * Math.PI / 180;
      const rot90 = angleDeg % 180 !== 0;
      const outW = rot90 ? th : tw;
      const outH = rot90 ? tw : th;
      const canvas = makeCanvas(outW, outH);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.save();
      ctx.translate(outW / 2, outH / 2);
      ctx.rotate(rad);
      ctx.drawImage(img, sx, sy, sw, sh, -tw / 2, -th / 2, tw, th);
      ctx.restore();
      return canvas.toDataURL('image/jpeg', 0.92);
    };

    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
      ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.UPC_A,
      ZXing.BarcodeFormat.EAN_8,  ZXing.BarcodeFormat.UPC_E,
      ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.CODE_39
    ]);
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    const reader = new ZXing.BrowserMultiFormatReader(hints);

    const variants = [
      { a: 0,   c: 'full'   },
      { a: 0,   c: 'center' },
      { a: 90,  c: 'full'   },
      { a: 270, c: 'full'   },
      { a: 180, c: 'full'   },
    ];

    for (const v of variants) {
      try {
        const dataUrl = drawVariant(v.a, v.c);
        const res = await reader.decodeFromImageUrl(dataUrl);
        const text = res && (res.text || res.getText?.());
        if (text && String(text).trim()) {
          reader.reset();
          return String(text).trim();
        }
      } catch (e) {
        // continue
      }
    }
    reader.reset();
    return '';
  }

  // ---------- Autofill flow ----------
  function getCurrentFieldValues() {
    return {
      name:   document.getElementById('bm_name')?.value?.trim() || '',
      brand:  document.getElementById('bm_brand')?.value?.trim() || '',
      dose:   document.getElementById('bm_serving')?.value?.trim() || '',
      serves: document.getElementById('bm_servings')?.value?.trim() || '',
    };
  }
  function anyFilled(curr) { return !!(curr.name || curr.brand || curr.dose || curr.serves); }

  async function openModalWithAutoFill(code, fileForOCR = null) {
    ensureModal();
    const overlay = document.getElementById('barcodeOverlay');
    const modal   = document.getElementById('barcodeModal');
    if (!overlay || !modal) return;
    overlay.style.display = 'block';
    modal.style.display   = 'flex';
    document.body.style.overflow = 'hidden';

    setStatus('Looking up product info…');
    populateModalFields({ code });

    // Try OFF first (barcode-based)
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
    }

    // Try Health Canada with whatever we have now
    const curr1 = getCurrentFieldValues();
    if (curr1.name || curr1.brand || code) {
      const hc = await fetchProductInfoFromHC({ name: curr1.name, brand: curr1.brand, code });
      if (hc) {
        const now = getCurrentFieldValues();
        populateModalFields({
          code,
          name:   now.name   || hc.name   || '',
          brand:  now.brand  || hc.brand  || '',
          dose:   now.dose   || hc.dose   || '',
          serves: now.serves || hc.serves || ''
        });
      }
    }

    // Optional OCR if still empty and Tesseract present
    const curr2 = getCurrentFieldValues();
    if (!anyFilled(curr2) && fileForOCR && window.Tesseract && window.Tesseract.recognize) {
      try {
        setStatus('Reading label text…');
        const ocr = await ocrFrontLabel(fileForOCR);
        if (ocr) {
          const merged = {
            code,
            name:   curr2.name   || ocr.name  || '',
            brand:  curr2.brand  || ocr.brand || '',
            dose:   curr2.dose   || ocr.dose  || '',
            serves: curr2.serves || ''
          };
          populateModalFields(merged);
          if (ocr.npn || ocr.din || ocr.name || ocr.brand) {
            const hc2 = await fetchProductInfoFromHC({
              name:  ocr.name || '',
              brand: ocr.brand || '',
              code:  ocr.npn || ocr.din || ''
            });
            if (hc2) {
              const nowDose   = document.getElementById('bm_serving')?.value?.trim();
              const nowServes = document.getElementById('bm_servings')?.value?.trim();
              if (!nowDose   && hc2.dose)   document.getElementById('bm_serving').value  = hc2.dose;
              if (!nowServes && hc2.serves) document.getElementById('bm_servings').value = hc2.serves;
            }
          }
        }
      } catch (e) {
        console.warn('OCR failed:', e);
      }
    }

    setStatus('');
    modal.querySelector('#bm_name')?.focus();
  }

  // ---------- Scanner (photo → decode) ----------
  onReady(() => {
    const btn = document.getElementById('barcodeBtn');
    if (!btn) return;

    const cameraInput = document.createElement('input');
    cameraInput.type = 'file';
    cameraInput.accept = 'image/jpeg,image/png'; // prefer JPEG/PNG (iOS HEIC can break canvas/ZXing)
    cameraInput.capture = 'environment';
    cameraInput.style.display = 'none';
    document.body.appendChild(cameraInput);

    btn.addEventListener('click', () => cameraInput.click());

    cameraInput.addEventListener('change', async () => {
      const file = cameraInput.files && cameraInput.files[0];
      if (!file) return;

      // HEIC/HEIF guard (common on iPhone)
      const t = (file.type || '').toLowerCase();
      if (t.includes('heic') || t.includes('heif')) {
        alert('This photo is HEIC. Please retake as JPEG (Settings ▸ Camera ▸ Formats ▸ Most Compatible) or try again.');
        cameraInput.value = '';
        return;
      }

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
              if (res && res.length) code = String(res[0].rawValue || '').trim();
            }
          } catch (_) { /* fall back to ZXing */ }
        }

        // iPhone/Safari fallback (or if BD found nothing)
        if (!code) {
          setStatus('Scanning photo…');
          code = await decodeWithZXingRobust(file);
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
        setStatus('');
        cameraInput.value = ''; // allow re-selecting the same photo
      }
    });
  });
})();
