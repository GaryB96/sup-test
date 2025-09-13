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

  function showScanSpinner(text){
    try{
      var sp = document.getElementById('scanSpinner');
      if (!sp) return;
      sp.classList.remove('hidden');
      var t = sp.querySelector('.scan-spinner-text');
      if (t && text) t.textContent = text;
    }catch(_){}
  }
  function hideScanSpinner(){
    try{
      var sp = document.getElementById('scanSpinner');
      if (!sp) return;
      sp.classList.add('hidden');
    }catch(_){}
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
    var to = setTimeout(function () { ac.abort(); }, timeoutMs);
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
    var to = setTimeout(function () { ac.abort(); }, timeoutMs);
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

  // ---------- Live scan (camera stream) ----------
  var __live = { stream: null, zxingCtrl: null, running: false, raf: 0 };

  async function startLiveScan() {
    try {
      var wrap = document.getElementById('liveScanWrap');
      var video = document.getElementById('liveVideo');
      var stopBtn = document.getElementById('liveStopBtn');
      if (!wrap || !video) return;
      if (__live.running) return;
      __live.running = true;
      wrap.classList.remove('hidden');
      // iOS/Safari friendly video flags
      try {
        video.setAttribute('playsinline','');
        video.setAttribute('webkit-playsinline','true');
        video.playsInline = true; video.muted = true; video.autoplay = true;
      } catch(_){ }

      // Try native BarcodeDetector with getUserMedia
      var useDetector = ('BarcodeDetector' in window);
      if (useDetector) {
        try {
          var stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
          __live.stream = stream;
          video.srcObject = stream;
          await new Promise(function(res){ video.onloadedmetadata = res; });
          video.play();
          var det = await makeBarcodeDetector();
          // Prepare a canvas for Safari where det.detect(video) may fail
          var vCan = document.createElement('canvas');
          var vCtx = vCan.getContext('2d', { willReadFrequently: true });
          var stopped = false;
          if (stopBtn) stopBtn.onclick = function(){ stopped = true; stopLiveScan(); };
          async function loop(){
            if (!__live.running || stopped) return;
            try {
              var results = null;
              try {
                // Try detecting on the video element directly
                results = await det.detect(video);
              } catch(_e1) {
                // Fallback: draw current frame to canvas and detect
                var vw = Math.max(1, video.videoWidth||video.clientWidth||320);
                var vh = Math.max(1, video.videoHeight||video.clientHeight||240);
                if (vCan.width !== vw || vCan.height !== vh) { vCan.width = vw; vCan.height = vh; }
                vCtx.drawImage(video, 0, 0, vw, vh);
                results = await det.detect(vCan);
              }
              if (results && results.length && results[0] && results[0].rawValue) {
                var code = String(results[0].rawValue || '').trim();
                __live.running = false;
                stopLiveScan();
                await fillSupplementFromBarcode(code, null);
                return;
              }
            } catch(_){}
            __live.raf = requestAnimationFrame(loop);
          }
          __live.raf = requestAnimationFrame(loop);
          return;
        } catch (e) {
          // fall through to ZXing
        }
      }

      // ZXing video fallback
      var ZX = (typeof window !== 'undefined') ? (window.ZXingBrowser || window.ZXing) : null;
      if (ZX && ZX.BrowserMultiFormatReader) {
        try {
          var reader = new ZX.BrowserMultiFormatReader();
          __live.zxingCtrl = await reader.decodeFromVideoDevice(null, video, async function(res, err){
            if (!__live.running) return;
            if (res && (res.text || (res.getText && res.getText()))) {
              var code = String(res.text || (res.getText && res.getText()) || '').trim();
              __live.running = false; stopLiveScan();
              await fillSupplementFromBarcode(code, null);
            }
          });
          if (stopBtn) stopBtn.onclick = function(){ stopLiveScan(); };
          return;
        } catch (_eZX) {
          // Canvas polling fallback using ZXing
          try {
            var stream2 = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
            __live.stream = stream2; video.srcObject = stream2; await new Promise(function(res){ video.onloadedmetadata = res; }); video.play();
          } catch(_) { alert('Live scan not supported or permission denied.'); stopLiveScan(); return; }
          var vCan2 = document.createElement('canvas'); var vCtx2 = vCan2.getContext('2d', { willReadFrequently: true });
          var reader2 = new ZX.BrowserMultiFormatReader();
          async function poll(){
            if (!__live.running) return;
            try {
              var vw = Math.max(1, video.videoWidth||video.clientWidth||320);
              var vh = Math.max(1, video.videoHeight||video.clientHeight||240);
              if (vCan2.width !== vw || vCan2.height !== vh) { vCan2.width = vw; vCan2.height = vh; }
              vCtx2.drawImage(video, 0, 0, vw, vh);
              // Compat: if reader2.decodeFromCanvas missing, use dataURL path
              var res;
              try { res = await reader2.decodeFromCanvas(vCan2); }
              catch(_m){ try { res = await reader2.decodeFromImageUrl(vCan2.toDataURL('image/jpeg', 0.85)); } catch(_m2){} }
              var t = res && (res.text || (res.getText && res.getText()));
              if (t && String(t).trim()) {
                __live.running = false; stopLiveScan();
                await fillSupplementFromBarcode(String(t).trim(), null);
                return;
              }
            } catch(_){}
            __live.raf = requestAnimationFrame(poll);
          }
          __live.raf = requestAnimationFrame(poll);
          if (stopBtn) stopBtn.onclick = function(){ stopLiveScan(); };
        }
      } else {
        alert('Live scan is not supported on this browser.');
        stopLiveScan();
      }
    } catch (e) {
      console.warn('[live] start failed', e); stopLiveScan();
    }
  }

  function stopLiveScan() {
    try {
      if (__live.raf) cancelAnimationFrame(__live.raf);
      __live.raf = 0;
    } catch(_){}
    try {
      if (__live.zxingCtrl && __live.zxingCtrl.stop) __live.zxingCtrl.stop();
    } catch(_){}
    __live.zxingCtrl = null;
    try {
      if (__live.stream) {
        __live.stream.getTracks().forEach(function(t){ try{ t.stop(); }catch(_){ } });
      }
    } catch(_){}
    __live.stream = null;
    __live.running = false;
    var wrap = document.getElementById('liveScanWrap');
    var video = document.getElementById('liveVideo');
    if (video) { try { video.pause(); } catch(_){}; video.srcObject = null; }
    if (wrap) wrap.classList.add('hidden');
  }

  // ---------- Dynamic loader for ZXing (for iOS where UMD global may be missing) ----------
  function loadScript(url, timeoutMs) {
    return new Promise(function (resolve, reject) {
      try {
        var s = document.createElement('script');
        s.src = url;
        s.async = true;
        var done = false;
        s.onload = function () { if (!done) { done = true; resolve(); } };
        s.onerror = function () { if (!done) { done = true; reject(new Error('Script load failed: ' + url)); } };
        document.head.appendChild(s);
        setTimeout(function(){ if (!done) { done = true; reject(new Error('Script load timeout: ' + url)); } }, timeoutMs || 6000);
      } catch (e) { reject(e); }
    });
  }

  async function ensureZXingLoaded() {
    var ZX = (typeof window !== 'undefined') ? (window.ZXingBrowser || window.ZXing) : null;
    if (ZX && ZX.BrowserMultiFormatReader) return ZX;
    try { console.info('[barcode] attempting to load @zxing/browser UMD'); } catch(_){}
    try { await loadScript('https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/index.min.js', 7000); } catch (e1) { try { console.warn('[barcode] load @zxing/browser failed', e1); } catch(_){} }
    ZX = (typeof window !== 'undefined') ? (window.ZXingBrowser || window.ZXing) : null;
    if (ZX && ZX.BrowserMultiFormatReader) return ZX;
    try { console.info('[barcode] attempting to load @zxing/library UMD'); } catch(_){}
    try { await loadScript('https://cdn.jsdelivr.net/npm/@zxing/library@0.20.0/umd/index.min.js', 7000); } catch (e2) { try { console.warn('[barcode] load @zxing/library failed', e2); } catch(_){} }
    ZX = (typeof window !== 'undefined') ? (window.ZXingBrowser || window.ZXing) : null;
    return (ZX && ZX.BrowserMultiFormatReader) ? ZX : null;
  }

  // ---------- ZXing robust fallback (iPhone/Safari) ----------
  async function decodeWithZXingRobust(file) {
    // Support both @zxing/browser UMD globals: ZXing (some builds) or ZXingBrowser
    var ZX = (typeof window !== 'undefined') ? (window.ZXingBrowser || window.ZXing) : null;
    try { console.info('[barcode] ZX global:', ZX ? (ZX.name || 'present') : 'missing'); } catch(_){}
    if (!(ZX && ZX.BrowserMultiFormatReader)) {
      try { console.warn('ZXing not available, loading dynamically...'); } catch(_){}
      ZX = await ensureZXingLoaded();
      try { console.info('[barcode] ZX after load:', (ZX && ZX.BrowserMultiFormatReader) ? 'present' : 'missing'); } catch(_){}
    }
    if (!(ZX && ZX.BrowserMultiFormatReader)) {
      console.warn('ZXing not available');
      return '';
    }

    // First, build a canvas using createImageBitmap (respects EXIF on iOS) then try decode
    var baseCanvas;
    try {
      var bmp0 = await makeBitmapFromFile(file, 1600);
      if (bmp0) {
        if (typeof bmp0.getContext === 'function') {
          baseCanvas = bmp0; // already a canvas
        } else {
          baseCanvas = document.createElement('canvas');
          baseCanvas.width = bmp0.width; baseCanvas.height = bmp0.height;
          var bctx = baseCanvas.getContext('2d', { willReadFrequently: true });
          bctx.drawImage(bmp0, 0, 0);
        }
        try { console.info('[barcode] base canvas dims:', baseCanvas.width, 'x', baseCanvas.height); } catch(_){}
        // light preprocess
        var bctx2 = baseCanvas.getContext('2d');
        preprocessFor1D(bctx2, baseCanvas.width, baseCanvas.height);
        // Try normal decode
        try {
          var res0 = await decodeFromCanvasCompat(new ZX.BrowserMultiFormatReader(), baseCanvas);
          var t0 = res0 && (res0.text || (res0.getText && res0.getText()));
          if (t0 && String(t0).trim()) { return String(t0).trim(); }
        } catch (e0) { try { console.info('[barcode] base canvas decode failed', e0 && e0.message); } catch(_){} }
        // Try inverted decode
        try {
          var id0 = bctx2.getImageData(0,0,baseCanvas.width, baseCanvas.height);
          for (var ii=0; ii<id0.data.length; ii+=4) {
            id0.data[ii]   = 255 - id0.data[ii];
            id0.data[ii+1] = 255 - id0.data[ii+1];
            id0.data[ii+2] = 255 - id0.data[ii+2];
          }
          bctx2.putImageData(id0, 0, 0);
          var res0i = await decodeFromCanvasCompat(new ZX.BrowserMultiFormatReader(), baseCanvas);
          var t0i = res0i && (res0i.text || (res0i.getText && res0i.getText()));
          if (t0i && String(t0i).trim()) { return String(t0i).trim(); }
        } catch (e0i) { try { console.info('[barcode] base canvas inverted decode failed', e0i && e0i.message); } catch(_){} }
      }
    } catch (eInit) { try { console.info('[barcode] base canvas init failed', eInit && eInit.message); } catch(_){} }

    // Read file as data URL (fallback path)
    var dataUrl;
    try { dataUrl = await readFileAsDataURL(file); } catch (e) { console.warn('FileReader failed', e); return ''; }
    var img;
    try { img = await loadImage(dataUrl); } catch (e2) { console.warn('Image load failed', e2); return ''; }
    try { console.info('[barcode] image dims:', img && img.width, 'x', img && img.height); } catch(_){}

    var hints = new Map();
    if (ZX && ZX.DecodeHintType && ZX.BarcodeFormat) {
      hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [
        ZX.BarcodeFormat.EAN_13, ZX.BarcodeFormat.UPC_A,
        ZX.BarcodeFormat.EAN_8,  ZX.BarcodeFormat.UPC_E,
        ZX.BarcodeFormat.CODE_128, ZX.BarcodeFormat.CODE_39,
        ZX.BarcodeFormat.ITF
      ]);
      hints.set(ZX.DecodeHintType.TRY_HARDER, true);
      try { hints.set(ZX.DecodeHintType.ASSUME_GS1, true); } catch(_){}
      try { hints.set(ZX.DecodeHintType.ALSO_INVERTED, true); } catch(_){}
    }
    var reader = new ZX.BrowserMultiFormatReader(hints);

    // Fast-path: try decoding directly from the image element or data URL
    try { console.info('[barcode] try direct decode (element)'); } catch(_){}
    try {
      if (typeof reader.decodeFromImageElement === 'function') {
        var directRes = await reader.decodeFromImageElement(img);
        var directText = directRes && (directRes.text || (directRes.getText && directRes.getText()));
        if (directText && String(directText).trim()) { reader.reset(); try { console.info('[barcode] decoded via image element'); } catch(_){} return String(directText).trim(); }
      }
    } catch (e) { try { console.info('[barcode] direct decode failed', e && e.message); } catch(_){} }
    try { console.info('[barcode] try direct decode (data URL)'); } catch(_){}
    try {
      if (typeof reader.decodeFromImageUrl === 'function') {
        var urlRes = await reader.decodeFromImageUrl(dataUrl);
        var urlText = urlRes && (urlRes.text || (urlRes.getText && urlRes.getText()));
        if (urlText && String(urlText).trim()) { reader.reset(); try { console.info('[barcode] decoded via data URL'); } catch(_){} return String(urlText).trim(); }
      }
    } catch (e) { try { console.info('[barcode] data URL decode failed', e && e.message); } catch(_){} }

  function makeCanvas(w, h) { var c=document.createElement('canvas'); c.width=w; c.height=h; return c; }

  // Compat: some ZXing builds lack decodeFromCanvas; emulate via data URL
  async function decodeFromCanvasCompat(reader, canvas) {
    try {
      if (typeof reader.decodeFromCanvas === 'function') {
        return await reader.decodeFromCanvas(canvas);
      }
    } catch (_) {}
    try { console.info('[barcode] using compat path: canvas->dataURL'); } catch(_){}
    var url;
    try { url = canvas.toDataURL('image/jpeg', 0.92); } catch(_) { url = canvas.toDataURL('image/png'); }
    if (typeof reader.decodeFromImageUrl === 'function') {
      return await reader.decodeFromImageUrl(url);
    }
    // As a last resort, create an <img> and try element-based decode if available
    try {
      var imgEl = new Image();
      imgEl.src = url;
      await new Promise(function(res, rej){ imgEl.onload = res; imgEl.onerror = rej; });
      if (typeof reader.decodeFromImageElement === 'function') {
        return await reader.decodeFromImageElement(imgEl);
      }
    } catch (_) {}
    throw new Error('No canvas decode path available');
  }

    // First, try canvas-based decode with preprocessing and rotations
    // Use baseCanvas (EXIF-corrected) if available; otherwise the <img>
    var src = baseCanvas || img;
    var maxW = 1400;
    var scale = src.width > maxW ? maxW / src.width : 1;
    var baseW = Math.max(1, Math.round(src.width * scale));
    var baseH = Math.max(1, Math.round(src.height * scale));

    var angles = [0, 90, 270, 180];
    var crops  = ['full','center','hstrip','vstrip','topstrip','bottomstrip','leftstrip','rightstrip'];

    for (var ai = 0; ai < angles.length; ai++) {
      for (var ci = 0; ci < crops.length; ci++) {
        try {
          var angleDeg = angles[ai];
          var crop = crops[ci];

          // Compute crop source
          var sx = 0, sy = 0, sw = src.width, sh = src.height;
          if (crop === 'center') {
            var cw = Math.round(src.width * 0.8);
            var ch = Math.round(src.height * 0.8);
            sx = Math.round((src.width - cw) / 2);
            sy = Math.round((src.height - ch) / 2);
            sw = cw; sh = ch;
          } else if (crop === 'hstrip') {
            // middle horizontal band (good for 1D barcodes)
            var ch2 = Math.round(src.height * 0.35);
            sx = 0;
            sy = Math.round((src.height - ch2) / 2);
            sw = src.width;
            sh = ch2;
          } else if (crop === 'vstrip') {
            // middle vertical band (for tall/rotated codes)
            var cw2 = Math.round(src.width * 0.35);
            sx = Math.round((src.width - cw2) / 2);
            sy = 0;
            sw = cw2;
            sh = src.height;
          } else if (crop === 'topstrip') {
            var tch = Math.round(src.height * 0.35);
            sx = 0; sy = 0; sw = src.width; sh = tch;
          } else if (crop === 'bottomstrip') {
            var bch = Math.round(src.height * 0.35);
            sx = 0; sy = src.height - bch; sw = src.width; sh = bch;
          } else if (crop === 'leftstrip') {
            var lcw = Math.round(src.width * 0.35);
            sx = 0; sy = 0; sw = lcw; sh = src.height;
          } else if (crop === 'rightstrip') {
            var rcw = Math.round(src.width * 0.35);
            sx = src.width - rcw; sy = 0; sw = rcw; sh = src.height;
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
          ctx.drawImage(src, sx, sy, sw, sh, -tw / 2, -th / 2, tw, th);
          ctx.restore();

          // preprocess for 1D contrast
          preprocessFor1D(ctx, outW, outH);

          // Try decode from canvas (compat if needed)
          try {
            var res = await decodeFromCanvasCompat(reader, canvas);
            var text = res && (res.text || (res.getText && res.getText()));
            if (text && String(text).trim()) { reader.reset(); return String(text).trim(); }
          } catch (eDec) {}

          // Try inverted decode on this crop
          try {
            var id = ctx.getImageData(0,0,outW,outH);
            for (var kk=0; kk<id.data.length; kk+=4) {
              id.data[kk]   = 255 - id.data[kk];
              id.data[kk+1] = 255 - id.data[kk+1];
              id.data[kk+2] = 255 - id.data[kk+2];
            }
            ctx.putImageData(id, 0, 0);
            var resInv = await decodeFromCanvasCompat(reader, canvas);
            var textInv = resInv && (resInv.text || (resInv.getText && resInv.getText()));
            if (textInv && String(textInv).trim()) { reader.reset(); return String(textInv).trim(); }
          } catch (_) {}
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
      var liveBtn = document.getElementById('liveScanBtn');
      var liveStop = document.getElementById('liveStopBtn');
      if (!btn && !liveBtn) return;
      bound = true; window.__SCANNER_BOUND = true;

      var cameraInput = document.createElement('input');
      cameraInput.type = 'file';
      // Hint iOS to return JPEG/PNG instead of HEIC when possible
      cameraInput.accept = 'image/jpeg,image/jpg,image/png';
      cameraInput.capture = 'environment';
      cameraInput.style.display = 'none';
      document.body.appendChild(cameraInput);

      if (btn && btn.dataset && btn.dataset.scannerBound !== '1') {
        btn.addEventListener('click', function () { cameraInput.click(); });
        btn.dataset.scannerBound = '1';
      }
      if (liveBtn && liveBtn.dataset && liveBtn.dataset.scannerBound !== '1') {
        liveBtn.addEventListener('click', function () { startLiveScan(); });
        liveBtn.dataset.scannerBound = '1';
      }
      if (liveStop && liveStop.dataset && liveStop.dataset.scannerBound !== '1') {
        liveStop.addEventListener('click', function () { stopLiveScan(); });
        liveStop.dataset.scannerBound = '1';
      }

      cameraInput.addEventListener('change', async function () {
        var file = cameraInput.files && cameraInput.files[0];
        if (!file) return;

        try { console.info('[barcode] file selected:', { name: file.name, type: file.type, size: file.size }); } catch(_){}

        if (isProblematicHeic(file)) {
          alert('This image format (HEIC/Live Photo) may not decode reliably. Please switch your Camera format to "Most Compatible" (JPEG) or retake the photo with that setting.');
          cameraInput.value = '';
          return;
        }

        try {
          showScanSpinner('Scanning…');
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
          // Final fallback: try BarcodeDetector even on iOS if available
          if (!code && 'BarcodeDetector' in window) {
            try {
              var bmp2 = await makeBitmapFromFile(file, 1600);
              if (bmp2) {
                var det2 = await makeBarcodeDetector();
                var res2 = await det2.detect(bmp2);
                if (res2 && res2.length && res2[0] && res2[0].rawValue) {
                  code = String(res2[0].rawValue || '').trim();
                }
              }
            } catch (_) {}
          }
          if (code) {
            showScanSpinner('Looking up product…');
            await fillSupplementFromBarcode(code, file);
          } else {
            alert('No barcode detected. Try a closer, well-lit shot filling the frame.');
          }
        } catch (err) {
          console.error('Scan error:', err);
          alert('Could not read the image. Please try again.');
        } finally {
          setStatus('');
          hideScanSpinner();
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
