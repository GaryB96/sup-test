
// ===== MINIMAL BARCODE TEST (standalone) =====
(function () {
  function onReady(fn){ if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',fn);} else {fn();} }

  async function makeDetector() {
    try {
      if (!('BarcodeDetector' in window)) return null;
      let formats = ['qr_code','ean_13','ean_8','upc_e','code_128','code_39'];
      try {
        if (typeof BarcodeDetector.getSupportedFormats === 'function') {
          const sup = await BarcodeDetector.getSupportedFormats();
          if (Array.isArray(sup) && sup.length) {
            formats = formats.filter(f => sup.includes(f));
          }
        }
      } catch(_) {}
      try { return new BarcodeDetector({ formats }); } catch { return new BarcodeDetector(); }
    } catch { return null; }
  }

  function readFileAsDataURL(file){
    return new Promise((res,rej)=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.onerror=rej; fr.readAsDataURL(file); });
  }
  function loadImage(src){
    return new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=rej; i.src=src; });
  }
  function makeCanvas(w,h){ const c=document.createElement('canvas'); c.width=w; c.height=h; return c; }

  async function decodeZXing(file){
    if (!(window.ZXing && ZXing.BrowserMultiFormatReader)) return '';
    const dataUrl = await readFileAsDataURL(file);
    const img = await loadImage(dataUrl);
    const maxW = 1600;
    const scale = img.width>maxW ? maxW/img.width : 1;
    const w = Math.max(1, Math.round(img.width*scale));
    const h = Math.max(1, Math.round(img.height*scale));
    const canvas = makeCanvas(w,h);
    const ctx = canvas.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(img,0,0,w,h);

    const hints = new Map();
    if (ZXing.DecodeHintType && ZXing.BarcodeFormat) {
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS,[
        ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.UPC_A,
        ZXing.BarcodeFormat.EAN_8, ZXing.BarcodeFormat.UPC_E,
        ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.CODE_39
      ]);
      hints.set(ZXing.DecodeHintType.TRY_HARDER,true);
    }
    const reader = new ZXing.BrowserMultiFormatReader(hints);
    try {
      const res = await reader.decodeFromCanvas(canvas);
      const text = res && (res.text || (res.getText && res.getText()));
      return (text && String(text).trim()) || '';
    } catch { return ''; }
    finally { try{reader.reset();}catch{} }
  }

  onReady(function(){
    const btn = document.getElementById('barcodeBtn');
    if (!btn) { console.warn('[minimal] #barcodeBtn not found'); return; }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.style.display = 'none';
    document.body.appendChild(input);

    btn.addEventListener('click', () => input.click());

    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        let code = '';
        const det = await makeDetector();
        if (det) {
          try {
            // Use createImageBitmap so EXIF orientation is respected
            const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
            const results = await det.detect(bmp);
            if (results && results.length) {
              const best = results.find(r=>/ean|upc|code/i.test(r.format)) || results[0];
              code = best.rawValue || '';
            }
          } catch {}
        }
        if (!code) {
          code = await decodeZXing(file);
        }
        if (code) {
          alert('[OK] Decoded: ' + code);
        } else {
          alert('[FAIL] Could not read this image.');
        }
      } catch (e) {
        console.error('[minimal] error:', e);
        alert('[ERROR] ' + (e && e.message || e));
      } finally {
        input.value = '';
      }
    });
  });
})();
// ===== END MINIMAL TEST =====
