// --- Added: mild grayscale/contrast pre-process
function preprocessFor1D(ctx, w, h) {
  try {
    const img = ctx.getImageData(0, 0, w, h);
    const data = img.data;
    // grayscale + slight contrast stretch
    let min=255, max=0;
    for (let i=0;i<data.length;i+=4){
      const y = (data[i]*0.2126 + data[i+1]*0.7152 + data[i+2]*0.0722);
      if (y<min) min=y;
      if (y>max) max=y;
    }
    const range = Math.max(1, max - min);
    for (let i=0;i<data.length;i+=4){
      const y = (data[i]*0.2126 + data[i+1]*0.7152 + data[i+2]*0.0722);
      let v = (y - min) * (255 / range);
      data[i] = data[i+1] = data[i+2] = v;
    }
    ctx.putImageData(img, 0, 0);
  } catch(_) {}
}

// --- Added: robust HEIC/Live Photo guard
function isProblematicHeic(file) {
  const name = (file && file.name || '').toLowerCase();
  const type = (file && file.type || '').toLowerCase();
  const extHeic = name.endsWith('.heic') || name.endsWith('.heif');
  const typeHeic = type.includes('heic') || type.includes('heif') || type.includes('quicktime') || type.includes('heic-sequence');
  // Allow empty MIME (some iOS cases) rather than blocking
  return extHeic || typeHeic;
}

// --- Added: safer detector factory
async function makeBarcodeDetector() {
  try {
    if (!('BarcodeDetector' in window)) return null;
    // Try to get supported formats if available
    let supported = null;
    try {
      if (typeof BarcodeDetector.getSupportedFormats === 'function') {
        supported = await BarcodeDetector.getSupportedFormats();
      }
    } catch (_) {}
    const desired = ['qr_code','ean_13','ean_8','upc_e','code_128','code_39','itf','pdf417'];
    const formats = supported ? desired.filter(f => supported.includes(f)) : ['qr_code','ean_13','ean_8','upc_e','code_128','code_39'];
    try {
      return new BarcodeDetector({ formats });   // ✅ construct the detector
      // If some browsers balk at the options object, fall back to:
      // return new BarcodeDetector();
    } catch (e) {
      return null;
    }
  } catch (e) {
    return null;
  }
}

