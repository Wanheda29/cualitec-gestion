import test from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "../domain.js";
import { catalogCsvHeader, parseCatalogCsv, validateCatalogRows, importCatalogRows } from "../catalog-import.js";

const header = catalogCsvHeader.join(";");

test("el CSV acepta comillas y decimales locales y registra stock inicial con historial", () => {
  const rows = parseCatalogCsv(`\uFEFF${header}\r\n"Auriculares; inalámbricos";Audio;Negro;123;A-NEG;1290,50;2;3;800,25\r\nCargador;Accesorios;;456;;490;0;0;\r\n`);
  const initial = structuredClone(emptyState);
  const next = importCatalogRows(initial, rows, "2026-10-10");
  assert.equal(next.products.length, 2);
  assert.equal(next.products[0].name, "Auriculares; inalámbricos");
  assert.equal(next.products[0].price, 1290.5);
  assert.equal(next.products[0].stock, 3);
  assert.equal(next.products[0].averageCost, 800.25);
  assert.equal(next.products[1].stock, 0);
  assert.equal(next.purchases.length, 1);
  assert.equal(next.purchases[0].supplier, "Carga inicial CSV");
  assert.equal(initial.products.length, 0);
});

test("el importador rechaza errores de columnas, cantidades y duplicados sin alterar el catálogo", () => {
  assert.throws(() => parseCatalogCsv(`${header}\nProducto;Audio;Negro;;;;;1;500`), /precio/);
  assert.throws(() => parseCatalogCsv(`${header}\nProducto;Audio;Negro;;SKU;100;0;2;`), /costo_unitario/);
  assert.throws(() => parseCatalogCsv(`${header}\nProducto;Audio;Negro;;SKU;100;0;1,5;50`), /stock_inicial/);
  const rows = parseCatalogCsv(`${header}\nProducto;Audio;Negro;123;SKU;100;0;1;50`);
  const initial = { ...structuredClone(emptyState), products: [{ id: "existing", name: "Otro", variant: "", barcode: "123", sku: "", stock: 0 }] };
  assert.throws(() => validateCatalogRows(initial, rows), /código/);
  assert.equal(initial.products.length, 1);
  assert.equal(initial.purchases.length, 0);
  assert.throws(() => validateCatalogRows(structuredClone(emptyState), [...rows, { ...rows[0], rowNumber: 3 }]), /variante/);
});

test("admite CSV separado por comas cuando los decimales usan punto", () => {
  const rows = parseCatalogCsv(`${catalogCsvHeader.join(",")}\nProducto,Audio,Azul,123,,100.50,1,0,`);
  assert.equal(rows[0].price, 100.5);
});

test("un producto puede compartir su propio SKU y código de barras", () => {
  const rows = parseCatalogCsv(`${header}\nProducto;Audio;Azul;123;123;100;0;0;`);
  assert.doesNotThrow(() => validateCatalogRows(structuredClone(emptyState), rows));
});
