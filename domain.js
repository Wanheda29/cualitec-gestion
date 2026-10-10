export const emptyState = { products: [], purchases: [], orders: [], sales: [], stockAdjustments: [], payments: [], serviceCases: [] };
export const orderStatuses = { inquiry: "Consulta", reserved: "Reservado", requested: "Por encargo", ready: "Listo para entregar", delivered: "Entregado", cancelled: "Cancelado" };
export const paymentMethods = { transfer: "Transferencia", cash: "Efectivo", card: "Tarjeta", mercadopago: "Mercado Pago", other: "Otro" };
export const discountTypes = { none: "Sin descuento", amount: "Importe fijo", percent: "Porcentaje" };
const moneyRound = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export function normalizeState(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Los datos no son válidos.");
  const result = structuredClone(emptyState);
  for (const key of Object.keys(result)) {
    if (input[key] === undefined) continue;
    if (!Array.isArray(input[key]) || input[key].some(item => !item || typeof item.id !== "string")) throw new Error(`La sección ${key} no es válida.`);
    if (new Set(input[key].map(item => item.id)).size !== input[key].length) throw new Error(`La sección ${key} tiene registros repetidos.`);
    result[key] = input[key];
  }
  return result;
}

export function reservedQuantity(state, productId, exceptOrderId = null) {
  return state.orders.filter(order => order.id !== exceptOrderId && ["reserved", "ready"].includes(order.status))
    .flatMap(order => order.lines || []).filter(line => line.productId === productId)
    .reduce((sum, line) => sum + Number(line.quantity), 0);
}

export function availableQuantity(state, productId, exceptOrderId = null) {
  const product = state.products.find(item => item.id === productId);
  return Number(product?.stock || 0) - reservedQuantity(state, productId, exceptOrderId);
}

export function dailyPending(state, today) {
  const active = state.orders.filter(order => !["delivered", "cancelled"].includes(order.status));
  const byDate = (a, b) => (a.deliveryDate || "").localeCompare(b.deliveryDate || "") || (a.createdAt || "").localeCompare(b.createdAt || "");
  return {
    today: active.filter(order => order.deliveryDate === today).sort(byDate),
    overdue: active.filter(order => order.deliveryDate && order.deliveryDate < today).sort(byDate),
    unpaid: state.orders.filter(order => order.status === "delivered" && Math.round((orderTotal(order) - paidAmount(state, order.id)) * 100) > 0).sort(byDate),
    stocked: active.filter(order => order.status === "requested" && order.lines?.length && order.lines.every(line => state.products.some(product => product.id === line.productId) && Number(line.quantity) > 0 && availableQuantity(state, line.productId) >= Number(line.quantity))).sort(byDate)
  };
}

export function findProductByCode(products, code) {
  const needle = String(code || "").trim().toLowerCase();
  return needle ? products.find(item => [item.barcode, item.sku].some(value => String(value || "").trim().toLowerCase() === needle)) : undefined;
}

export function addPurchase(state, purchase) {
  const product = state.products.find(item => item.id === purchase.productId);
  const quantity = Number(purchase.quantity), unitCost = Number(purchase.unitCost);
  if (!product || !Number.isInteger(quantity) || quantity <= 0 || !Number.isFinite(unitCost) || unitCost < 0) throw new Error("La compra necesita un producto, cantidad y costo válidos.");
  if (state.purchases.some(item => item.id === purchase.id)) throw new Error("La compra ya existe.");
  const stock = Number(product.stock || 0), oldCost = Number(product.averageCost || 0);
  return { ...state, products: state.products.map(item => item.id === product.id ? { ...item, stock: stock + quantity, averageCost: (stock * oldCost + quantity * unitCost) / (stock + quantity) } : item), purchases: [...state.purchases, { ...purchase, quantity, unitCost }] };
}

export function adjustStock(state, adjustment) {
  const product = state.products.find(item => item.id === adjustment.productId);
  const next = Number(adjustment.newStock);
  if (!product || !Number.isInteger(next) || next < 0 || next < reservedQuantity(state, product.id)) throw new Error("La cantidad no puede quedar por debajo de las unidades reservadas.");
  if (!String(adjustment.reason || "").trim()) throw new Error("Indicá el motivo del ajuste.");
  return { ...state, products: state.products.map(item => item.id === product.id ? { ...item, stock: next } : item), stockAdjustments: [...state.stockAdjustments, { ...adjustment, previousStock: Number(product.stock || 0), newStock: next }] };
}

