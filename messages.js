import { orderTotal, orderSubtotal, discountAmount, paidAmount, orderStatuses } from "./domain.js?v=aftersales-20261002";

export const messageTypes = { detail: "Detalle del pedido", balance: "Recordatorio de saldo", delivery: "Datos de entrega" };
const money = value => new Intl.NumberFormat("es-UY", { style: "currency", currency: "UYU" }).format(value);
const displayDate = value => value ? value.split("-").reverse().join("/") : "A coordinar";

export function whatsappPhone(contact) {
  const raw = String(contact || "").trim();
  if (!/^\+?[\d\s().-]+$/.test(raw)) return "";
  const digits = raw.replace(/\D/g, "");
  if (!raw.startsWith("+") && /^09\d{7}$/.test(digits)) return `598${digits.slice(1)}`;
  if (!raw.startsWith("+") && /^9\d{7}$/.test(digits)) return `598${digits}`;
  const international = digits.startsWith("00") ? digits.slice(2) : digits;
  if ((raw.startsWith("+") || digits.startsWith("00") || /^5989\d{7}$/.test(digits)) && /^[1-9]\d{7,14}$/.test(international)) return international;
  return "";
}

export function whatsappUrl(phone, text) {
  const number = whatsappPhone(phone);
  return number && String(text || "").trim() ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : "";
}

export function orderMessage(state, orderId, type = "detail") {
  const order = state.orders.find(item => item.id === orderId);
  if (!order || !Object.hasOwn(messageTypes, type)) throw new Error("No se encontró el pedido o el tipo de mensaje.");
  const total = orderTotal(order), paid = paidAmount(state, order.id), balance = Math.round((total - paid) * 100) / 100;
  const greeting = `Hola ${order.customerName}, te escribimos de Cualitec.`;
  if (type === "balance") {
    if (order.status === "cancelled" || balance <= 0) throw new Error("Este pedido no tiene un saldo para reclamar.");
    return `${greeting}\n\nTe recordamos el saldo pendiente de tu pedido:\nTotal: ${money(total)}\nCobrado: ${money(paid)}\nSaldo pendiente: ${money(balance)}\n\nSi ya realizaste el pago, podés enviarnos el comprobante. ¡Gracias!`;
  }
  const delivery = [`Entrega: ${order.deliveryMethod === "dac" ? "DAC al interior" : "Montevideo"}`, `${order.status === "delivered" ? "Fecha prevista originalmente" : "Fecha prevista"}: ${displayDate(order.deliveryDate)}`];
  if (order.deliveryMethod === "dac" && order.trackingCode) delivery.push(`Guía DAC: ${order.trackingCode}`);
  if (order.shippingPayer === "recipient_on_delivery") delivery.push("El envío lo paga el destinatario al recibir.");
  if (order.shippingPayer === "included_in_sale") delivery.push(`Envío incluido en el total: ${money(Number(order.shippingAmount || 0))}`);
  if (type === "delivery") {
    if (order.status === "cancelled") throw new Error("El pedido está cancelado.");
    return `${greeting}\n\nEstos son los datos de entrega de tu pedido:\nEstado: ${orderStatuses[order.status]}\n${delivery.join("\n")}\n\nSi necesitás coordinar algún detalle, escribinos. ¡Gracias!`;
  }
  const lines = order.lines.map(line => {
    const product = state.products.find(item => item.id === line.productId);
    const saleLine = state.sales.find(sale => sale.orderId === order.id)?.lines.find(item => item.productId === line.productId);
    const name = saleLine?.productName || (product ? `${product.name}${product.variant ? ` · ${product.variant}` : ""}` : "Producto");
    return `• ${name} × ${line.quantity} — ${money(Number(line.quantity) * Number(line.unitPrice))}`;
  });
  const amounts = [`Subtotal: ${money(orderSubtotal(order))}`];
  if (discountAmount(order)) amounts.push(`Descuento: ${money(discountAmount(order))}`);
  amounts.push(`Total: ${money(total)}`, `Cobrado: ${money(paid)}`);
  amounts.push(order.status === "cancelled" ? `Importe cobrado pendiente de devolución: ${money(paid)}` : `Saldo pendiente: ${money(balance)}`);
  return `${greeting}\n\nTe compartimos el detalle de tu pedido:\nEstado: ${orderStatuses[order.status]}\n${lines.join("\n")}\n\n${amounts.join("\n")}\n\n${order.status === "cancelled" ? "" : delivery.join("\n") + "\n\n"}¡Gracias por elegir Cualitec!`;
}
