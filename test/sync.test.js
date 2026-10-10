import test from "node:test";
import assert from "node:assert/strict";
import { fingerprint, syncDecision, mergeIndependentChanges } from "../sync.js";
import { emptyState } from "../domain.js";

test("fingerprints ignore object key order but detect changed values", async () => {
  assert.equal(await fingerprint({ products: [{ id: "1", stock: 2 }], sales: [] }), await fingerprint({ sales: [], products: [{ stock: 2, id: "1" }] }));
  assert.notEqual(await fingerprint({ stock: 2 }), await fingerprint({ stock: 3 }));
});

test("the remote version loads when only the other PC changed", () => {
  assert.equal(syncDecision({ localHash: "old", remoteHash: "new", acknowledgedHash: "old", hasLocalData: true, hasRemoteData: true }), "use_remote");
});

test("local changes save when the remote version is unchanged", () => {
  assert.equal(syncDecision({ localHash: "new", remoteHash: "old", acknowledgedHash: "old", hasLocalData: true, hasRemoteData: true }), "push_local");
  assert.equal(syncDecision({ localHash: "empty", remoteHash: "old", acknowledgedHash: "old", hasLocalData: false, hasRemoteData: true }), "push_local");
});

test("different edits on both PCs require a choice", () => {
  assert.equal(syncDecision({ localHash: "a", remoteHash: "b", acknowledgedHash: "old", hasLocalData: true, hasRemoteData: true }), "conflict");
  assert.equal(syncDecision({ localHash: "a", remoteHash: "b", acknowledgedHash: "", hasLocalData: true, hasRemoteData: true }), "conflict");
});

test("a new browser with no data downloads the remote version", () => {
  assert.equal(syncDecision({ localHash: "empty", remoteHash: "existing", acknowledgedHash: "", hasLocalData: false, hasRemoteData: true }), "use_remote");
});

const product = (id, name = id) => ({ id, name, variant: "", barcode: id, sku: "", price: 100, minStock: 0, stock: 2, averageCost: 50 });
const order = (id, status = "inquiry", quantity = 1) => ({ id, customerName: id, contact: `@${id}`, channel: "Instagram", status, lines: [{ productId: "p1", quantity, unitPrice: 100 }] });

test("combina ediciones de productos distintos sin perder una", () => {
  const base = { ...structuredClone(emptyState), products: [product("p1"), product("p2")] };
  const local = { ...base, products: [{ ...base.products[0], price: 120 }, base.products[1]] };
  const remote = { ...base, products: [base.products[0], { ...base.products[1], price: 130 }] };
  const merged = mergeIndependentChanges(base, local, remote);
  assert.deepEqual(merged.products.map(item => item.price), [120, 130]);
  assert.equal(base.products[0].price, 100);
});

test("acepta una versión remota que ya contiene los cambios locales", () => {
  const base = { ...structuredClone(emptyState), products: [product("p1")] };
  const local = { ...base, products: [...base.products, product("p2")] };
  const remote = { ...base, products: [...base.products, product("p2"), product("p3")] };
  assert.deepEqual(mergeIndependentChanges(base, local, remote), remote);
});

test("combina pedidos y cobros independientes cuando el saldo sigue válido", () => {
  const base = { ...structuredClone(emptyState), products: [product("p1")], orders: [order("o1")] };
  const local = { ...base, payments: [{ id: "pay1", orderId: "o1", amount: 30, kind: "payment" }] };
  const remote = { ...base, payments: [{ id: "pay2", orderId: "o1", amount: 40, kind: "payment" }] };
  assert.deepEqual(mergeIndependentChanges(base, local, remote).payments.map(item => item.id), ["pay1", "pay2"]);
  assert.equal(mergeIndependentChanges(base, { ...local, payments: [{ ...local.payments[0], amount: 70 }] }, remote), null);
});

test("mantiene conflicto cuando cambian el mismo registro o agotan reservas", () => {
  const base = { ...structuredClone(emptyState), products: [product("p1")] };
  assert.equal(mergeIndependentChanges(base, { ...base, products: [{ ...base.products[0], price: 120 }] }, { ...base, products: [{ ...base.products[0], price: 130 }] }), null);
  const local = { ...base, orders: [order("o1", "reserved", 2)] };
  const remote = { ...base, orders: [order("o2", "reserved", 2)] };
  assert.equal(mergeIndependentChanges(base, local, remote), null);
  assert.equal(mergeIndependentChanges(base, { ...base, products: [] }, { ...base, orders: [order("o3")] }), null);
});

test("rechaza comprobantes y códigos duplicados creados en paralelo", () => {
  const base = { ...structuredClone(emptyState), products: [product("p1")] };
  const local = { ...base, products: [...base.products, product("p2", "Dos")] };
  const remote = { ...base, products: [...base.products, { ...product("p3", "Tres"), barcode: "p2" }] };
  assert.equal(mergeIndependentChanges(base, local, remote), null);
  const sale = (id, orderId) => ({ id, orderId, receiptNumber: "A001", lines: [], total: 100 });
  const left = { ...base, orders: [order("o1", "delivered")], sales: [sale("s1", "o1")] };
  const right = { ...base, orders: [order("o2", "delivered")], sales: [sale("s2", "o2")] };
  assert.equal(mergeIndependentChanges(base, left, right), null);
});

test("combina cargas iniciales de variantes diferentes con sus compras", () => {
  const base = structuredClone(emptyState);
  const local = { ...base, products: [product("p1")], purchases: [{ id: "c1", productId: "p1", quantity: 2, unitCost: 50 }] };
  const remote = { ...base, products: [product("p2")], purchases: [{ id: "c2", productId: "p2", quantity: 2, unitCost: 50 }] };
  const merged = mergeIndependentChanges(base, local, remote);
  assert.deepEqual(merged.products.map(item => item.id), ["p1", "p2"]);
  assert.deepEqual(merged.purchases.map(item => item.id), ["c1", "c2"]);
});

test("pide revisión si una PC cambia un pedido mientras la otra registra su cobro", () => {
  const base = { ...structuredClone(emptyState), products: [product("p1")], orders: [order("o1")] };
  const local = { ...base, orders: [{ ...base.orders[0], status: "cancelled" }] };
  const remote = { ...base, payments: [{ id: "pay1", orderId: "o1", amount: 30, kind: "payment" }] };
  assert.equal(mergeIndependentChanges(base, local, remote), null);
});
