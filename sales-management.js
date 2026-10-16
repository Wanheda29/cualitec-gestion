import { saveOrder, orderSubtotal, discountAmount, orderTotal, paidAmount, availableQuantity } from "./domain.js?v=sales-edit-20261016";

const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || "") && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

function moveStock(state, before, after) {
  const delta = new Map();
  for (const line of before) delta.set(line.productId, (delta.get(line.productId) || 0) + Number(line.quantity));
  for (const line of after) delta.set(line.productId, (delta.get(line.productId) || 0) - Number(line.quantity));
  for (const [productId, change] of delta) {
    if (!state.products.some(product => product.id === productId)) throw new Error("No se encontró un producto de la venta.");
    if (change < 0 && availableQuantity(state, productId) < -change) throw new Error("No hay stock disponible para modificar o recuperar esta venta.");
  }
  return state.products.map(product => ({ ...product, stock: Number(product.stock || 0) + (delta.get(product.id) || 0) }));
}

export function editSale(state, saleId, input) {
  const sale = state.sales.find(item => item.id === saleId);
  const order = state.orders.find(item => item.id === sale?.orderId);
  if (!sale || !order || order.status !== "delivered") throw new Error("No se encontró la venta entregada.");
  if (!validDate(input.date)) throw new Error("Revisá la fecha de venta.");
  const lines = (input.lines || []).map(line => {
    const old = sale.lines.find(item => item.productId === line.productId);
    const product = state.products.find(item => item.id === line.productId);
    const unitCost = Number(line.unitCost);
    if (!Number.isFinite(unitCost) || unitCost < 0) throw new Error("Revisá el costo unitario de cada producto.");
    return { productId: line.productId, quantity: Number(line.quantity), unitPrice: Number(line.unitPrice), unitCost, productName: old?.productName || `${product?.name || ""}${product?.variant ? ` · ${product.variant}` : ""}` };
  });
  const cases = (state.serviceCases || []).filter(item => item.saleId === saleId);
  if (cases.some(item => !lines.some(line => line.productId === item.productId) || item.openedAt < input.date)) throw new Error("La edición no puede quitar productos con posventa ni dejar sus casos antes de la fecha de venta.");
  const details = { customerName: String(input.customerName || "").trim(), contact: String(input.contact || "").trim(), channel: String(input.channel || "").trim(), discountType: input.discountType || "none", discountValue: Number(input.discountValue || 0), shippingPayer: input.shippingPayer || "recipient_on_delivery", shippingAmount: Number(input.shippingAmount || 0), shippingCost: Number(input.shippingCost || 0), warrantyDays: Number(input.warrantyDays ?? 30) };
  const updatedOrder = { ...order, ...details, lines: lines.map(({ productId, quantity, unitPrice }) => ({ productId, quantity, unitPrice })), deliveredAt: input.date };
  const validated = saveOrder(state, updatedOrder);
  const products = moveStock(state, sale.lines, lines);
  const updated = { ...sale, ...details, date: input.date, lines, subtotal: orderSubtotal(updatedOrder), discount: discountAmount(updatedOrder), total: orderTotal(updatedOrder), updatedAt: new Date().toISOString() };
  return { ...validated, products, sales: state.sales.map(item => item.id === saleId ? updated : item) };
}

export function deleteSale(state, saleId) {
  const sale = state.sales.find(item => item.id === saleId);
  const order = state.orders.find(item => item.id === sale?.orderId);
  if (!sale || !order) throw new Error("No se encontró la venta.");
  if (Math.abs(paidAmount(state, sale.orderId)) > 0.001) throw new Error("Registrá primero la devolución del dinero cobrado desde Pedidos.");
  if ((state.serviceCases || []).some(item => item.saleId === saleId)) throw new Error("Esta venta tiene casos de posventa asociados y no se puede eliminar.");
  const products = moveStock(state, sale.lines, []);
  return { ...state, products, sales: state.sales.filter(item => item.id !== saleId), orders: state.orders.map(item => item.id === order.id ? { ...item, status: "cancelled" } : item), deletedSales: [...(state.deletedSales || []), { id: sale.id, sale, order, deletedAt: new Date().toISOString() }] };
}

export function restoreSale(state, saleId) {
  const entry = (state.deletedSales || []).find(item => item.id === saleId);
  if (!entry || state.sales.some(item => item.id === saleId || item.orderId === entry.sale.orderId || item.receiptNumber === entry.sale.receiptNumber)) throw new Error("Esta venta no se puede recuperar.");
  const currentOrder = state.orders.find(item => item.id === entry.order.id);
  if (!currentOrder || currentOrder.status !== "cancelled" || canonical(currentOrder) !== canonical({ ...entry.order, status: "cancelled" })) throw new Error("El pedido cambió después de eliminar la venta; revisalo antes de recuperar.");
  const products = moveStock(state, [], entry.sale.lines);
  return { ...state, products, orders: state.orders.map(item => item.id === entry.order.id ? entry.order : item), sales: [...state.sales, entry.sale], deletedSales: state.deletedSales.filter(item => item.id !== saleId) };
}
