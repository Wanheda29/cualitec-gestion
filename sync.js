import { orderTotal } from "./domain.js";

export const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

export async function fingerprint(value) {
  const bytes = new TextEncoder().encode(canonical(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export function syncDecision({ localHash, remoteHash, acknowledgedHash, hasLocalData, hasRemoteData }) {
  if (!hasRemoteData && !hasLocalData) return "equal";
  if (hasRemoteData && localHash === remoteHash) return "equal";
  if (!hasRemoteData) return "push_local";
  if (acknowledgedHash && localHash === acknowledgedHash) return "use_remote";
  if (acknowledgedHash && remoteHash === acknowledgedHash) return "push_local";
  if (!acknowledgedHash && !hasLocalData) return "use_remote";
  return "conflict";
}

export function mergeIndependentChanges(base, local, remote) {
  if (crossesOrderPayments(base, local, remote) || crossesOrderPayments(base, remote, local)) return null;
  const merged = {};
  for (const key of Object.keys(base)) {
    const original = base[key], here = local[key], there = remote[key];
    if (![original, here, there].every(Array.isArray)) return null;
    const before = new Map(original.map(item => [item.id, item]));
    const localRows = new Map(here.map(item => [item.id, item]));
    const remoteRows = new Map(there.map(item => [item.id, item]));
    if ([before, localRows, remoteRows].some((map, index) => map.size !== [original, here, there][index].length)) return null;
    const ids = [...new Set([...original, ...here, ...there].map(item => item.id))];
    const combined = [];
    for (const id of ids) {
      const old = before.get(id), left = localRows.get(id), right = remoteRows.get(id);
      if (old && (!left || !right)) return null; // Una restauración o eliminación necesita revisión manual.
      const leftChanged = canonical(left) !== canonical(old), rightChanged = canonical(right) !== canonical(old);
      if (leftChanged && rightChanged && canonical(left) !== canonical(right)) return null;
      combined.push(leftChanged ? left : rightChanged ? right : old);
    }
    merged[key] = combined;
  }
  if (!safeBusinessState(merged)) return null;
  return merged;
}

function crossesOrderPayments(base, orderSide, paymentSide) {
  const oldOrders = new Map(base.orders.map(item => [item.id, item]));
  const oldPayments = new Map(base.payments.map(item => [item.id, item]));
  const changedOrders = new Set(orderSide.orders.filter(item => canonical(item) !== canonical(oldOrders.get(item.id))).map(item => item.id));
  return paymentSide.payments.some(item => changedOrders.has(item.orderId) && canonical(item) !== canonical(oldPayments.get(item.id)));
}

function safeBusinessState(state) {
  const products = new Map(); const codes = new Set(), variants = new Set();
  for (const product of state.products) {
    const stock = Number(product.stock || 0);
    if (!Number.isInteger(stock) || stock < 0) return false;
    const variant = `${String(product.name || "").trim().toLowerCase()}\u0000${String(product.variant || "").trim().toLowerCase()}`;
    if (variants.has(variant)) return false;
    variants.add(variant);
    const ownCodes = new Set([product.barcode, product.sku].filter(Boolean).map(value => String(value).trim().toLowerCase()));
    for (const code of ownCodes) { if (codes.has(code)) return false; codes.add(code); }
    products.set(product.id, product);
  }
  const reserved = new Map(); const receipts = new Set(), soldOrders = new Set();
  for (const order of state.orders) {
    if (["reserved", "ready"].includes(order.status)) for (const line of order.lines || []) {
      if (!products.has(line.productId) || !Number.isInteger(Number(line.quantity)) || Number(line.quantity) <= 0) return false;
      reserved.set(line.productId, (reserved.get(line.productId) || 0) + Number(line.quantity));
    }
  }
  for (const [productId, quantity] of reserved) if (quantity > Number(products.get(productId).stock)) return false;
  for (const sale of state.sales) {
    if (receipts.has(sale.receiptNumber) || soldOrders.has(sale.orderId)) return false;
    receipts.add(sale.receiptNumber); soldOrders.add(sale.orderId);
  }
  const orders = new Map(state.orders.map(item => [item.id, item]));
  const paid = new Map(state.orders.map(item => [item.id, Number(item.deposit || 0)]));
  for (const payment of state.payments) {
    if (!orders.has(payment.orderId)) return false;
    paid.set(payment.orderId, paid.get(payment.orderId) + (payment.kind === "refund" ? -Number(payment.amount) : Number(payment.amount)));
  }
  for (const [orderId, amount] of paid) {
    const order = orders.get(orderId);
    const total = orderTotal(order);
    if (!Number.isFinite(amount) || amount < -0.001 || amount > total + 0.001) return false;
  }
  return true;
}
