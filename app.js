import { emptyState, normalizeState, orderStatuses, paymentMethods, availableQuantity, addPurchase, adjustStock, saveOrder, deliverOrder, orderTotal, paidAmount, recordPayment, monthlySummary } from "./domain.js";
import { isCloudConfigured, signIn, signOut, updatePassword, getSession, readCloud, writeCloud } from "./cloud.js";

const KEY = "cualitec-gestion-v1";
let state;
try { state = normalizeState(JSON.parse(localStorage.getItem(KEY)) || emptyState); }
catch { state = structuredClone(emptyState); }
let view = "dashboard";
let session = null, cloudRevision = 0, cloudEnabled = false, cloudPending = null;
let cloudCheck = "";
let saveQueue = Promise.resolve();
const app = document.querySelector("#app");
const money = value => new Intl.NumberFormat("es-UY", { style: "currency", currency: "UYU", maximumFractionDigits: 0 }).format(Number(value || 0));
const date = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; };
const id = prefix => `${prefix}_${crypto.randomUUID()}`;
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const persist = next => {
  state = next; localStorage.setItem(KEY, JSON.stringify(state)); render();
  if (cloudEnabled) {
    saveQueue = saveQueue.then(async () => { cloudRevision = await writeCloud(state, cloudRevision); })
      .catch(error => { cloudEnabled = false; toast(`No se sincronizó: ${error.message}. Descargá un respaldo y revisá la cuenta.`); render(); });
  }
};
const toast = message => { const target = document.querySelector("#toast"); target.textContent = message; target.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => target.classList.remove("show"), 4000); };
const option = (value, label, selected = false) => `<option value="${esc(value)}" ${selected ? "selected" : ""}>${esc(label)}</option>`;
const productOptions = selected => state.products.map(item => option(item.id, `${item.name}${item.variant ? ` · ${item.variant}` : ""}`, item.id === selected)).join("");
const productName = productId => { const item = state.products.find(product => product.id === productId); return item ? `${item.name}${item.variant ? ` · ${item.variant}` : ""}` : "Producto eliminado"; };
const orderLine = (line = {}) => `<div class="order-line"><label>Producto / variante<select name="productId" required>${productOptions(line.productId)}</select></label><label>Cantidad<input name="quantity" type="number" min="1" step="1" value="${esc(line.quantity ?? 1)}" required></label><label>Precio unitario<input name="unitPrice" type="number" min="0" step="0.01" value="${esc(line.unitPrice ?? state.products.find(item => item.id === (line.productId || state.products[0]?.id))?.price ?? "")}" required></label><button class="text-button remove-line" type="button">Quitar</button></div>`;
const section = (title, body, action = "") => `<section class="panel"><div class="panel-head"><h2>${title}</h2>${action}</div>${body}</section>`;
const empty = label => `<p class="empty">${label}</p>`;
const badge = label => `<span class="badge">${esc(label)}</span>`;
const rows = (headers, body) => `<div class="table-wrap"><table><thead><tr>${headers.map(x => `<th>${x}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`;

function dashboard() {
  const month = date().slice(0, 7), summary = monthlySummary(state, month);
  const pending = state.orders.filter(item => !["delivered", "cancelled"].includes(item.status));
  const low = state.products.filter(item => Number(item.stock) <= Number(item.minStock || 0));
  return `<div class="hero"><div><span class="eyebrow">TU NEGOCIO EN UN VISTAZO</span><h2>Vendé con claridad.<br><em>Gestioná con control.</em></h2><p>Stock, pedidos de redes sociales y resultados, en un mismo lugar.</p></div><button class="primary" data-view="orders">Nuevo pedido →</button></div>
    <div class="stats"><article><span>Ventas del mes</span><strong>${money(summary.revenue)}</strong><small>${summary.sales} operaciones</small></article><article><span>Ganancia bruta</span><strong>${money(summary.revenue - summary.cost)}</strong><small>Ventas menos costo de mercadería</small></article><article><span>Pedidos activos</span><strong>${pending.length}</strong><small>Por atender o entregar</small></article><article><span>Productos con stock bajo</span><strong>${low.length}</strong><small>Según mínimo configurado</small></article></div>
    <div class="grid two">${section("Pedidos en curso", pending.length ? rows(["Cliente", "Productos", "Estado", "Entrega"], pending.slice(-5).reverse().map(item => `<tr><td>${esc(item.customerName)}</td><td>${item.lines.map(line => `${esc(productName(line.productId))} × ${line.quantity}`).join("<br>")}</td><td>${badge(orderStatuses[item.status])}</td><td>${esc(item.deliveryDate || "Sin fecha")}</td></tr>`).join("")) : empty("Todavía no hay pedidos activos."))}
    ${section("Reponer pronto", low.length ? rows(["Producto", "En stock", "Disponible"], low.map(item => `<tr><td>${esc(item.name)}</td><td>${item.stock}</td><td>${availableQuantity(state, item.id)}</td></tr>`).join("")) : empty("El inventario está por encima de los mínimos."))}</div>`;
}

function products() {
  const form = `<form id="product-form" class="form-grid"><input name="id" type="hidden"><label>Producto o modelo<input name="name" required placeholder="Ej. Auriculares inalámbricos"></label><label>Categoría<input name="category" placeholder="Ej. Audio"></label><label>Variante (color, capacidad…)<input name="variant" placeholder="Ej. Negro · 128 GB"></label><label>Código de barras de esta variante<input name="barcode" inputmode="numeric" placeholder="Opcional"></label><label>SKU de esta variante<input name="sku" placeholder="Opcional"></label><label>Precio de venta<input name="price" type="number" min="0" step="0.01" required></label><label>Stock mínimo<input name="minStock" type="number" min="0" step="1" value="0" required></label><p class="form-hint wide">Creá un registro por cada color o capacidad. Cada variante tiene stock, precio y códigos propios.</p><div class="form-actions"><button class="primary">Guardar variante</button><button type="reset" class="secondary">Limpiar</button></div></form>`;
  const table = state.products.length ? rows(["Producto", "Código de barras", "Stock", "Disponible", "Costo prom.", "Precio", ""], state.products.map(item => `<tr><td><strong>${esc(item.name)}</strong><small>${esc([item.category, item.variant].filter(Boolean).join(" · "))}</small></td><td>${esc(item.barcode || item.sku || "—")}</td><td>${item.stock}</td><td>${availableQuantity(state, item.id)}</td><td>${money(item.averageCost)}</td><td>${money(item.price)}</td><td><button class="text-button" data-edit-product="${esc(item.id)}">Editar</button></td></tr>`).join("")) : empty("Agregá el primer producto de Cualitec.");
  return `<div class="grid split">${section("Catálogo", table)}${section("Agregar o editar producto", form)}</div>`;
}

function purchases() {
  const form = `<form id="purchase-form" class="form-grid"><label>Producto<select name="productId" required>${productOptions()}</select></label><label>Cantidad recibida<input name="quantity" type="number" min="1" step="1" required></label><label>Costo unitario<input name="unitCost" type="number" min="0" step="0.01" required></label><label>Fecha<input name="date" type="date" value="${date()}" required></label><label>Proveedor<input name="supplier" placeholder="Opcional"></label><div class="form-actions"><button class="primary" ${state.products.length ? "" : "disabled"}>Registrar compra</button></div></form>`;
  const adjustments = `<form id="adjust-form" class="form-grid"><label>Producto<select name="productId" required>${productOptions()}</select></label><label>Nuevo stock<input name="newStock" type="number" min="0" step="1" required></label><label class="wide">Motivo<input name="reason" required placeholder="Ej. Recuento, devolución o pérdida"></label><div class="form-actions"><button class="secondary" ${state.products.length ? "" : "disabled"}>Ajustar stock</button></div></form>`;
  const history = state.purchases.length ? rows(["Fecha", "Producto", "Proveedor", "Cantidad", "Costo total"], [...state.purchases].reverse().map(item => `<tr><td>${esc(item.date)}</td><td>${esc(productName(item.productId))}</td><td>${esc(item.supplier || "—")}</td><td>${item.quantity}</td><td>${money(item.quantity * item.unitCost)}</td></tr>`).join("")) : empty("Las compras registradas aparecerán aquí.");
  return `<div class="grid two">${section("Entrada de mercadería", form)}${section("Ajuste de inventario", adjustments)}</div>${section("Historial de compras", history)}`;
}

function orders() {
  const form = `<form id="order-form" class="form-grid"><input name="id" type="hidden"><label>Cliente<input name="customerName" required></label><label>Contacto / usuario de red<input name="contact" required placeholder="Teléfono o @usuario"></label><label>Canal<select name="channel">${["Instagram", "WhatsApp", "Facebook", "Otro"].map(x => option(x, x)).join("")}</select></label><label>Estado<select name="status">${Object.entries(orderStatuses).filter(([key]) => key !== "delivered").map(([key, value]) => option(key, value)).join("")}</select></label><div class="wide"><div id="order-lines" class="order-lines">${state.products.length ? orderLine() : ""}</div><button id="add-line" class="secondary" type="button" ${state.products.length ? "" : "disabled"}>Agregar producto</button></div><label>Entrega<select name="deliveryMethod"><option value="montevideo">Montevideo · en el día</option><option value="dac">Interior · DAC</option></select></label><label>Fecha prevista de entrega<input name="deliveryDate" type="date"></label><label>Guía DAC<input name="trackingCode" placeholder="Opcional"></label><label class="wide">Notas<textarea name="notes" rows="2" placeholder="Dirección, acuerdos, preferencias..."></textarea></label><p class="form-hint wide">El destinatario paga el envío al recibir. El costo de envío no se suma a la venta.</p><div class="form-actions"><button class="primary" ${state.products.length ? "" : "disabled"}>Guardar pedido</button><button id="clear-order" class="secondary" type="button">Limpiar</button></div></form>`;
  const table = state.orders.length ? rows(["Cliente", "Productos", "Canal", "Estado", "Total / saldo", "Entrega", "Acciones"], [...state.orders].reverse().map(item => `<tr><td><strong>${esc(item.customerName)}</strong><small>${esc(item.contact)}</small></td><td>${item.lines.map(line => `${esc(productName(line.productId))} × ${line.quantity}`).join("<br>")}</td><td>${esc(item.channel)}</td><td>${badge(orderStatuses[item.status])}</td><td>${money(orderTotal(item))}<small>${item.status === "cancelled" ? `A devolver ${money(paidAmount(state, item.id))}` : `Cobrado ${money(paidAmount(state, item.id))} · Saldo ${money(orderTotal(item) - paidAmount(state, item.id))}`}</small></td><td>${item.deliveryMethod === "dac" ? "DAC" : "Montevideo"}<small>${esc(item.deliveryDate || "Sin fecha")}${item.trackingCode ? ` · ${esc(item.trackingCode)}` : ""}</small></td><td><div class="row-actions">${item.status !== "delivered" ? `<button class="text-button" data-edit-order="${esc(item.id)}">Editar</button>` : ""}${!["delivered", "cancelled"].includes(item.status) ? `<button class="text-button" data-deliver="${esc(item.id)}">Entregar</button>` : ""}</div></td></tr>`).join("")) : empty("Registrá consultas o pedidos que llegan por redes.");
  const paymentForm = `<form id="payment-form" class="form-grid"><label>Pedido<select name="orderId" required>${state.orders.map(item => option(item.id, `${item.customerName} · ${money(orderTotal(item))}`)).join("")}</select></label><label>Movimiento<select name="kind"><option value="payment">Cobro</option><option value="refund">Devolución de dinero</option></select></label><label>Importe<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Medio de pago<select name="method">${Object.entries(paymentMethods).map(([key, value]) => option(key, value)).join("")}</select></label><label>Fecha<input name="date" type="date" value="${date()}" required></label><label>Referencia / nota<input name="note" placeholder="Opcional"></label><div class="form-actions"><button class="primary" ${state.orders.length ? "" : "disabled"}>Registrar movimiento</button></div></form>`;
  const legacyDeposits = state.orders.filter(item => Number(item.deposit || 0) > 0).map(item => ({ id: `legacy_${item.id}`, orderId: item.id, date: item.createdAt?.slice(0, 10) || "—", amount: Number(item.deposit), kind: "payment", method: "Seña anterior", note: "Registrada antes del historial de pagos" }));
  const movements = [...legacyDeposits, ...(state.payments || [])];
  const history = movements.length ? rows(["Fecha", "Pedido", "Movimiento", "Medio", "Importe", "Nota"], [...movements].reverse().map(item => `<tr><td>${esc(item.date)}</td><td>${esc(state.orders.find(order => order.id === item.orderId)?.customerName || "Pedido eliminado")}</td><td>${item.kind === "refund" ? "Devolución" : "Cobro"}</td><td>${esc(paymentMethods[item.method] || item.method)}</td><td>${item.kind === "refund" ? "−" : "+"}${money(item.amount)}</td><td>${esc(item.note || "—")}</td></tr>`).join("")) : empty("Los cobros y devoluciones aparecerán aquí.");
  return `<div class="grid split">${section("Pedidos", table)}${section("Nuevo pedido", form)}</div><div class="grid two">${section("Cobros y devoluciones", paymentForm)}${section("Historial de pagos", history)}</div>`;
}

function customers() {
  const map = new Map();
  for (const order of state.orders) { const key = order.contact.trim().toLowerCase(); const previous = map.get(key) || { name: order.customerName, contact: order.contact, count: 0, spent: 0 }; previous.count++; if (order.status === "delivered") previous.spent += orderTotal(order); map.set(key, previous); }
  return section("Clientes registrados en pedidos", map.size ? rows(["Cliente", "Contacto", "Pedidos", "Ventas entregadas"], [...map.values()].map(item => `<tr><td>${esc(item.name)}</td><td>${esc(item.contact)}</td><td>${item.count}</td><td>${money(item.spent)}</td></tr>`).join("")) : empty("Los clientes aparecerán al registrar pedidos."));
}

function sales() {
  const summary = monthlySummary(state, date().slice(0, 7));
  return `<div class="stats"><article><span>Facturación del mes</span><strong>${money(summary.revenue)}</strong></article><article><span>Costo de mercadería</span><strong>${money(summary.cost)}</strong></article><article><span>Ganancia bruta</span><strong>${money(summary.revenue - summary.cost)}</strong></article></div>${section("Ventas realizadas", state.sales.length ? rows(["Fecha", "Cliente", "Canal", "Productos", "Total", "Saldo", "Ganancia bruta"], [...state.sales].reverse().map(item => `<tr><td>${esc(item.date)}</td><td>${esc(item.customerName)}</td><td>${esc(item.channel)}</td><td>${item.lines.map(line => `${esc(line.productName)} × ${line.quantity}`).join("<br>")}</td><td>${money(item.total)}</td><td>${money(item.total - paidAmount(state, item.orderId))}</td><td>${money(item.total - item.lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0))}</td></tr>`).join("")) : empty("Al entregar un pedido, la venta se registra automáticamente."))}`;
}

function dataView() {
  let account;
  if (!isCloudConfigured()) account = `<p>La nube de Cualitec todavía no está configurada. Los datos se guardan en este navegador.</p>`;
  else if (!session) account = `<p>Iniciá sesión para sincronizar datos entre dispositivos.</p><form id="login-form" class="form-grid"><label>Correo electrónico<input name="email" type="email" autocomplete="username" required></label><label>Contraseña<input name="password" type="password" autocomplete="current-password" required></label><div class="form-actions"><button class="primary">Ingresar</button></div></form>`;
  else account = `<p>Cuenta: <strong>${esc(session.user.email)}</strong></p><p>${cloudEnabled ? "Sincronización activa" : cloudPending ? "Los datos locales difieren de los de la nube. Descargá un respaldo antes de cargar la versión remota." : "Datos locales pendientes de subir a la nube."}</p><div class="form-actions">${cloudPending ? `<button id="load-cloud" class="secondary">Cargar datos de la nube</button>` : !cloudEnabled ? `<button id="upload-local" class="primary">Subir datos locales</button>` : `<button id="check-cloud" class="secondary">Probar sincronización</button>`}<button id="logout" class="secondary">Cerrar sesión</button></div>${cloudCheck ? `<p>${esc(cloudCheck)}</p>` : ""}<form id="password-form" class="form-grid"><label>Nueva contraseña<input name="password" type="password" autocomplete="new-password" minlength="8" required></label><label>Repetir contraseña<input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required></label><div class="form-actions"><button class="secondary">Guardar contraseña</button></div></form>`;
  return `<div class="grid two">${section("Respaldo", `<p>Descargá una copia de tus datos o restaurá un respaldo de Cualitec.</p><div class="form-actions"><button id="export" class="primary">Descargar respaldo</button><label class="file-button">Importar respaldo<input id="import" type="file" accept="application/json,.json" hidden></label></div>`)}${section("Cuenta y almacenamiento", account)}</div>`;
}

async function connectCloud() {
  session = await getSession();
  if (!session) { cloudEnabled = false; cloudPending = null; render(); return; }
  const remote = await readCloud();
  cloudRevision = Number(remote?.revision || 0);
  if (remote && canonical(normalizeState(remote.data)) !== canonical(state)) {
    cloudPending = normalizeState(remote.data); cloudEnabled = false;
  } else if (!remote && Object.values(state).some(items => items.length)) {
    cloudPending = null; cloudEnabled = false;
  } else { cloudPending = null; cloudEnabled = true; }
  render();
}

function render() {
  const titles = { dashboard: "Resumen", products: "Productos", purchases: "Compras", orders: "Pedidos", customers: "Clientes", sales: "Ventas", data: "Datos y respaldo" };
  document.querySelector("#view-title").textContent = titles[view];
  document.querySelector("#today").textContent = new Intl.DateTimeFormat("es-UY", { day: "numeric", month: "long", year: "numeric" }).format(new Date());
  document.querySelectorAll("[data-view]").forEach(button => button.classList.toggle("active", button.dataset.view === view));
  app.innerHTML = ({ dashboard, products, purchases, orders, customers, sales, data: dataView })[view]();
}

document.addEventListener("click", event => {
  const target = event.target.closest("button"); if (!target) return;
  if (target.dataset.view) { view = target.dataset.view; render(); document.querySelector(".sidebar").classList.remove("open"); }
  if (target.id === "menu") document.querySelector(".sidebar").classList.toggle("open");
  if (target.dataset.editProduct) {
    const item = state.products.find(p => p.id === target.dataset.editProduct), form = document.querySelector("#product-form");
    for (const key of ["id", "name", "category", "variant", "barcode", "sku", "price", "minStock"]) form.elements[key].value = item[key] ?? "";
    form.scrollIntoView({ behavior: "smooth" });
  }
  if (target.dataset.editOrder) {
    const item = state.orders.find(p => p.id === target.dataset.editOrder), form = document.querySelector("#order-form");
    for (const key of ["id", "customerName", "contact", "channel", "status", "deliveryMethod", "deliveryDate", "trackingCode", "notes"]) form.elements[key].value = item[key] ?? "";
    form.querySelector("#order-lines").innerHTML = item.lines.map(line => orderLine(line)).join("");
    form.scrollIntoView({ behavior: "smooth" });
  }
  if (target.id === "add-line") document.querySelector("#order-lines").insertAdjacentHTML("beforeend", orderLine());
  if (target.classList.contains("remove-line")) { const container = target.closest("#order-lines"); if (container.children.length > 1) target.closest(".order-line").remove(); else toast("El pedido necesita al menos un producto."); }
  if (target.id === "clear-order") { const form = document.querySelector("#order-form"); form.reset(); form.elements.id.value = ""; form.querySelector("#order-lines").innerHTML = state.products.length ? orderLine() : ""; }
  if (target.dataset.deliver) {
    try { persist(deliverOrder(state, target.dataset.deliver, date())); toast("Pedido entregado y venta registrada."); } catch (error) { toast(error.message); }
  }
  if (target.id === "export") {
    const blob = new Blob([JSON.stringify({ application: "Cualitec Gestión", version: 1, exportedAt: new Date().toISOString(), data: state }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = `cualitec-respaldo-${date()}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (target.id === "logout") signOut().then(() => { session = null; cloudEnabled = false; cloudPending = null; render(); }).catch(error => toast(error.message));
  if (target.id === "load-cloud" && cloudPending && confirm("Los datos locales se reemplazarán por la versión de Supabase. Descargá un respaldo antes de continuar. ¿Cargar?")) {
    state = cloudPending; localStorage.setItem(KEY, JSON.stringify(state)); cloudPending = null; cloudEnabled = true; render();
  }
  if (target.id === "upload-local") writeCloud(state, cloudRevision).then(revision => { cloudRevision = revision; cloudEnabled = true; render(); toast("Datos subidos a Supabase."); }).catch(error => toast(error.message));
  if (target.id === "check-cloud") {
    target.disabled = true;
    saveQueue = saveQueue.then(async () => {
      const snapshot = structuredClone(state);
      cloudRevision = await writeCloud(snapshot, cloudRevision);
      const saved = await readCloud();
      if (Number(saved?.revision) !== cloudRevision || canonical(normalizeState(saved.data)) !== canonical(snapshot)) throw new Error("Los datos leídos no coinciden con los guardados.");
      cloudCheck = "Prueba correcta: Supabase guardó y devolvió los datos actuales.";
      render();
    }).catch(error => { cloudCheck = `No se pudo verificar: ${error.message}`; cloudEnabled = false; render(); });
  }
});