// barcode.js — full version with iPhone ZXing fallback (Safari-friendly), HC/OFF lookups, optional OCR, and dev helper
(function () {
  var IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || ((navigator.platform === 'MacIntel') && navigator.maxTouchPoints > 1);
  var FORCE_ZXING_ON_IOS = true;
  // ---------- utils ----------
  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, false);
    } else { fn(); }
  }

  function setStatus(msg) {
    var el = document.getElementById('bm_status');
    if (el) el.textContent = msg || '';
  }

  function setSearchLinks(opts) {
    opts = opts || {};
    var code = opts.code || '';
    var name = (opts.name || '').trim();
    var brand = (opts.brand || '').trim();

    var off = document.getElementById('bm_link_off');
    var hc  = document.getElementById('bm_link_hc');
    var ggl = document.getElementById('bm_link_ggl');

    var qBase = name || code || '';
    if (off) off.href = code ? ('https://world.openfoodfacts.org/product/' + encodeURIComponent(code))
                             : 'https://world.openfoodfacts.org/';

    var hcQuery = 'site:health-products.canada.ca/lnhpd-bdpsnh ' + qBase;
    if (hc) hc.href = 'https://www.google.com/search?q=' + encodeURIComponent(hcQuery);

    var g = name;
    if (brand) g = (brand + ' ' + g).trim();
    if (!g) g = code || '';
    if (ggl) ggl.href = 'https://www.google.com/search?q=' + encodeURIComponent(g);
  }

  function populateModalFields(obj) {
    obj = obj || {};
    var code = obj.code || '';
    var name = obj.name || '';
    var brand = obj.brand || '';
    var dose = obj.dose || '';
    var serves = obj.serves || '';

    var codeEl = document.getElementById('bm_codeValue');
    if (codeEl) codeEl.textContent = code || '—';

    var el;
    el = document.getElementById('bm_name');     if (el) el.value = name;
    el = document.getElementById('bm_brand');    if (el) el.value = brand;
    el = document.getElementById('bm_serving');  if (el) el.value = dose;
    el = document.getElementById('bm_servings'); if (el) el.value = serves;

    setSearchLinks({ code: code, name: name, brand: brand });
  }
  

  // ---------- External lookups ----------
  async function fetchProductInfoFromHC(args, opts) {
    args = args || {};
    opts = opts || {};
    var name = args.name || '';
    var brand = args.brand || '';
    var code = args.code || '';
    var timeoutMs = opts.timeoutMs || 8000;

    var base = 'https://health-products.canada.ca/api/natural-licences/';
    var q = (brand || name || code || '').trim();
    if (!q) return null;

    var urls = [
      base + '?lang=en&type=json&search=' + encodeURIComponent(q),
      base + '?lang=en&type=json&brandname=' + encodeURIComponent(q),
      base + '?lang=en&type=json&productname=' + encodeURIComponent(q)
    ];

    var ac = new AbortController();
    var to = setTimeout(function () {
  var IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || ((navigator.platform === 'MacIntel') && navigator.maxTouchPoints > 1);
  var FORCE_ZXING_ON_IOS = true; ac.abort(); }, timeoutMs);
    try {
      for (var i = 0; i < urls.length; i++) {
        var url = urls[i];
        try {
          var res = await fetch(url, { signal: ac.signal, headers: { 'Accept': 'application/json' } });
          if (!res.ok) continue;
          var data = await res.json();
          var first = (data && data.results && data.results[0]) || (Array.isArray(data) && data[0]) || null;
          if (!first) continue;

          function pick(obj, keys) {
            for (var j = 0; j < keys.length; j++) {
              var k = keys[j];
              if (obj && obj[k] != null && String(obj[k]).trim() !== '') return String(obj[k]).trim();
            }
            return '';
          }
          var mapped = {
            name:   pick(first, ['product_name_en','product_name','licence_name_en','licence_name','name']),
            brand:  pick(first, ['brand_name_en','brand_name','brandname','brand']),
            dose:   pick(first, ['recommended_dose','dose','posology','serving_size']),
            serves: pick(first, ['servings_per_container','servings','net_content','unit_count'])
          };
          if (mapped.name || mapped.brand || mapped.dose || mapped.serves) return mapped;
        } catch (e) {}
      }
      return null;
    } finally { clearTimeout(to); }
  }

  async function fetchProductInfoFromOFF(code, opts) {
    opts = opts || {};
    var timeoutMs = opts.timeoutMs || 6000;
    var candidates = [code];
    if (/^\d{12}$/.test(code || '')) candidates.push('0' + code); // UPC-A -> EAN-13

    var ac = new AbortController();
    var to = setTimeout(function () {
  var IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || ((navigator.platform === 'MacIntel') && navigator.maxTouchPoints > 1);
  var FORCE_ZXING_ON_IOS = true; ac.abort(); }, timeoutMs);
    try {
      for (var i = 0; i < candidates.length; i++) {
        var c = candidates[i];
        try {
          var res = await fetch('https://world.openfoodfacts.org/api/v2/product/' + encodeURIComponent(c) + '.json', {
            signal: ac.signal, headers: { 'Accept': 'application/json' }
          });
          if (!res.ok) continue;
          var data = await res.json();
          var p = data && data.product;
          if (!p) continue;

          var name   = (p.product_name || '').trim();
          var brand  = ((p.brands || '').split(',')[0] || '').trim();
          var dose   = (p.serving_size || (p.nutriments && p.nutriments.serving_size) || '').trim();
          var serves = (p.number_of_servings != null ? String(p.number_of_servings)
                        : (p.servings != null ? String(p.servings) : '')).trim();
          if (name || brand || dose || serves) return { name: name, brand: brand, dose: dose, serves: serves };
        } catch (e) {}
      }
      return null;
    } catch (err) {
      console.warn('OFF lookup failed or blocked:', err);
      return null;
    } finally { clearTimeout(to); }
  }

  
  // ---------- Bridge to the already-open Supplement modal (safe filler) ----------
  async function fillSupplementFromBarcode(code, fileForOCR) {
    try {
      var form = document.getElementById('supplementModalForm') || document.querySelector('#supplementModal form');
      if (!form) {
        console.warn('[barcode] Supplement modal form not found; nothing to fill.');
        return;
      }
      var best = { name:'', brand:'', dose:'', serves:'' };
      try { var off = await fetchProductInfoFromOFF(code, { timeoutMs: 6000 }); if (off) best = Object.assign(best, off); } catch(_){}
      if ((!best.name && !best.brand) && fileForOCR && window.Tesseract) {
        try { var guess = await ocrFrontLabel(fileForOCR, { lang:'eng', maxW: 1600 }); if (guess) best = Object.assign(best, guess);} catch(_){}
      }
      if (!best.name && !best.brand) {
        try { var hc = await fetchProductInfoFromHC({ name: best.name, brand: best.brand, code: code }, { timeoutMs: 8000 }); if (hc) best = Object.assign(best, hc);} catch(_){}
      }
      var el;
      el = form.querySelector('#suppBrand');   if (el) el.value = best.brand || '';
      el = form.querySelector('#suppName');    if (el) el.value = best.name  || '';
      el = form.querySelector('#suppDosage');  if (el) el.value = best.dose  || '';
      el = form.querySelector('#suppServings');if (el) el.value = best.serves|| '';
      try { document.dispatchEvent(new CustomEvent('barcode:filled', { detail: { code: code, fields: best } })); } catch(_){}
      console.log('[barcode] filled supplement form from barcode:', code, best);
    } catch (e) {
      console.warn('[barcode] fillSupplementFromBarcode error:', e);
    }
  }
