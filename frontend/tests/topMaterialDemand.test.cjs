const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/lib/topMaterialDemand.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
const api = {};
new Function('exports', compiled.outputText)(api);
const { topMaterialDemand } = api;
const row = (changes = {}) => ({
  id: 1, materialId: 126, materialName: 'Block 150mm', specification: 'Block 150mm',
  unit: 'sq.m', estimatedQuantity: 10, estimatedPurchaseQuantity: 100,
  estimatedPurchaseUnit: 'pc', actualQuantity: 90, ...changes,
});

test('combines matching rows before selecting the top five', () => {
  const items = [row(), row({ id: 2 }), ...Array.from({ length: 5 }, (_, i) =>
    row({ id: i + 3, materialId: i + 200, specification: `Other ${i}`, estimatedPurchaseQuantity: 150 }))];
  const result = topMaterialDemand(items, false, new Set());
  assert.equal(result.length, 5);
  assert.equal(result[0].estimated, 200);
  assert.equal(result[0].actual, 180);
});

test('different specifications and units remain separate despite a shared catalog ID', () => {
  const result = topMaterialDemand([row(), row({ specification: 'Block 100mm' }), row({ estimatedPurchaseUnit: 'bag' })], false, new Set());
  assert.equal(result.length, 3);
  assert.ok(result.some(r => r.material === 'Block 100mm'));
});

test('missing actual is not replaced by estimate; partial actual totals stay unavailable', () => {
  assert.equal(topMaterialDemand([row({ actualQuantity: 0 })], false, new Set())[0].actual, undefined);
  assert.equal(topMaterialDemand([row(), row({ id: 2, actualQuantity: 0 })], false, new Set())[0].actual, undefined);
});

test('recorded zero usage stays zero', () => {
  assert.equal(topMaterialDemand([row({ actualQuantity: 0 })], false, new Set([1]))[0].actual, 0);
});

test('historical estimates without purchase quantities use BOQ units', () => {
  const item = row({ estimatedPurchaseQuantity: undefined, estimatedPurchaseUnit: undefined });
  assert.equal(topMaterialDemand([item], false, new Set()).length, 0);
  const result = topMaterialDemand([item], true, new Set())[0];
  assert.equal(result.estimated, 10);
  assert.equal(result.unit, 'sq.m');
});
