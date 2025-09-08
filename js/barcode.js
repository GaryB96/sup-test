// Open the native camera picker on mobile and decode common barcodes (UPC/EAN/etc.)
// using the built-in Barcode Detection API where available (Chrome/Android).
(() => {
  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  onReady(() => {
    const btn = document.getElementById('barcodeBtn');
    if (!btn) return;

    // Hidden input to trigger the native camera on mobile
    const cameraInput = document.createElement('input');
    cameraInput.type = 'file';
    cameraInput.accept = 'image/*';
    cameraInput.capture = 'environment'; // rear camera hint on mobile
    cameraInput.style.display = 'none';
    document.body.appendChild(cameraInput);

    btn.addEventListener('click', () => cameraInput.click());

    cameraInput.addEventListener('change', async () => {
      const file = cameraInput.files && cameraInput.files[0];
      if (!file) return;

      try {
        // Quick capability check up front
        if (!('BarcodeDetector' in window)) {
          alert('Barcode scanning is not supported on this browser. (Works on Chrome/Android.)');
          return;
        }

        // Try to create an ImageBitmap. If very large, request a downscaled bitmap
        // to improve speed & detection reliability.
        const maxW = 1600; // simple cap to avoid huge camera images
        let bmp;
        try {
          bmp = await createImageBitmap(file, { resizeWidth: maxW, resizeQuality: 'high' });
        } catch {
          // Fallback if resize options aren’t supported
          bmp = await createImageBitmap(file);
        }

        const detector = new window.BarcodeDetector({
          formats: [
            'ean_13','ean_8',
            'upc_a','upc_e',
            'code_128','code_39',
            'qr_code'
          ]
        });

        const results = await detector.detect(bmp);

        if (results && results.length) {
          // Prefer retail codes if multiple are present
          const preferred = results.find(r =>
            ['ean_13','upc_a','upc_e','ean_8'].includes((r.format || r.formatName || '').toLowerCase())
          ) || results[0];

          const code = (preferred.rawValue || '').trim();
          if (code) {
            alert(`Scanned: ${code}`);
            // Example: dispatch a custom event your app can consume
            // document.dispatchEvent(new CustomEvent('barcode:scanned', { detail: { code, format: preferred.format } }));
          } else {
            alert('A barcode was detected, but no value was read. Please try again with better lighting.');
          }
        } else {
          alert('No barcode detected. Try a clearer, well-lit shot with the code filling the frame.');
        }
      } catch (err) {
        console.error('Barcode scan error:', err);
        alert('Could not read the image. Please try again.');
      } finally {
        // Allow selecting the same file again
        cameraInput.value = '';
      }
    });
  });
})();