// ---------- Optional OCR (free) ----------
  function matchBest(text, regs) {
    for (var i = 0; i < regs.length; i++) {
      var r = regs[i];
      var m = text.match(r);
      if (m && m[1]) return m[1].trim();
    }
    return '';
  }
  function parseLabelText(text) {
    var brand = matchBest(text, [
      /(?:by|from)\s+([A-Z][\w&\- ]{2,30})/i,
      /^([A-Z][\w&\- ]{2,30})\b(?:®|™)?\s+(?:\w+)/i
    ]);
    var npn   = matchBest(text, [/NPN[:\s-]*([0-9]{8})/i]);
    var din   = matchBest(text, [/DIN[:\s-]*([0-9]{8})/i]);
    var dose  = matchBest(text, [
      /(\d+\s?(?:mg|mcg|µg|ug|g|IU)\b.*?(?:per|\/)\s?(?:tablet|capsule|softgel|softgels|serving|dose))/i,
      /serving size[:\s-]*([A-Za-z0-9 ,./-]+)$/i
    ]);
    var name = matchBest(text, [
      /\b([A-Z][\w'&\- ]{3,40})(?:\s+(?:capsules|tablets|softgels|powder|liquid|drops))?/i
    ]);
    return { name: name || '', brand: brand || '', dose: dose || '', npn: npn || '', din: din || '' };
  }
  async function ocrFrontLabel(file, opts) {
    opts = opts || {};
    var lang = opts.lang || 'eng';
    var maxW = opts.maxW || 1600;

    if (!(window.Tesseract && window.Tesseract.recognize)) throw new Error('Tesseract.js not available');
    var bmp = await makeBitmapFromFile(file, maxW);
    var canvas;
    if (bmp && bmp.width && bmp.height && bmp.close == null) {
      // likely a canvas/ImageBitmap-like
      canvas = document.createElement('canvas');
      canvas.width = bmp.width; canvas.height = bmp.height;
      var cctx = canvas.getContext('2d', { willReadFrequently: true });
      cctx.drawImage(bmp, 0, 0);
    } else {
      // fallback assume canvas
      canvas = bmp;
    }

    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    try {
      var imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      var factor = 1.15;
      for (var i = 0; i < imgData.data.length; i += 4) {
        imgData.data[i] = Math.min(255, imgData.data[i] * factor);
        imgData.data[i+1] = Math.min(255, imgData.data[i+1] * factor);
        imgData.data[i+2] = Math.min(255, imgData.data[i+2] * factor);
      }
      ctx.putImageData(imgData, 0, 0);
    } catch (e) {}

    var res = await window.Tesseract.recognize(canvas, lang);
    var text = (res && res.data && res.data.text ? res.data.text : '').replace(/\s+/g, ' ').trim();
    return parseLabelText(text);
  }

  // ---------- Image helpers ----------
  async function makeBitmapFromFile(file, maxW) {
    maxW = maxW || 1600;
    try { return await createImageBitmap(file, { imageOrientation: 'from-image', resizeWidth: maxW, resizeQuality: 'high' }); } catch (e1) {}
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e2) {}
    // Fallback via <img> + canvas
    var dataUrl = await readFileAsDataURL(file);
    var img = await loadImage(dataUrl);
    var scale = img.width > maxW ? (maxW / img.width) : 1;
    var w = Math.max(1, Math.round(img.width * scale));
    var h = Math.max(1, Math.round(img.height * scale));
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    return canvas;
  }

  function readFileAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }
  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var i = new Image();
      i.onload = function () { resolve(i); };
      i.onerror = reject;
      i.src = src;
    });
  }

  // ---------- ZXing robust fallback (iPhone/Safari) ----------
  async function decodeWithZXingRobust(file) {
    // Support both @zxing/browser UMD globals: ZXing (some builds) or ZXingBrowser
    var ZX = (typeof window !== 'undefined') ? (window.ZXing || window.ZXingBrowser) : null;
    if (!(ZX && ZX.BrowserMultiFormatReader)) {
      console.warn('ZXing not available');
      return '';
    }

    // Read file as data URL (CSP-friendly)
    var dataUrl;
    try { dataUrl = await readFileAsDataURL(file); } catch (e) { console.warn('FileReader failed', e); return ''; }
    var img;
    try { img = await loadImage(dataUrl); } catch (e2) { console.warn('Image load failed', e2); return ''; }

    var hints = new Map();
    if (ZX && ZX.DecodeHintType && ZX.BarcodeFormat) {
      hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [
        ZX.BarcodeFormat.EAN_13, ZX.BarcodeFormat.UPC_A,
        ZX.BarcodeFormat.EAN_8,  ZX.BarcodeFormat.UPC_E,
        ZX.BarcodeFormat.CODE_128, ZX.BarcodeFormat.CODE_39
      ]);
      hints.set(ZX.DecodeHintType.TRY_HARDER, true);
    }
    var reader = new ZX.BrowserMultiFormatReader(hints);

    function makeCanvas(w, h) { var c=document.createElement('canvas'); c.width=w; c.height=h; return c; }

    // First, try canvas-based decode with preprocessing and rotations
    var maxW = 1600;
    var scale = img.width > maxW ? maxW / img.width : 1;
    var baseW = Math.max(1, Math.round(img.width * scale));
    var baseH = Math.max(1, Math.round(img.height * scale));

    var angles = [0, 90, 270, 180];
    var crops  = ['full','center','hstrip','vstrip'];

    for (var ai = 0; ai < angles.length; ai++) {
      for (var ci = 0; ci < crops.length; ci++) {
        try {
          var angleDeg = angles[ai];
          var crop = crops[ci];

          // Compute crop source
          var sx = 0, sy = 0, sw = img.width, sh = img.height;
          if (crop === 'center') {
            var cw = Math.round(img.width * 0.8);
            var ch = Math.round(img.height * 0.8);
            sx = Math.round((img.width - cw) / 2);
            sy = Math.round((img.height - ch) / 2);
            sw = cw; sh = ch;
          } else if (crop === 'hstrip') {
            // middle horizontal band (good for 1D barcodes)
            var ch2 = Math.round(img.height * 0.35);
            sx = 0;
            sy = Math.round((img.height - ch2) / 2);
            sw = img.width;
            sh = ch2;
          } else if (crop === 'vstrip') {
            // middle vertical band (for tall/rotated codes)
            var cw2 = Math.round(img.width * 0.35);
            sx = Math.round((img.width - cw2) / 2);
            sy = 0;
            sw = cw2;
            sh = img.height;
          }
          // Target size
          var tw = Math.max(1, Math.round(sw * scale));
          var th = Math.max(1, Math.round(sh * scale));

          var rad = angleDeg * Math.PI / 180;
          var rot90 = angleDeg % 180 !== 0;
          var outW = rot90 ? th : tw;
          var outH = rot90 ? tw : th;

          var canvas = makeCanvas(outW, outH);
          var ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.save();
          ctx.translate(outW / 2, outH / 2);
          ctx.rotate(rad);
          ctx.drawImage(img, sx, sy, sw, sh, -tw / 2, -th / 2, tw, th);
          ctx.restore();

          // preprocess for 1D contrast
          preprocessFor1D(ctx, outW, outH);

          // Try decode from canvas
          try {
            var res = await reader.decodeFromCanvas(canvas);
            var text = res && (res.text || (res.getText && res.getText()));
            if (text && String(text).trim()) { reader.reset(); return String(text).trim(); }
          } catch (eDec) {}
        } catch (loopErr) {}
      }
    }

    // As a final fallback, try image URL variants (no preprocessing)
    try {
      var variants = [
        { a: 0,   c: 'full'   },
        { a: 0,   c: 'center' },
        { a: 90,  c: 'full'   },
        { a: 270, c: 'full'   },
        { a: 180, c: 'full'   }
      ];

      function drawVariantToDataURL(angleDeg, crop) {
        var sx = 0, sy = 0, sw = img.width, sh = img.height;
        var sc = img.width > maxW ? maxW / img.width : 1;
        if (crop === 'center') {
          var cw = Math.round(img.width * 0.8);
          var ch = Math.round(img.height * 0.8);
          sx = Math.round((img.width - cw) / 2);
          sy = Math.round((img.height - ch) / 2);
          sw = cw; sh = ch;
        }
        var tw = Math.max(1, Math.round(sw * sc));
        var th = Math.max(1, Math.round(sh * sc));
        var rad = angleDeg * Math.PI / 180;
        var rot90 = angleDeg % 180 !== 0;
        var outW = rot90 ? th : tw;
        var outH = rot90 ? tw : th;
        var c = makeCanvas(outW, outH);
        var cctx = c.getContext('2d', { willReadFrequently: true });
        cctx.save();
        cctx.translate(outW/2, outH/2);
        cctx.rotate(rad);
        cctx.drawImage(img, sx, sy, sw, sh, -tw/2, -th/2, tw, th);
        cctx.restore();
        return c.toDataURL('image/jpeg', 0.92);
      }

      for (var i = 0; i < variants.length; i++) {
        try {
          var v = variants[i];
          var vDataUrl = drawVariantToDataURL(v.a, v.c);
          var r2 = await reader.decodeFromImageUrl(vDataUrl);
          var t2 = r2 && (r2.text || (r2.getText && r2.getText()));
          if (t2 && String(t2).trim()) { reader.reset(); return String(t2).trim(); }
        } catch (e3) {}
      }
    } catch (e4) {}

    reader.reset();
    return '';
  }

