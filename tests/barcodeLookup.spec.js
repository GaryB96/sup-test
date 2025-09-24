import fs from 'fs';
import vm from 'vm';
import assert from 'assert';

const source = fs.readFileSync('js/barcode.js', 'utf8');
const start = source.indexOf('function firstNonEmpty');
const end = source.indexOf('  async function fillSupplementFromBarcode');
if (start === -1 || end === -1) {
  throw new Error('Unable to locate barcode lookup helpers in barcode.js');
}
const snippet = source.slice(start, end);

const calls = [];
const context = {
  fetch: async (url) => { calls.push(url); return { ok: false, json: async () => ({}) }; },
  AbortController,
  console: { warn: () => {}, info: () => {}, log: () => {} },
  setTimeout,
  clearTimeout,
  encodeURIComponent
};

vm.createContext(context);
vm.runInContext(snippet, context);

// Helper sanity checks
const mapped = context.mapOpenFactsProduct({
  product_name: 'Omega Complex',
  brands: 'Acme Labs,Other',
  serving_size: '2 capsules',
  number_of_servings: 90
});
assert.strictEqual(mapped.name, 'Omega Complex');
assert.strictEqual(mapped.brand, 'Acme Labs');
assert.strictEqual(mapped.dose, '2 capsules');
assert.strictEqual(mapped.serves, '90');

const mappedFda = context.mapFDADietaryProduct({
  product_name: 'Vitamin D3',
  brand_name: 'Sunshine Corp',
  serving_size: '1 softgel',
  serving_size_unit: '5000 IU',
  servings_per_container: 120
});
assert.strictEqual(mappedFda.brand, 'Sunshine Corp');
assert.ok(mappedFda.dose.toLowerCase().includes('softgel'));
assert.strictEqual(mappedFda.serves, '120');

// Test OFF lookup covers alternate hosts and codes
calls.length = 0;
const productSuccess = {
  product: {
    product_name: 'Magnesium Glycinate',
    brands: 'Health Co',
    serving_size: '2 tablets',
    number_of_servings: 60
  }
};
const targetUrl = 'https://world.openbeautyfacts.org/api/v0/product/0123456789012.json';
context.fetch = async (url) => {
  calls.push(url);
  if (url === targetUrl) {
    return { ok: true, json: async () => productSuccess };
  }
  return { ok: true, json: async () => ({}) };
};

const offResult = await context.fetchProductInfoFromOFF('123456789012');
assert.strictEqual(offResult.name, 'Magnesium Glycinate');
assert.strictEqual(offResult.brand, 'Health Co');
assert.ok(calls.includes(targetUrl), 'Expected lookup to include openbeautyfacts fallback URL');

// Ensure FDA lookup tries fallback URL and maps data
let fdaCall = 0;
context.fetch = async (url) => {
  fdaCall += 1;
  if (fdaCall === 1) {
    return { ok: true, json: async () => ({ results: [] }) };
  }
  return {
    ok: true,
    json: async () => ({ results: [{ product_name: 'Zinc Complex', brand_name: 'Macro Labs', serving_size: '1 capsule', serving_size_unit: '50 mg', servings_per_container: 50 }] })
  };
};

const fdaResult = await context.fetchProductInfoFromFDADietary('000987654321');
assert.strictEqual(fdaResult.name, 'Zinc Complex');
assert.strictEqual(fdaResult.brand, 'Macro Labs');
assert.ok(fdaResult.dose.toLowerCase().includes('capsule'));
assert.strictEqual(fdaResult.serves, '50');
assert.strictEqual(fdaCall, 2, 'Expected FDA lookup to try both fallback URLs');

console.log('barcode lookup tests passed');
