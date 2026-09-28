export const emptyState = { products: [], purchases: [], orders: [], sales: [], stockAdjustments: [] };
export const orderStatuses = { inquiry: "Consulta", reserved: "Reservado", requested: "Por encargo", ready: "Listo para entregar", delivered: "Entregado", cancelled: "Cancelado" };

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
  return state.orders.filter(order => order.id !== exceptOrderId && order.status === "reserved")
    .flatMap(order => order.lines || []).filter(line => line.productId === productId)
    .reduce((sum, line) => sum + Number(line.quantity), 0);
}

export function availableQuantity(state, productId, exceptOrderId = null) {
  const product = state.products.find(item => item.id === productId);
  return Number(product?.stock || 0) - reservedQuantity(state, productId, exceptOrderId);
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
  for (const line of order.lines) {
    if (!state.products.some(item => item.id === line.productId) || !Number.isInteger(Number(line.quantity)) || Number(line.quantity) <= 0 || !Number.isFinite(Number(line.unitPrice)) || Number(line.unitPrice) < 0) throw new Error("Revisá el producto, la cantidad y el precio.");
    if (order.status === "reserved" && Number(line.quantity) > availableQuantity(state, line.productId, order.id)) throw new Error("No hay stock disponible para reservar esa cantidad.");
  }
  if (!Object.hasOwn(orderStatuses, order.status)) throw new Error("El estado del pedido no es válido.");
  if (Number(order.deposit || 0) < 0 || Number(order.deposit || 0) > orderTotal(order)) throw new Error("La seña supera el total del pedido.");
  const existing = state.orders.some(item => item.id === order.id);
  return { ...state, orders: existing ? state.orders.map(item => item.id === order.id ? order : item) : [...state.orders, order] };
}

export function orderTotal(order) { return (order.lines || []).reduce((sum, line) => sum + Number(line.quantity) * Number(line.unitPrice), 0); }

export function deliverOrder(state, orderId, date) {
  const order = state.orders.find(item => item.id === orderId);
  if (!order || order.status === "cancelled" || order.status === "delivered" || state.sales.some(sale => sale.orderId === orderId)) throw new Error("Este pedido no se puede entregar nuevamente.");
  const products = state.products.map(item => ({ ...item }));
  const saleLines = [];
  for (const line of order.lines) {
    const product = products.find(item => item.id === line.productId);
    if (!product || Number(product.stock) < Number(line.quantity) || (order.status !== "reserved" && availableQuantity(state, line.productId) < Number(line.quantity))) throw new Error("No hay stock suficiente para entregar el pedido.");
    saleLines.push({ ...line, productName: product.name, unitCost: Number(product.averageCost || 0) });
    product.stock -= Number(line.quantity);
  }
  const sale = { id: `sale_${crypto.randomUUID()}`, orderId, customerName: order.customerName, channel: order.channel, date, lines: saleLines, total: orderTotal(order) };
  return { ...state, products, orders: state.orders.map(item => item.id === orderId ? { ...item, status: "delivered", deliveredAt: date } : item), sales: [...state.sales, sale] };
}

export function monthlySummary(state, month) {
  return state.sales.filter(sale => sale.date.startsWith(month)).reduce((summary, sale) => {
    summary.sales += 1; summary.revenue += Number(sale.total);
    summary.cost += sale.lines.reduce((sum, line) => sum + Number(line.quantity) * Number(line.unitCost), 0);
    return summary;
  }, { sales: 0, revenue: 0, cost: 0 });
}

