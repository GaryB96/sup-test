
// Barcode scanning with Chrome BarcodeDetector (when available) + robust ZXing fallback for iPhone/Safari.
// Also includes HEIC guard and JPEG/PNG preference.
(() => {
  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else { fn(); }
  }

  // --- Minimal modal utils (assumes HTML lives in index.html) ---
  function setStatus(msg) {
    const el = document.getElementById('bm_status');
    if (el) el.textContent = msg || '';
  }
  function populateModalFields({ code, name = '', brand = '', dose = '', serves = '' } = {}) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    const codeEl = document.getElementById('bm_codeValue');
    if (codeEl) codeEl.textContent = code || '—';
    set('bm_name', name); set('bm_brand', brand); set('bm_serving', dose); set('bm_servings', serves);
  }
  function ensureModal() {
    const overlay = document.getElementById('barcodeOverlay');
    const modal   = document.getElementById('barcodeModal');
    if (!overlay || !modal) return;

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
  window.openBarcodeModal = () => {
    ensureModal();
    const overlay = document.getElementById('barcodeOverlay');
    const modal   = document.getElementById('barcodeModal');
    if (!overlay || !modal) return;
    overlay.style.display = 'block';
    modal.style.display   = 'flex';
    document.body.style.overflow = 'hidden';
    document.getElementById('bm_name')?.focus();
  };

  // --- External lookups (kept simple for this patch) ---
  async function fetchProductInfoFromOFF(code, { timeoutMs = 6000 } = {}) {
    const candidates = [code];
    if (/^\d{12}$/.test(code)) candidates.push('0' + code); // UPC-A -> EAN-13
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), timeoutMs);
    try {
      for (const c of candidates) {
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
      }
      return null;
    } catch (e) {
      console.warn('OFF lookup issue:', e);
      return null;
    } finally { clearTimeout(to); }
  }

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

    const off = await fetchProductInfoFromOFF(code);
    if (off) populateModalFields({ code, name: off.name, brand: off.brand, dose: off.dose, serves: off.serves });
    setStatus('');
  }

  // --- Image helpers ---
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

  // --- ZXing robust fallback ---
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
    const makeCanvas = (w, h) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      return c;
    };

    const drawVariant = (angleDeg = 0, crop = 'full') => {
      // Compute base size
      const scale = img.width > maxW ? maxW / img.width : 1;
      const baseW = Math.max(1, Math.round(img.width * scale));
      const baseH = Math.max(1, Math.round(img.height * scale));

      // Crop rect
      let sx = 0, sy = 0, sw = img.width, sh = img.height;
      if (crop === 'center') {
        const cw = Math.round(img.width * 0.8);
        const ch = Math.round(img.height * 0.8);
        sx = Math.round((img.width - cw) / 2);
        sy = Math.round((img.height - ch) / 2);
        sw = cw; sh = ch;
      }

      // Target size after scale
      const tw = Math.max(1, Math.round(sw * scale));
      const th = Math.max(1, Math.round(sh * scale));

      // Rotate canvas if needed
      const rad = angleDeg * Math.PI / 180;
      const rot90 = angleDeg % 180 !== 0;
      const outW = rot90 ? th : tw;
      const outH = rot90 ? tw : th;
      const canvas = makeCanvas(outW, outH);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.save();
      // Move center and rotate
      ctx.translate(outW / 2, outH / 2);
      ctx.rotate(rad);
      // Draw so that rotated image is centered
      ctx.drawImage(img, sx, sy, sw, sh, -tw / 2, -th / 2, tw, th);
      ctx.restore();
      return canvas.toDataURL('image/jpeg', 0.92);
    };

    // ZXing reader with hints
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
        // continue with next variant
      }
    }
    reader.reset();
    return '';
  }

  // --- Scanner (photo → decode) ---
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
