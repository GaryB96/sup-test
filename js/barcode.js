(() => {
  function ready(fn){ document.readyState !== 'loading' ? fn() : document.addEventListener('DOMContentLoaded', fn); }

  ready(() => {
    // Support either an id or your custom attribute version
    const btn = document.getElementById('barcodeBtn') || document.querySelector('button[is="barcode"]');
    if (!btn) return;

    // Hidden camera input to invoke the native camera on mobile
    const cameraInput = document.createElement('input');
    cameraInput.type = 'file';
    cameraInput.accept = 'image/*';
    cameraInput.capture = 'environment'; // rear camera hint on mobile
    cameraInput.style.display = 'none';
    document.body.appendChild(cameraInput);

    btn.addEventListener('click', () => cameraInput.click());

    cameraInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      try {
        const bmp = await createImageBitmap(file);

        let code = null;
        if ('BarcodeDetector' in window) {
          const detector = new window.BarcodeDetector({
            formats: ['ean_13','ean_8','upc_a','upc_e','code_128','code_39','qr_code']
          });
          const results = await detector.detect(bmp);
          if (results && results.length) code = results[0].rawValue || results[0].rawValue;
        }

        // TODO: optional fallback — if you later include ZXing, try that here when code is still null.

        if (code) {
          // For now, just show it; replace this with your lookup flow later.
          alert(`Scanned: ${code}`);
          // e.g., dispatch a custom event your app can listen for:
          // document.dispatchEvent(new CustomEvent('barcode:scanned', { detail: { code } }));
        } else {
          alert('No barcode detected. Try a clearer photo with the code centered and well-lit.');
        }
      } catch (err) {
        console.error(err);
        alert('Could not read the image. Please try again.');
      } finally {
        // Allow re-selecting the same file if needed
        cameraInput.value = '';
      }
    });
  });
})();
