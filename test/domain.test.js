import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, normalizeState, addPurchase, saveOrder, availableQuantity, deliverOrder, orderTotal, monthlySummary, paidAmount, recordPayment } from "../domain.js";

const product = { id: "p1", name: "Auriculares", stock: 0, averageCost: 0, price: 1000 };
const order = (id, status, quantity) => ({ id, customerName: "Ana", contact: "@ana", channel: "Instagram", status, deposit: 0, lines: [{ productId: "p1", quantity, unitPrice: 1000 }] });

test("las compras aumentan el stock y actualizan el costo promedio", () => {
  const initial = { ...structuredClone(emptyState), products: [product] };
  const first = addPurchase(initial, { id: "c1", productId: "p1", quantity: 2, unitCost: 600 });
  const second = addPurchase(first, { id: "c2", productId: "p1", quantity: 2, unitCost: 800 });
  assert.equal(second.products[0].stock, 4);
  assert.equal(second.products[0].averageCost, 700);
});

test("una reserva reduce disponible y bloquea otra reserva excesiva", () => {
  const initial = { ...structuredClone(emptyState), products: [{ ...product, stock: 2 }] };
  const reserved = saveOrder(initial, order("o1", "reserved", 2));
  assert.equal(availableQuantity(reserved, "p1"), 0);
  assert.throws(() => saveOrder(reserved, order("o2", "reserved", 1)), /stock/);
});

test("un pedido por encargo se entrega al ingresar stock y crea una sola venta", () => {
  const initial = { ...structuredClone(emptyState), products: [product] };
  const requested = saveOrder(initial, order("o1", "requested", 1));
  assert.throws(() => deliverOrder(requested, "o1", "2026-09-28"), /stock/);
  const stocked = addPurchase(requested, { id: "c1", productId: "p1", quantity: 1, unitCost: 600 });
  const delivered = deliverOrder(stocked, "o1", "2026-09-28");
  assert.equal(delivered.products[0].stock, 0);
  assert.equal(delivered.sales.length, 1);
  assert.deepEqual(monthlySummary(delivered, "2026-09"), { sales: 1, revenue: 1000, shipping: 0, discount: 0, cost: 600 });
  assert.throws(() => deliverOrder(delivered, "o1", "2026-09-28"), /nuevamente/);
});

test("un pedido con dos variantes reserva y descuenta ambas al entregar", () => {
  const initial = { ...structuredClone(emptyState), products: [{ ...product, stock: 2 }, { ...product, id: "p2", variant: "Negro", stock: 1, price: 1500 }] };
  const multi = { ...order("o1", "ready", 1), lines: [{ productId: "p1", quantity: 1, unitPrice: 1000 }, { productId: "p2", quantity: 1, unitPrice: 1500 }] };
  const reserved = saveOrder(initial, multi);
  assert.equal(availableQuantity(reserved, "p1"), 1);
  assert.equal(availableQuantity(reserved, "p2"), 0);
  assert.throws(() => saveOrder(reserved, { ...order("o2", "reserved", 1), lines: [{ productId: "p2", quantity: 1, unitPrice: 1500 }] }), /stock/);
  const delivered = deliverOrder(reserved, "o1", "2026-10-01");
  assert.deepEqual(delivered.products.map(item => item.stock), [1, 0]);
  assert.equal(delivered.sales[0].total, 2500);
  assert.match(delivered.sales[0].lines[1].productName, /Negro/);
});

test("cobros parciales y devoluciones respetan el saldo", () => {
  const initial = saveOrder({ ...structuredClone(emptyState), products: [product] }, order("o1", "inquiry", 1));
  const payment = { id: "pay1", orderId: "o1", kind: "payment", amount: 400, method: "transfer", date: "2026-10-01" };
  const partial = recordPayment(initial, payment);
  assert.equal(paidAmount(partial, "o1"), 400);
  assert.throws(() => recordPayment(partial, { ...payment, id: "pay2", amount: 601 }), /saldo/);
  const completed = recordPayment(partial, { ...payment, id: "pay2", amount: 600 });
  assert.equal(paidAmount(completed, "o1"), 1000);
  const refunded = recordPayment(completed, { ...payment, id: "pay3", kind: "refund", amount: 300 });
  assert.equal(paidAmount(refunded, "o1"), 700);
  assert.throws(() => recordPayment(refunded, { ...payment, id: "pay4", kind: "refund", amount: 701 }), /devolución/);
  assert.throws(() => saveOrder(completed, { ...order("o1", "inquiry", 1), lines: [{ productId: "p1", quantity: 1, unitPrice: 900 }] }), /pagos/);
});

test("un respaldo antiguo conserva la seña y acepta nuevos pagos", () => {
  const old = { ...structuredClone(emptyState), products: [product], orders: [{ ...order("o1", "inquiry", 1), deposit: 200 }] };
  delete old.payments;
  const restored = normalizeState(old);
  assert.deepEqual(restored.payments, []);
  assert.equal(paidAmount(restored, "o1"), 200);
  const paid = recordPayment(restored, { id: "pay1", orderId: "o1", kind: "payment", amount: 300, method: "cash", date: "2026-10-01" });
  assert.equal(paidAmount(paid, "o1"), 500);
});

test("aplica solo el descuento ingresado y conserva importes en la venta", () => {
  const initial = { ...structuredClone(emptyState), products: [{ ...product, stock: 2, averageCost: 600 }] };
  const discounted = { ...order("o1", "reserved", 2), discountType: "percent", discountValue: 10, shippingPayer: "included_in_sale", shippingAmount: 200, warrantyDays: 30 };
  const saved = saveOrder(initial, discounted);
  assert.equal(orderTotal(saved.orders[0]), 2000);
  const delivered = deliverOrder(saved, "o1", "2026-10-01");
  assert.equal(delivered.sales[0].subtotal, 2000);
  assert.equal(delivered.sales[0].discount, 200);
  assert.equal(delivered.sales[0].shippingAmount, 200);
  assert.equal(delivered.sales[0].total, 2000);
  assert.equal(delivered.sales[0].receiptNumber, "A001");
  assert.deepEqual(monthlySummary(delivered, "2026-10"), { sales: 1, revenue: 2000, shipping: 200, discount: 200, cost: 1200 });
  assert.throws(() => saveOrder(initial, { ...discounted, discountValue: 101 }), /descuento/);
});

