import { paidAmount } from "./domain.js";

const number = value => Number(value || 0).toFixed(2).replace(".", ",");
const cell = value => {
  let text = String(value ?? "");
  if (/^\s*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};

export function salesReportCsv(state, sales) {
  const headers = ["Fecha", "Venta", "Cliente", "Contacto", "Canal", "Productos", "Unidades", "Subtotal", "Descuento", "Envío", "Total", "Cobrado", "Saldo", "Costo mercadería", "Margen productos"];
  const rows = sales.map(sale => {
    const order = state.orders.find(item => item.id === sale.orderId);
    const subtotal = Number(sale.subtotal ?? sale.lines.reduce((sum, line) => sum + Number(line.quantity) * Number(line.unitPrice), 0));
    const shipping = Number(sale.shippingAmount || 0);
    const cost = sale.lines.reduce((sum, line) => sum + Number(line.quantity) * Number(line.unitCost), 0);
    const paid = paidAmount(state, sale.orderId);
    return [sale.date, sale.receiptNumber || `A${String(state.sales.indexOf(sale) + 1).padStart(3, "0")}`, sale.customerName, sale.contact || order?.contact || "", sale.channel, sale.lines.map(line => `${line.productName} × ${line.quantity}`).join(" | "), sale.lines.reduce((sum, line) => sum + Number(line.quantity), 0), number(subtotal), number(sale.discount), number(shipping), number(sale.total), number(paid), number(Number(sale.total) - paid), number(cost), number(Number(sale.total) - shipping - cost)];
  });
  return [headers, ...rows].map(row => row.map(cell).join(";")).join("\r\n") + "\r\n";
}