export function saveOrder(state, order) {
  if (!String(order.customerName || "").trim() || !String(order.contact || "").trim()) throw new Error("Indicá cliente y contacto.");
  if (!Array.isArray(order.lines) || !order.lines.length) throw new Error("Agregá al menos un producto.");
  const productIds = new Set();
  for (const line of order.lines) {
    if (!state.products.some(item => item.id === line.productId) || !Number.isInteger(Number(line.quantity)) || Number(line.quantity) <= 0 || !Number.isFinite(Number(line.unitPrice)) || Number(line.unitPrice) < 0) throw new Error("Revisá el producto, la cantidad y el precio.");
    if (productIds.has(line.productId)) throw new Error("Agregá cada variante una sola vez y ajustá la cantidad.");
    productIds.add(line.productId);
    if (["reserved", "ready"].includes(order.status) && Number(line.quantity) > availableQuantity(state, line.productId, order.id)) throw new Error("No hay stock disponible para reservar esa cantidad.");
  }
  if (!Object.hasOwn(orderStatuses, order.status)) throw new Error("El estado del pedido no es válido.");
  const discountType = order.discountType || "none", discountValue = Number(order.discountValue || 0), shippingAmount = Number(order.shippingAmount || 0);
  if (!Object.hasOwn(discountTypes, discountType) || !Number.isFinite(discountValue) || discountValue < 0 || (discountType === "percent" && discountValue > 100) || (discountType === "amount" && discountValue > orderSubtotal(order)) || (discountType === "none" && discountValue !== 0)) throw new Error("Revisá el descuento manual.");
  if (!Number.isFinite(shippingAmount) || shippingAmount < 0 || (order.shippingPayer !== "included_in_sale" && shippingAmount !== 0)) throw new Error("Revisá el cargo de envío.");
  if (!Number.isInteger(Number(order.warrantyDays ?? 30)) || Number(order.warrantyDays ?? 30) < 0) throw new Error("Revisá los días de garantía.");
  const previous = state.orders.find(item => item.id === order.id);
  const paid = paidAmount(state, order.id) - Number(previous?.deposit || 0) + Number(order.deposit || 0);
  if (!Number.isFinite(paid) || paid < 0 || paid > orderTotal(order)) throw new Error("Los pagos superan el total del pedido.");
  return { ...state, orders: previous ? state.orders.map(item => item.id === order.id ? order : item) : [...state.orders, order] };
}

export function orderSubtotal(order) { return moneyRound((order.lines || []).reduce((sum, line) => sum + Number(line.quantity) * Number(line.unitPrice), 0)); }
export function discountAmount(order) {
  const value = Number(order.discountValue || 0), subtotal = orderSubtotal(order);
  return moneyRound(order.discountType === "percent" ? subtotal * value / 100 : order.discountType === "amount" ? value : 0);
}
export function orderTotal(order) { return moneyRound(orderSubtotal(order) - discountAmount(order) + (order.shippingPayer === "included_in_sale" ? Number(order.shippingAmount || 0) : 0)); }

export function paidAmount(state, orderId) {
  const order = state.orders.find(item => item.id === orderId);
  return Number(order?.deposit || 0) + (state.payments || []).filter(item => item.orderId === orderId).reduce((sum, item) => sum + (item.kind === "refund" ? -Number(item.amount) : Number(item.amount)), 0);
}

export function recordPayment(state, payment) {
  const order = state.orders.find(item => item.id === payment.orderId);
  const amount = Number(payment.amount);
  if (!order || !Number.isFinite(amount) || amount <= 0 || !Object.hasOwn(paymentMethods, payment.method) || !["payment", "refund"].includes(payment.kind) || !/^\d{4}-\d{2}-\d{2}$/.test(payment.date || "")) throw new Error("Revisá pedido, fecha, importe y medio de pago.");
  if ((state.payments || []).some(item => item.id === payment.id)) throw new Error("Ese movimiento ya existe.");
  const paid = paidAmount(state, order.id);
  if (payment.kind === "payment" && (order.status === "cancelled" || amount > orderTotal(order) - paid)) throw new Error("El pago supera el saldo del pedido o el pedido está cancelado.");
  if (payment.kind === "refund" && amount > paid) throw new Error("La devolución supera lo cobrado.");
  return { ...state, payments: [...(state.payments || []), { ...payment, amount }] };
}