// ---------- Autofill flow ----------
function getCurrentFieldValues() {
  var out = {
    name:   (document.getElementById('bm_name') && document.getElementById('bm_name').value || '').trim(),
    brand:  (document.getElementById('bm_brand') && document.getElementById('bm_brand').value || '').trim(),
    dose:   (document.getElementById('bm_serving') && document.getElementById('bm_serving').value || '').trim(),
    serves: (document.getElementById('bm_servings') && document.getElementById('bm_servings').value || '').trim()
  };
  return out;
}
function anyFilled(curr) {
  return !!(curr.name || curr.brand || curr.dose || curr.serves);
}

  // Replace legacy barcode modal path with direct supplement autofill
  async function openModalWithAutoFill(code, fileForOCR) {
    return fillSupplementFromBarcode(code, fileForOCR);
  }

  // Ensure scanner button works even if modal content is re-rendered or on Android DOM quirks
  (function ensureScannerBinding(){
    var bound = false;
    function bind() {
      if (bound || window.__SCANNER_BOUND) return;
      var btn = document.getElementById('barcodeBtn');
      if (!btn) return;
      bound = true; window.__SCANNER_BOUND = true;

      var cameraInput = document.createElement('input');
      cameraInput.type = 'file';
      cameraInput.accept = 'image/*';
      cameraInput.capture = 'environment';
      cameraInput.style.display = 'none';
      document.body.appendChild(cameraInput);

      if (btn && btn.dataset && btn.dataset.scannerBound === '1') return;
      btn.addEventListener('click', function () { cameraInput.click(); });
      if (btn && btn.dataset) btn.dataset.scannerBound = '1';

      cameraInput.addEventListener('change', async function () {
        var file = cameraInput.files && cameraInput.files[0];
        if (!file) return;

        if (isProblematicHeic(file)) {
          alert('This image format (HEIC/Live Photo) may not decode reliably. Please switch your Camera format to "Most Compatible" (JPEG) or retake the photo with that setting.');
          cameraInput.value = '';
          return;
        }

        try {
          var code = '';
          if (!IS_IOS && 'BarcodeDetector' in window) {
            try {
              var bmp = await makeBitmapFromFile(file, 1600);
              if (bmp) {
                var det = await makeBarcodeDetector();
                var res = await det.detect(bmp);
                if (res && res.length && res[0] && res[0].rawValue) code = String(res[0].rawValue || '').trim();
              }
            } catch (e) {}
          }
          if (!code) {
            setStatus('Scanning photo…');
            code = await decodeWithZXingRobust(file);
          }
          if (code) {
            await fillSupplementFromBarcode(code, file);
          } else {
            alert('No barcode detected. Try a closer, well-lit shot filling the frame.');
          }
        } catch (err) {
          console.error('Scan error:', err);
          alert('Could not read the image. Please try again.');
        } finally {
          setStatus('');
          cameraInput.value = '';
        }
      });
    }

    // Bind immediately if possible
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      bind();
    } else {
      document.addEventListener('DOMContentLoaded', bind);
    }

    // Observe for late insertions
    var mo = new MutationObserver(function() {
      if (!window.__SCANNER_BOUND) bind();
    });
    mo.observe(document.documentElement || document.body, { childList: true, subtree: true });
  })();

// ===== barcode.js =====

// Your existing scanning logic stays above...

window.openBarcodeModal = function (code, seed) {
  // Close or hide the old barcode modal if it exists
  const oldModal = document.getElementById('barcodeModal');
  if (oldModal) {
    if (typeof $(oldModal).modal === 'function') {
      $(oldModal).modal('hide');
      $('.modal-backdrop').remove();
      $('body').removeClass('modal-open');
    } else {
      oldModal.style.display = 'none';
    }
  }

  // Forward the data to the supplement modal
  openSupplementModalFromBarcode({
    code,
    name: (seed && seed.name) || '',
    brand: (seed && seed.brand) || '',
    dose: (seed && seed.dose) || '',
    serves: (seed && seed.serves) || ''
  });
}})();
