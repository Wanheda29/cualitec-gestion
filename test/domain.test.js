import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, addPurchase, saveOrder, availableQuantity, deliverOrder, monthlySummary } from "../domain.js";

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
  assert.deepEqual(monthlySummary(delivered, "2026-09"), { sales: 1, revenue: 1000, cost: 600 });
  assert.throws(() => deliverOrder(delivered, "o1", "2026-09-28"), /nuevamente/);
});