export function deliverOrder(state, orderId, date) {
  const order = state.orders.find(item => item.id === orderId);
  if (!order || order.status === "cancelled" || order.status === "delivered" || state.sales.some(sale => sale.orderId === orderId)) throw new Error("Este pedido no se puede entregar nuevamente.");
  const products = state.products.map(item => ({ ...item }));
  const saleLines = [];
  for (const line of order.lines) {
    const product = products.find(item => item.id === line.productId);
    if (!product || Number(product.stock) < Number(line.quantity) || (!["reserved", "ready"].includes(order.status) && availableQuantity(state, line.productId) < Number(line.quantity))) throw new Error("No hay stock suficiente para entregar el pedido.");
    saleLines.push({ ...line, productName: `${product.name}${product.variant ? ` · ${product.variant}` : ""}`, unitCost: Number(product.averageCost || 0) });
    product.stock -= Number(line.quantity);
  }
  const nextNumber = Math.max(state.sales.length, ...state.sales.map(item => Number(item.receiptNumber?.match(/\d+$/)?.[0] || 0))) + 1;
  const sale = { id: `sale_${crypto.randomUUID()}`, receiptNumber: `A${String(nextNumber).padStart(3, "0")}`, orderId, customerName: order.customerName, contact: order.contact, channel: order.channel, date, lines: saleLines, subtotal: orderSubtotal(order), discountType: order.discountType || "none", discountValue: Number(order.discountValue || 0), discount: discountAmount(order), shippingAmount: order.shippingPayer === "included_in_sale" ? Number(order.shippingAmount || 0) : 0, warrantyDays: Number(order.warrantyDays ?? 30), total: orderTotal(order) };
  return { ...state, products, orders: state.orders.map(item => item.id === orderId ? { ...item, status: "delivered", deliveredAt: date } : item), sales: [...state.sales, sale] };
}

export function recordQuickSale(state, { order, saleDate, paymentAmount = 0, paymentMethod = "transfer" }) {
  if (!order?.id || state.orders.some(item => item.id === order.id)) throw new Error("La venta rápida necesita un identificador nuevo.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(saleDate || "")) throw new Error("Revisá la fecha de venta.");
  const amount = Number(paymentAmount);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Revisá el importe cobrado.");
  const saved = saveOrder(state, { ...order, status: "inquiry", deposit: 0 });
  const delivered = deliverOrder(saved, order.id, saleDate);
  if (!amount) return delivered;
  return recordPayment(delivered, { id: `payment_${crypto.randomUUID()}`, orderId: order.id, kind: "payment", amount, method: paymentMethod, date: saleDate, note: "Cobro de venta rápida" });
}

export function monthlySummary(state, month) {
  return state.sales.filter(sale => sale.date.startsWith(month)).reduce((summary, sale) => {
    summary.sales += 1; summary.revenue += Number(sale.total);
    summary.shipping += Number(sale.shippingAmount || 0);
    summary.discount += Number(sale.discount || 0);
    summary.cost += sale.lines.reduce((sum, line) => sum + Number(line.quantity) * Number(line.unitCost), 0);
    return summary;
  }, { sales: 0, revenue: 0, shipping: 0, discount: 0, cost: 0 });
}

export function stockMovements(state) {
  const names = new Map(state.products.map(item => [item.id, `${item.name}${item.variant ? ` · ${item.variant}` : ""}`]));
  const movements = [];
  for (const purchase of state.purchases) movements.push({ id: purchase.id, date: purchase.date?.slice(0, 10) || "", productId: purchase.productId, productName: names.get(purchase.productId) || "Producto eliminado", type: "Compra", detail: purchase.supplier ? `Proveedor: ${purchase.supplier}` : "Entrada de mercadería", quantity: Number(purchase.quantity) });
  for (const adjustment of state.stockAdjustments) movements.push({ id: adjustment.id, date: adjustment.date?.slice(0, 10) || "", productId: adjustment.productId, productName: names.get(adjustment.productId) || "Producto eliminado", type: "Ajuste", detail: adjustment.reason || "Recuento de inventario", quantity: Number(adjustment.newStock) - Number(adjustment.previousStock) });
  for (const sale of state.sales) for (const [index, line] of sale.lines.entries()) movements.push({ id: `${sale.id}_${index}`, date: sale.date?.slice(0, 10) || "", productId: line.productId, productName: line.productName || names.get(line.productId) || "Producto eliminado", type: "Venta", detail: `${sale.receiptNumber || "Venta"} · ${sale.customerName || "Cliente"}`, quantity: -Number(line.quantity) });
  return movements.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

export function paymentMovements(state) {
  const orders = new Map(state.orders.map(item => [item.id, item]));
  const receipts = new Map(state.sales.map(item => [item.orderId, item.receiptNumber || ""]));
  const movements = [];
  for (const order of state.orders) if (Number(order.deposit || 0) > 0) movements.push({ id: `legacy_${order.id}`, date: "", orderId: order.id, receiptNumber: receipts.get(order.id) || "", customerName: order.customerName, channel: order.channel, kind: "payment", method: "legacy", amount: Number(order.deposit), note: "Seña anterior; fecha y medio originales no registrados" });
  for (const payment of state.payments || []) {
    const order = orders.get(payment.orderId);
    movements.push({ id: payment.id, date: payment.date, orderId: payment.orderId, receiptNumber: receipts.get(payment.orderId) || "", customerName: order?.customerName || "Pedido no encontrado", channel: order?.channel || "", kind: payment.kind, method: payment.method, amount: payment.kind === "refund" ? -Number(payment.amount) : Number(payment.amount), note: payment.note || "" });
  }
  return movements.sort((a, b) => b.date.localeCompare(a.date));
}

