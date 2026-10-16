import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, normalizeState, recordQuickSale, monthlySummary, paidAmount, recordPayment, orderTotal, saveOrder } from "../domain.js";
import { editSale, deleteSale, restoreSale } from "../sales-management.js";
import { salesReportCsv } from "../reports.js";
import { mergeIndependentChanges } from "../sync.js";

const initial = () => ({ ...structuredClone(emptyState), products: [
  { id: "p1", name: "Ventilador", stock: 5, averageCost: 1300, price: 1790 },
  { id: "p2", name: "Otro", stock: 3, averageCost: 500, price: 1000 }
] });
const sold = (amount = 0) => recordQuickSale(initial(), { order: { id: "o1", customerName: "Ana", contact: "@ana", channel: "Instagram", lines: [{ productId: "p1", quantity: 1, unitPrice: 1790 }] }, saleDate: "2026-10-16", paymentAmount: amount });
const input = state => structuredClone(state.sales[0]);

test("editar costo y descuento actualiza ganancias, pedido y CSV sin tocar stock ni costo de catálogo", () => {
  const state = sold(), sale = input(state);
  const next = editSale(state, sale.id, { ...sale, customerName: "Ana corregida", lines: [{ ...sale.lines[0], unitCost: 1200 }], discountType: "amount", discountValue: 90 });
  assert.equal(next.sales[0].total, 1700);
  assert.equal(next.sales[0].id, sale.id);
  assert.equal(next.sales[0].receiptNumber, sale.receiptNumber);
  assert.equal(orderTotal(next.orders[0]), 1700);
  assert.equal(next.orders[0].customerName, "Ana corregida");
  assert.equal(next.products[0].stock, 4);
  assert.equal(next.products[0].averageCost, 1300);
  assert.equal(monthlySummary(next, "2026-10").cost, 1200);
  assert.match(salesReportCsv(next, next.sales), /"500,00"/);
  assert.equal(state.sales[0].total, 1790);
});

test("editar cantidades y productos ajusta stock por diferencia y respeta reservas", () => {
  const state = sold(), sale = input(state);
  const next = editSale(state, sale.id, { ...sale, lines: [{ productId: "p2", quantity: 2, unitPrice: 1100, unitCost: 600 }], shippingPayer: "merchant_paid", shippingCost: 150 });
  assert.deepEqual(next.products.map(item => item.stock), [5, 1]);
  assert.equal(next.sales[0].total, 2200);
  assert.equal(next.sales[0].shippingCost, 150);
  assert.equal(next.sales[0].lines[0].productName, "Otro");
  const reserved = saveOrder(state, { id: "reservation", customerName: "Otro", contact: "@otro", status: "reserved", lines: [{ productId: "p2", quantity: 3, unitPrice: 1000 }] });
  assert.throws(() => editSale(reserved, sale.id, { ...sale, lines: next.sales[0].lines }), /stock/);
  assert.throws(() => editSale(state, sale.id, { ...sale, lines: [{ ...sale.lines[0], quantity: 6 }] }), /stock/);
});

test("conserva cobros y rechaza totales menores a lo cobrado e importes inválidos", () => {
  const state = sold(1700), sale = input(state);
  assert.throws(() => editSale(state, sale.id, { ...sale, discountType: "amount", discountValue: 100 }), /pagos/i);
  const next = editSale(state, sale.id, { ...sale, lines: [{ ...sale.lines[0], unitPrice: 1900 }] });
  assert.equal(paidAmount(next, sale.orderId), 1700);
  assert.equal(orderTotal(next.orders[0]) - paidAmount(next, sale.orderId), 200);
  assert.deepEqual(next.payments, state.payments);
  for (const unitCost of [-1, NaN, Infinity]) assert.throws(() => editSale(state, sale.id, { ...sale, lines: [{ ...sale.lines[0], unitCost }] }), /costo/);
  assert.throws(() => editSale(state, sale.id, { ...sale, date: "2026-02-30" }), /fecha/);
  assert.throws(() => editSale(state, sale.id, { ...sale, lines: [sale.lines[0], sale.lines[0]] }), /variante/);
});

test("eliminar y recuperar conserva identidad, devuelve stock y no reutiliza comprobantes", () => {
  const state = sold(), sale = input(state), deleted = deleteSale(state, sale.id);
  assert.equal(deleted.sales.length, 0);
  assert.equal(deleted.products[0].stock, 5);
  assert.equal(deleted.orders[0].status, "cancelled");
  assert.equal(monthlySummary(deleted, "2026-10").revenue, 0);
  const backup = normalizeState(JSON.parse(JSON.stringify(deleted)));
  const recovered = restoreSale(backup, sale.id);
  assert.deepEqual(recovered.sales[0], sale);
  assert.equal(recovered.products[0].stock, 4);
  assert.equal(recovered.orders[0].status, "delivered");
  assert.equal(recovered.deletedSales.length, 0);
  const newer = recordQuickSale(deleted, { order: { id: "o2", customerName: "B", contact: "@b", lines: [{ productId: "p1", quantity: 1, unitPrice: 1790 }] }, saleDate: "2026-10-16" });
  assert.equal(newer.sales[0].receiptNumber, "A002");
  assert.throws(() => deleteSale(deleted, sale.id), /encontró/);
  assert.throws(() => restoreSale(recovered, sale.id), /recuperar/);
});

test("eliminar exige devolver cobros y conserva los movimientos reales de dinero", () => {
  const state = sold(1790), sale = input(state);
  assert.throws(() => deleteSale(state, sale.id), /devolución/);
  const refunded = recordPayment(state, { id: "refund", orderId: sale.orderId, kind: "refund", amount: 1790, method: "transfer", date: "2026-10-16" });
  const deleted = deleteSale(refunded, sale.id);
  assert.deepEqual(deleted.payments, refunded.payments);
  assert.equal(paidAmount(deleted, sale.orderId), 0);
});

test("protege casos de posventa y no recupera sin stock ni sobre pedidos cambiados", () => {
  const state = sold(), sale = input(state);
  const withCase = { ...state, serviceCases: [{ id: "case", saleId: sale.id, productId: "p1", openedAt: "2026-10-17" }] };
  assert.throws(() => deleteSale(withCase, sale.id), /posventa/);
  assert.throws(() => editSale(withCase, sale.id, { ...sale, date: "2026-10-18" }), /posventa/);
  assert.throws(() => editSale(withCase, sale.id, { ...sale, lines: [{ productId: "p2", quantity: 1, unitPrice: 1000, unitCost: 500 }] }), /posventa/);
  const deleted = deleteSale(state, sale.id);
  assert.throws(() => restoreSale({ ...deleted, products: deleted.products.map(item => ({ ...item, stock: 0 })) }, sale.id), /stock/);
  assert.throws(() => restoreSale({ ...deleted, orders: [{ ...deleted.orders[0], notes: "Cambio" }] }, sale.id), /pedido cambió/);
});

test("la sincronización detecta ediciones concurrentes de la misma venta", () => {
  const state = sold(), sale = input(state);
  const local = editSale(state, sale.id, { ...sale, lines: [{ ...sale.lines[0], unitCost: 1100 }] });
  const remote = editSale(state, sale.id, { ...sale, lines: [{ ...sale.lines[0], unitCost: 1200 }] });
  assert.equal(mergeIndependentChanges(state, local, remote), null);
  assert.equal(mergeIndependentChanges(state, deleteSale(state, sale.id), remote), null);
});
