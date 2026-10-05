import { normalizeState, paymentMethods, paidAmount } from "./domain.js";

const key = "cualitec-gestion-v1";
const target = document.querySelector("#receipt");
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const money = value => new Intl.NumberFormat("es-UY", { style: "currency", currency: "UYU", maximumFractionDigits: 2 }).format(Number(value || 0));
const displayDate = value => value ? new Intl.DateTimeFormat("es-UY", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${value}T12:00:00`)) : "—";

try {
  const state = normalizeState(JSON.parse(localStorage.getItem(key)));
  const id = new URLSearchParams(location.search).get("sale");
  const index = state.sales.findIndex(item => item.id === id);
  if (index < 0) throw new Error("No se encontró esta venta en los datos de este navegador.");
  const sale = state.sales[index], order = state.orders.find(item => item.id === sale.orderId);
  const number = sale.receiptNumber || `A${String(index + 1).padStart(3, "0")}`;
  const methods = [...new Set(state.payments.filter(item => item.orderId === sale.orderId && item.kind === "payment").map(item => paymentMethods[item.method] || item.method))];
  if (Number(order?.deposit || 0) > 0) methods.unshift("Seña anterior");
  const warrantyDays = Number(sale.warrantyDays ?? order?.warrantyDays ?? 30);
  const shipping = Number(sale.shippingAmount || 0), discount = Number(sale.discount || 0);
  const lines = sale.lines.map(line => `<tr><td><strong>${esc(line.productName)}</strong><span>${line.quantity} × ${money(line.unitPrice)}</span></td><td>${money(Number(line.quantity) * Number(line.unitPrice))}</td></tr>`).join("");
  const discountRow = discount ? `<tr class="adjustment"><td>Descuento manual${sale.discountType === "percent" ? ` (${esc(sale.discountValue)}%)` : ""}</td><td>−${money(discount)}</td></tr>` : "";
  const shippingRow = shipping ? `<tr class="adjustment"><td>Envío</td><td>${money(shipping)}</td></tr>` : "";
  const pending = Math.max(0, Number(sale.total) - paidAmount(state, sale.orderId));
  target.innerHTML = `<div class="ornament ornament-top" aria-hidden="true"></div><header><div class="handle"><strong>cualitecuy</strong><span>Instagram · @cualitecuy</span></div><time>${displayDate(sale.date)}</time><div class="logo"><img src="assets/cualitec-logo.png" alt="Cualitec" width="1046" height="1101"></div></header><section class="identity"><h1>VENTA #${esc(number)}</h1><h2>CLIENTE:</h2><p>${esc(sale.customerName)}${sale.contact || order?.contact ? `<br><small>${esc(sale.contact || order.contact)}</small>` : ""}</p></section><section class="items"><div class="table-head"><span>PRODUCTO</span><span>COSTO</span></div><div class="item-card"><table><tbody>${lines}${discountRow}${shippingRow}</tbody></table></div>${!shipping && order?.shippingPayer === "recipient_on_delivery" ? `<p class="shipping-note">Envío a cargo del destinatario al recibir.</p>` : ""}</section><div class="receipt-bottom"><div class="total">TOTAL: ${money(sale.total)}</div><section><h2>FORMA DE PAGO</h2><p>${esc(methods.join(" · ") || "Pendiente de registrar")}</p>${pending ? `<p class="pending">Saldo pendiente: ${money(pending)}</p>` : ""}</section><section><h2>GARANTÍA</h2><p>${warrantyDays ? `Este producto cuenta con garantía válida por ${warrantyDays} días.` : "Según condiciones acordadas al momento de la venta."}</p></section></div><div class="ornament ornament-bottom" aria-hidden="true"></div>`;
  document.title = `Venta ${number} · Cualitec`;
} catch (error) {
  target.innerHTML = `<div class="error"><h1>Comprobante no disponible</h1><p>${esc(error.message)}</p><p>Abrí esta venta desde la sección Ventas del panel en el mismo navegador.</p></div>`;
}

document.querySelector("#print").addEventListener("click", () => window.print());
