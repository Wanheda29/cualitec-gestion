import { addPurchase } from "./domain.js";

export const catalogCsvHeader = ["producto", "categoria", "variante", "codigo_barras", "sku", "precio", "stock_minimo", "stock_inicial", "costo_unitario"];
export const catalogCsvTemplate = `${catalogCsvHeader.join(";")}\r\nAuriculares inalámbricos;Audio;Negro;;AUR-NEG;1290;2;3;800\r\n`;

function readCsv(text, separator) {
  const rows = []; let row = [], cell = "", quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && !cell) quoted = true;
    else if (char === separator) { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("El CSV tiene comillas sin cerrar.");
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(values => values.some(value => value.trim()));
}

function numberValue(value, label, rowNumber, integer = false, fallback = null) {
  const input = String(value || "").trim();
  if (!input && fallback !== null) return fallback;
  if (!/^\d+(?:[.,]\d+)?$/.test(input)) throw new Error(`Fila ${rowNumber}: ${label} debe ser un número no negativo.`);
  const result = Number(input.replace(",", "."));
  if (!Number.isFinite(result) || (integer && !Number.isInteger(result))) throw new Error(`Fila ${rowNumber}: ${label} debe ser ${integer ? "un entero" : "un número"} no negativo.`);
  return result;
}

export function parseCatalogCsv(text) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] || "";
  const separator = firstLine.includes(";") ? ";" : ",";
  const csv = readCsv(source, separator);
  if (!csv.length) throw new Error("El archivo CSV está vacío.");
  const header = csv.shift().map(value => value.trim().toLowerCase());
  if (header.length !== catalogCsvHeader.length || header.some((value, index) => value !== catalogCsvHeader[index])) throw new Error(`La primera fila debe contener: ${catalogCsvHeader.join("; ")}.`);
  if (!csv.length) throw new Error("El CSV no contiene productos.");
  if (csv.length > 500) throw new Error("Importá hasta 500 variantes por archivo.");
  return csv.map((values, index) => {
    const rowNumber = index + 2;
    if (values.length !== catalogCsvHeader.length) throw new Error(`Fila ${rowNumber}: se esperaban ${catalogCsvHeader.length} columnas y se encontraron ${values.length}.`);
    const [name, category, variant, barcode, sku, price, minStock, stock, unitCost] = values.map(value => value.trim());
    if (!name) throw new Error(`Fila ${rowNumber}: falta el producto.`);
    const parsedStock = numberValue(stock, "stock_inicial", rowNumber, true, 0);
    if (parsedStock && !unitCost) throw new Error(`Fila ${rowNumber}: indicá costo_unitario para el stock inicial.`);
    return { rowNumber, name, category, variant, barcode, sku, price: numberValue(price, "precio", rowNumber), minStock: numberValue(minStock, "stock_minimo", rowNumber, true, 0), stock: parsedStock, unitCost: numberValue(unitCost, "costo_unitario", rowNumber, false, 0) };
  });
}

export function validateCatalogRows(state, rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error("No hay productos para importar.");
  const knownNames = new Set(state.products.map(item => `${item.name.trim().toLowerCase()}\u0000${String(item.variant || "").trim().toLowerCase()}`));
  const knownCodes = new Set(state.products.flatMap(item => [item.barcode, item.sku]).filter(Boolean).map(value => String(value).trim().toLowerCase()));
  for (const row of rows) {
    const key = `${row.name.trim().toLowerCase()}\u0000${row.variant.trim().toLowerCase()}`;
    if (knownNames.has(key)) throw new Error(`Fila ${row.rowNumber}: ese producto y variante ya existen.`);
    knownNames.add(key);
    const codes = new Set([row.barcode, row.sku].filter(Boolean).map(code => code.trim().toLowerCase()));
    for (const code of codes) {
      if (knownCodes.has(code)) throw new Error(`Fila ${row.rowNumber}: el código ${code} ya está asignado.`);
      knownCodes.add(code);
    }
  }
  return rows;
}

export function importCatalogRows(state, rows, date) {
  validateCatalogRows(state, rows);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) throw new Error("La fecha de importación no es válida.");
  let next = state;
  for (const row of rows) {
    const product = { id: `product_${crypto.randomUUID()}`, name: row.name, category: row.category, variant: row.variant, barcode: row.barcode, sku: row.sku, price: row.price, minStock: row.minStock, stock: 0, averageCost: 0 };
    next = { ...next, products: [...next.products, product] };
    if (row.stock) next = addPurchase(next, { id: `purchase_${crypto.randomUUID()}`, productId: product.id, quantity: row.stock, unitCost: row.unitCost, date, supplier: "Carga inicial CSV" });
  }
  return next;
}
