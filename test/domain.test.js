import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, normalizeState, findProductByCode, addPurchase, adjustStock, saveOrder, availableQuantity, deliverOrder, orderTotal, monthlySummary, paidAmount, recordPayment, stockMovements, paymentMovements } from "../domain.js";
import { salesReportCsv, paymentReportCsv, salesVisualSummary } from "../reports.js";
import { dailyPending } from "../domain.js";

const product = { id: "p1", name: "Auriculares", stock: 0, averageCost: 0, price: 1000 };
const order = (id, status, quantity) => ({ id, customerName: "Ana", contact: "@ana", channel: "Instagram", status, deposit: 0, lines: [{ productId: "p1", quantity, unitPrice: 1000 }] });

test("los pendientes separan entregas y saldos sin incluir cancelados ni ventas pagadas", () => {
  const state = { ...structuredClone(emptyState), products: [product], orders: [
    { ...order("today", "reserved", 1), deliveryDate: "2026-10-01" },
    { ...order("late", "ready", 1), deliveryDate: "2026-09-30" },
    { ...order("future", "inquiry", 1), deliveryDate: "2026-10-02" },
    order("no-date", "inquiry", 1),
    { ...order("cancelled", "cancelled", 1), deliveryDate: "2026-09-29" },
    { ...order("debt", "delivered", 1), deliveryDate: "2026-09-28", deposit: 200 },
    { ...order("paid", "delivered", 1), deposit: 200 }
  ], payments: [{ id: "payment", orderId: "paid", kind: "payment", amount: 800 }] };
  const pending = dailyPending(state, "2026-10-01");
  assert.deepEqual(pending.today.map(item => item.id), ["today"]);
  assert.deepEqual(pending.overdue.map(item => item.id), ["late"]);
  assert.deepEqual(pending.unpaid.map(item => item.id), ["debt"]);
  assert.deepEqual(dailyPending(state, "2026-10-02").overdue.map(item => item.id), ["late", "today"]);
});

test("los encargos necesitan stock disponible para todas las variantes y respetan reservas", () => {
  const state = { ...structuredClone(emptyState), products: [{ ...product, stock: 3 }, { ...product, id: "p2", stock: 0 }], orders: [
    order("reservation", "reserved", 2),
    order("enough", "requested", 1),
    order("too-many", "requested", 2),
    { ...order("multiple", "requested", 1), lines: [{ productId: "p1", quantity: 1, unitPrice: 1000 }, { productId: "p2", quantity: 1, unitPrice: 500 }] },
    { ...order("missing", "requested", 1), lines: [{ productId: "deleted", quantity: 1, unitPrice: 500 }] },
    { ...order("empty", "requested", 1), lines: [] }
  ] };
  assert.deepEqual(dailyPending(state, "2026-10-01").stocked.map(item => item.id), ["enough"]);
  const received = addPurchase(state, { id: "purchase", productId: "p2", quantity: 1, unitCost: 100 });
  assert.deepEqual(dailyPending(received, "2026-10-01").stocked.map(item => item.id), ["enough", "multiple"]);
  assert.equal(state.products[1].stock, 0);
});

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

test("el CSV de ventas respeta el filtro recibido y protege los datos de clientes", () => {
  const base = { ...structuredClone(emptyState), products: [{ ...product, stock: 1, averageCost: 600 }] };
  const saved = saveOrder(base, { ...order("o1", "reserved", 1), customerName: '=SUM(1;2)', discountType: "amount", discountValue: 100 });
  const delivered = deliverOrder(saved, "o1", "2026-10-01");
  const csv = salesReportCsv(delivered, delivered.sales);
  assert.match(csv, /"'=?SUM\(1;2\)"/);
  assert.match(csv, /"900,00"/);
  assert.match(csv, /"300,00"/);
  assert.equal(salesReportCsv(delivered, []).trim().split("\n").length, 1);
});

test("encuentra una variante por código de barras o SKU", () => {
  const products = [{ ...product, barcode: "001234", sku: "AUR-01" }];
  assert.equal(findProductByCode(products, "001234")?.id, "p1");
  assert.equal(findProductByCode(products, " aur-01 ")?.id, "p1");
  assert.equal(findProductByCode(products, "1234"), undefined);
});

test("el historial de stock reúne entradas, ajustes y salidas por venta", () => {
  const initial = { ...structuredClone(emptyState), products: [product] };
  const purchased = addPurchase(initial, { id: "c1", productId: "p1", date: "2026-09-29", quantity: 3, unitCost: 600, supplier: "Proveedor" });
  const adjusted = adjustStock(purchased, { id: "a1", productId: "p1", date: "2026-09-30T12:00:00.000Z", newStock: 2, reason: "Recuento" });
  const saved = saveOrder(adjusted, order("o1", "reserved", 1));
  const delivered = deliverOrder(saved, "o1", "2026-10-01");
  assert.deepEqual(stockMovements(delivered).map(item => [item.type, item.quantity, item.date]), [["Venta", -1, "2026-10-01"], ["Ajuste", -1, "2026-09-30"], ["Compra", 3, "2026-09-29"]]);
  assert.equal(delivered.products[0].stock, 1);
  assert.match(stockMovements(delivered)[1].detail, /Recuento/);
});

test("el informe de cobros separa fechas, devoluciones y señas antiguas", () => {
  const base = { ...structuredClone(emptyState), products: [product] };
  const saved = saveOrder(base, { ...order("o1", "inquiry", 1), customerName: "=Ana", deposit: 100 });
  const paid = recordPayment(saved, { id: "pay1", orderId: "o1", kind: "payment", amount: 400, method: "transfer", date: "2026-09-30", note: "Seña" });
  const refunded = recordPayment(paid, { id: "pay2", orderId: "o1", kind: "refund", amount: 50, method: "cash", date: "2026-10-01", note: "Ajuste" });
  const movements = paymentMovements(refunded);
  assert.deepEqual(movements.map(item => [item.date, item.method, item.amount]), [["2026-10-01", "cash", -50], ["2026-09-30", "transfer", 400], ["", "legacy", 100]]);
  const october = movements.filter(item => item.date >= "2026-10-01");
  assert.equal(october.reduce((sum, item) => sum + item.amount, 0), -50);
  const csv = paymentReportCsv(movements);
  assert.match(csv, /"'=Ana"/);
  assert.match(csv, /"-50,00"/);
  assert.match(csv, /"Sin medio registrado"/);
});

test("los gráficos usan solo las ventas filtradas y suman por mes y canal", () => {
  const sales = [
    { date: "2026-08-04", channel: "Instagram", total: 100 },
    { date: "2026-09-12", channel: "WhatsApp", total: 200 },
    { date: "2026-09-18", channel: "Instagram", total: 50 },
    { date: "2026-10-01", channel: "Instagram", total: 300 }
  ];
  const selected = sales.filter(sale => sale.date >= "2026-09-01" && sale.date <= "2026-09-30");
  const summary = salesVisualSummary(selected);
  assert.deepEqual(summary.months, [{ key: "2026-09", total: 250, count: 2 }]);
  assert.deepEqual(summary.channels, [{ key: "WhatsApp", total: 200, count: 1 }, { key: "Instagram", total: 50, count: 1 }]);
  assert.equal(salesVisualSummary([]).months.length, 0);
  assert.deepEqual(salesVisualSummary(Array.from({ length: 7 }, (_, index) => ({ date: `2026-${String(index + 1).padStart(2, "0")}-01`, channel: "Instagram", total: 10 }))).months.map(item => item.key), ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"]);
});