document.addEventListener("submit", async event => {
  if (event.target.id === "password-form") {
    event.preventDefault();
    const form = event.target, data = Object.fromEntries(new FormData(form));
    if (data.password !== data.confirmPassword) { toast("Las contraseñas no coinciden."); return; }
    try { await updatePassword(data.password); form.reset(); toast("Contraseña guardada. Ya podés ingresar desde otros dispositivos."); }
    catch (error) { toast(error.message); }
    return;
  }
  if (event.target.id === "login-form") {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    try { await signIn(data.email, data.password); await connectCloud(); toast("Sesión iniciada."); }
    catch (error) { toast(error.message); }
    return;
  }
  const form = event.target, formId = form.getAttribute("id"); if (!["product-form", "purchase-form", "adjust-form", "order-form", "payment-form"].includes(formId)) return;
  event.preventDefault(); const data = Object.fromEntries(new FormData(form));
  try {
    if (formId === "product-form") {
      const previous = state.products.find(item => item.id === data.id);
      const product = { id: data.id || id("product"), name: data.name.trim(), category: data.category.trim(), variant: data.variant.trim(), barcode: data.barcode.trim(), sku: data.sku.trim(), price: Number(data.price), minStock: Number(data.minStock), stock: Number(previous?.stock || 0), averageCost: Number(previous?.averageCost || 0) };
      if (!product.name || product.price < 0 || !Number.isFinite(product.price) || !Number.isInteger(product.minStock) || product.minStock < 0) throw new Error("Revisá los datos del producto.");
      if (product.barcode && state.products.some(item => item.id !== product.id && item.barcode === product.barcode)) throw new Error("Ese código de barras ya está asignado a otro producto.");
      if (product.sku && state.products.some(item => item.id !== product.id && (item.sku || "").toLowerCase() === product.sku.toLowerCase())) throw new Error("Ese SKU ya está asignado a otra variante.");
      if (state.products.some(item => item.id !== product.id && item.name.trim().toLowerCase() === product.name.toLowerCase() && (item.variant || "").trim().toLowerCase() === product.variant.toLowerCase())) throw new Error("Ese producto y variante ya existen.");
      persist({ ...state, products: previous ? state.products.map(item => item.id === previous.id ? product : item) : [...state.products, product] });
    } else if (formId === "purchase-form") persist(addPurchase(state, { id: id("purchase"), ...data }));
    else if (formId === "adjust-form") persist(adjustStock(state, { id: id("adjustment"), ...data, date: new Date().toISOString() }));
    else if (formId === "payment-form") { persist(recordPayment(state, { id: id("payment"), ...data, note: data.note.trim() })); toast("Movimiento registrado."); return; }
    else {
      const previous = state.orders.find(item => item.id === data.id);
      if (previous?.status === "delivered") throw new Error("Una venta entregada no se puede modificar.");
      const lines = [...form.querySelectorAll(".order-line")].map(row => ({ productId: row.querySelector('[name="productId"]').value, quantity: Number(row.querySelector('[name="quantity"]').value), unitPrice: Number(row.querySelector('[name="unitPrice"]').value) }));
      const order = { id: data.id || id("order"), customerName: data.customerName.trim(), contact: data.contact.trim(), channel: data.channel, status: data.status, deposit: Number(previous?.deposit || 0), deliveryMethod: data.deliveryMethod, shippingPayer: "recipient_on_delivery", trackingCode: data.trackingCode.trim(), deliveryDate: data.deliveryDate, notes: data.notes.trim(), createdAt: previous?.createdAt || new Date().toISOString(), lines };
      persist(saveOrder(state, order));
    }
    toast("Guardado correctamente.");
  } catch (error) { toast(error.message); }
});

document.addEventListener("change", async event => {
  if (event.target.id === "import") {
    try {
      const input = JSON.parse(await event.target.files[0].text());
      if (input.application !== "Cualitec Gestión" || input.version !== 1) throw new Error("El archivo no es un respaldo compatible de Cualitec.");
      const restored = normalizeState(input.data);
      if (confirm("Este respaldo reemplazará todos los datos actuales de Cualitec en este navegador. ¿Continuar?")) { persist(restored); toast("Respaldo restaurado."); }
    } catch (error) { toast(error.message); }
  }
  if (event.target.name === "productId" && event.target.closest(".order-line")) {
    const product = state.products.find(item => item.id === event.target.value);
    if (product) event.target.closest(".order-line").querySelector('[name="unitPrice"]').value = product.price;
  }
});
render();
connectCloud().catch(error => toast(`No se pudo consultar Supabase: ${error.message}`));

