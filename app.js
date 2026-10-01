import { emptyState, normalizeState, orderStatuses, paymentMethods, discountTypes, availableQuantity, findProductByCode, addPurchase, adjustStock, saveOrder, deliverOrder, orderTotal, paidAmount, recordPayment, monthlySummary, stockMovements } from "./domain.js";
import { isCloudConfigured, signIn, signOut, updatePassword, getSession, readCloud, writeCloud, listCloudHistory, readCloudRevision } from "./cloud.js";
import { salesReportCsv } from "./reports.js";

const KEY = "cualitec-gestion-v1";
let state;
try { state = normalizeState(JSON.parse(localStorage.getItem(KEY)) || emptyState); }
catch { state = structuredClone(emptyState); }
let view = "dashboard";
let session = null, cloudRevision = 0, cloudEnabled = false, cloudPending = null;
let cloudCheck = "";
let salesFilters = { from: "", to: "", channel: "" };
let stockFilters = { from: "", to: "", productId: "" };
let historySnapshots = [], historyStatus = "", historyAvailable = false;
let saveQueue = Promise.resolve();
const app = document.querySelector("#app");
const money = value => new Intl.NumberFormat("es-UY", { style: "currency", currency: "UYU", maximumFractionDigits: 2 }).format(Number(value || 0));
const date = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; };
const id = prefix => `${prefix}_${crypto.randomUUID()}`;
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const persist = next => {
  state = next; localStorage.setItem(KEY, JSON.stringify(state)); render();
  if (cloudEnabled) {
    const snapshot = structuredClone(next);
    saveQueue = saveQueue.then(async () => { cloudRevision = await writeCloud(snapshot, cloudRevision); if (view === "data") await refreshHistory(); })
      .catch(error => { cloudEnabled = false; toast(`No se sincronizó: ${error.message}. Descargá un respaldo y revisá la cuenta.`); render(); });
  }
};
const toast = message => { const target = document.querySelector("#toast"); target.textContent = message; target.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => target.classList.remove("show"), 4000); };
const option = (value, label, selected = false) => `<option value="${esc(value)}" ${selected ? "selected" : ""}>${esc(label)}</option>`;
const productOptions = selected => state.products.map(item => option(item.id, `${item.name}${item.variant ? ` · ${item.variant}` : ""}`, item.id === selected)).join("");
const productName = productId => { const item = state.products.find(product => product.id === productId); return item ? `${item.name}${item.variant ? ` · ${item.variant}` : ""}` : "Producto eliminado"; };
const orderLine = (line = {}) => `<div class="order-line" ${Object.keys(line).length ? "" : 'data-pristine="true"'}><label>Producto / variante<select name="productId" required>${productOptions(line.productId)}</select></label><label>Cantidad<input name="quantity" type="number" min="1" step="1" value="${esc(line.quantity ?? 1)}" required></label><label>Precio unitario<input name="unitPrice" type="number" min="0" step="0.01" value="${esc(line.unitPrice ?? state.products.find(item => item.id === (line.productId || state.products[0]?.id))?.price ?? "")}" required></label><button class="text-button remove-line" type="button">Quitar</button></div>`;
const section = (title, body, action = "") => `<section class="panel"><div class="panel-head"><h2>${title}</h2>${action}</div>${body}</section>`;
const empty = label => `<p class="empty">${label}</p>`;
const badge = label => `<span class="badge">${esc(label)}</span>`;
const rows = (headers, body) => `<div class="table-wrap"><table><thead><tr>${headers.map(x => `<th>${x}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`;

function dashboard() {
  const month = date().slice(0, 7), summary = monthlySummary(state, month);
  const pending = state.orders.filter(item => !["delivered", "cancelled"].includes(item.status));
  const low = state.products.filter(item => Number(item.stock) <= Number(item.minStock || 0));
  return `<div class="hero"><div><span class="eyebrow">TU NEGOCIO EN UN VISTAZO</span><h2>Vendé con claridad.<br><em>Gestioná con control.</em></h2><p>Stock, pedidos de redes sociales y resultados, en un mismo lugar.</p></div><button class="primary" data-view="orders">Nuevo pedido →</button></div>
    <div class="stats"><article><span>Ventas del mes</span><strong>${money(summary.revenue)}</strong><small>${summary.sales} operaciones</small></article><article><span>Margen de productos</span><strong>${money(summary.revenue - summary.shipping - summary.cost)}</strong><small>Ventas sin envíos menos costo de mercadería</small></article><article><span>Pedidos activos</span><strong>${pending.length}</strong><small>Por atender o entregar</small></article><article><span>Productos con stock bajo</span><strong>${low.length}</strong><small>Según mínimo configurado</small></article></div>
    <div class="grid two">${section("Pedidos en curso", pending.length ? rows(["Cliente", "Productos", "Estado", "Entrega"], pending.slice(-5).reverse().map(item => `<tr><td>${esc(item.customerName)}</td><td>${item.lines.map(line => `${esc(productName(line.productId))} × ${line.quantity}`).join("<br>")}</td><td>${badge(orderStatuses[item.status])}</td><td>${esc(item.deliveryDate || "Sin fecha")}</td></tr>`).join("")) : empty("Todavía no hay pedidos activos."))}
    ${section("Reponer pronto", low.length ? rows(["Producto", "En stock", "Disponible"], low.map(item => `<tr><td>${esc(item.name)}</td><td>${item.stock}</td><td>${availableQuantity(state, item.id)}</td></tr>`).join("")) : empty("El inventario está por encima de los mínimos."))}</div>`;
}

function products() {
  const form = `<form id="product-form" class="form-grid"><input name="id" type="hidden"><label>Producto o modelo<input name="name" required placeholder="Ej. Auriculares inalámbricos"></label><label>Categoría<input name="category" placeholder="Ej. Audio"></label><label>Variante (color, capacidad…)<input name="variant" placeholder="Ej. Negro · 128 GB"></label><label>Código de barras de esta variante<input name="barcode" inputmode="numeric" placeholder="Opcional"></label><label>SKU de esta variante<input name="sku" placeholder="Opcional"></label><label>Precio de venta<input name="price" type="number" min="0" step="0.01" required></label><label>Stock mínimo<input name="minStock" type="number" min="0" step="1" value="0" required></label><p class="form-hint wide">Creá un registro por cada color o capacidad. Cada variante tiene stock, precio y códigos propios.</p><div class="form-actions"><button class="primary">Guardar variante</button><button type="reset" class="secondary">Limpiar</button></div></form>`;
  const table = state.products.length ? rows(["Producto", "Código de barras", "Stock", "Disponible", "Costo prom.", "Precio", ""], state.products.map(item => `<tr data-product-row data-search="${esc([item.name, item.category, item.variant, item.barcode, item.sku].join(" ").toLowerCase())}"><td><strong>${esc(item.name)}</strong><small>${esc([item.category, item.variant].filter(Boolean).join(" · "))}</small></td><td>${esc(item.barcode || item.sku || "—")}</td><td>${item.stock}</td><td>${availableQuantity(state, item.id)}</td><td>${money(item.averageCost)}</td><td>${money(item.price)}</td><td><button class="text-button" data-edit-product="${esc(item.id)}">Editar</button></td></tr>`).join("")) : empty("Agregá el primer producto de Cualitec.");
  return `<div class="grid split">${section("Catálogo", `<label class="catalog-search">Buscar por nombre, código de barras o SKU<input id="product-search" autocomplete="off" placeholder="Escribí o escaneá un código"></label><p id="product-search-empty" class="empty" hidden>No hay productos para esa búsqueda.</p>${table}`)}${section("Agregar o editar producto", form)}</div>`;
}

function purchases() {
  const form = `<form id="purchase-form" class="form-grid"><label>Producto<select name="productId" required>${productOptions()}</select></label><label>Cantidad recibida<input name="quantity" type="number" min="1" step="1" required></label><label>Costo unitario<input name="unitCost" type="number" min="0" step="0.01" required></label><label>Fecha<input name="date" type="date" value="${date()}" required></label><label>Proveedor<input name="supplier" placeholder="Opcional"></label><div class="form-actions"><button class="primary" ${state.products.length ? "" : "disabled"}>Registrar compra</button></div></form>`;
  const adjustments = `<form id="adjust-form" class="form-grid"><label>Producto<select name="productId" required>${productOptions()}</select></label><label>Nuevo stock<input name="newStock" type="number" min="0" step="1" required></label><label class="wide">Motivo<input name="reason" required placeholder="Ej. Recuento, devolución o pérdida"></label><div class="form-actions"><button class="secondary" ${state.products.length ? "" : "disabled"}>Ajustar stock</button></div></form>`;
  const history = state.purchases.length ? rows(["Fecha", "Producto", "Proveedor", "Cantidad", "Costo total"], [...state.purchases].reverse().map(item => `<tr><td>${esc(item.date)}</td><td>${esc(productName(item.productId))}</td><td>${esc(item.supplier || "—")}</td><td>${item.quantity}</td><td>${money(item.quantity * item.unitCost)}</td></tr>`).join("")) : empty("Las compras registradas aparecerán aquí.");
  const movements = stockMovements(state).filter(item => (!stockFilters.from || item.date >= stockFilters.from) && (!stockFilters.to || item.date <= stockFilters.to) && (!stockFilters.productId || item.productId === stockFilters.productId));
  const filterForm = `<form id="stock-filter-form" class="form-grid"><label>Desde<input name="from" type="date" value="${esc(stockFilters.from)}"></label><label>Hasta<input name="to" type="date" value="${esc(stockFilters.to)}"></label><label>Producto<select name="productId">${option("", "Todos los productos", !stockFilters.productId)}${state.products.map(item => option(item.id, productName(item.id), item.id === stockFilters.productId)).join("")}</select></label><div class="form-actions"><button class="primary">Aplicar filtros</button><button id="clear-stock-filters" type="button" class="secondary">Limpiar</button></div></form>`;
  const movementTable = movements.length ? rows(["Fecha", "Producto", "Movimiento", "Detalle", "Unidades"], movements.map(item => `<tr><td>${esc(item.date || "—")}</td><td>${esc(item.productName)}</td><td>${esc(item.type)}</td><td>${esc(item.detail)}</td><td class="${item.quantity < 0 ? "stock-out" : "stock-in"}">${item.quantity > 0 ? "+" : ""}${item.quantity}</td></tr>`).join("")) : empty("No hay movimientos de stock para los filtros elegidos.");
  return `<div class="grid two">${section("Entrada de mercadería", form)}${section("Ajuste de inventario", adjustments)}</div>${section("Movimientos de stock", `${filterForm}<p class="form-hint">Incluye entradas por compras, ajustes y salidas al entregar ventas. Las reservas reducen lo disponible, pero no el stock físico.</p>${movementTable}`)}${section("Historial de compras", history)}`;
}

function orders() {
  const form = `<form id="order-form" class="form-grid"><input name="id" type="hidden"><label>Cliente<input name="customerName" required></label><label>Contacto / usuario de red<input name="contact" required placeholder="Teléfono o @usuario"></label><label>Canal<select name="channel">${["Instagram", "WhatsApp", "Facebook", "Otro"].map(x => option(x, x)).join("")}</select></label><label>Estado<select name="status">${Object.entries(orderStatuses).filter(([key]) => key !== "delivered").map(([key, value]) => option(key, value)).join("")}</select></label><div class="wide"><label>Código de barras o SKU<input id="order-code" autocomplete="off" placeholder="Escribí o escaneá el código"></label><div class="form-actions"><button id="add-by-code" class="secondary" type="button">Agregar por código</button></div><p class="form-hint">El lector escribe el código aquí como si fuera un teclado. También podés ingresarlo a mano y pulsar Enter.</p></div><div class="wide"><div id="order-lines" class="order-lines">${state.products.length ? orderLine() : ""}</div><button id="add-line" class="secondary" type="button" ${state.products.length ? "" : "disabled"}>Agregar producto</button></div><label>Descuento manual<select name="discountType">${Object.entries(discountTypes).map(([key, value]) => option(key, value)).join("")}</select></label><label>Valor del descuento<input name="discountValue" type="number" min="0" step="0.01" value="0" required></label><label>Entrega<select name="deliveryMethod"><option value="montevideo">Montevideo · en el día</option><option value="dac">Interior · DAC</option></select></label><label>Fecha prevista de entrega<input name="deliveryDate" type="date"></label><label>Envío<select name="shippingPayer"><option value="recipient_on_delivery">Destinatario paga al recibir</option><option value="included_in_sale">Cualitec cobra el envío</option></select></label><label>Cargo de envío<input name="shippingAmount" type="number" min="0" step="0.01" value="0" required></label><label>Garantía (días)<input name="warrantyDays" type="number" min="0" step="1" value="30" required></label><label>Guía DAC<input name="trackingCode" placeholder="Opcional"></label><label class="wide">Notas<textarea name="notes" rows="2" placeholder="Dirección, acuerdos, preferencias..."></textarea></label><p class="form-hint wide">Descuento y cargo de envío se ingresan manualmente. Por defecto, el destinatario paga el envío al recibir y no se suma a la venta.</p><div class="form-actions"><button class="primary" ${state.products.length ? "" : "disabled"}>Guardar pedido</button><button id="clear-order" class="secondary" type="button">Limpiar</button></div></form>`;
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

const filteredSales = () => state.sales.filter(item => (!salesFilters.from || item.date >= salesFilters.from) && (!salesFilters.to || item.date <= salesFilters.to) && (!salesFilters.channel || item.channel === salesFilters.channel));

function sales() {
  const filtered = filteredSales();
  const totals = filtered.reduce((result, sale) => {
    result.revenue += Number(sale.total); result.shipping += Number(sale.shippingAmount || 0); result.discount += Number(sale.discount || 0);
    result.cost += sale.lines.reduce((sum, line) => sum + Number(line.quantity) * Number(line.unitCost), 0);
    result.outstanding += Number(sale.total) - paidAmount(state, sale.orderId);
    return result;
  }, { revenue: 0, shipping: 0, discount: 0, cost: 0, outstanding: 0 });
  const products = new Map();
  for (const sale of filtered) {
    const subtotal = Number(sale.subtotal || sale.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0));
    for (const line of sale.lines) {
      const key = line.productId || line.productName, current = products.get(key) || { name: line.productName, quantity: 0, revenue: 0, cost: 0 };
      const gross = Number(line.quantity) * Number(line.unitPrice), share = subtotal ? gross / subtotal : 0;
      current.quantity += Number(line.quantity); current.revenue += gross - Number(sale.discount || 0) * share; current.cost += Number(line.quantity) * Number(line.unitCost);
      products.set(key, current);
    }
  }
  const filterForm = `<form id="sales-filter-form" class="form-grid"><label>Desde<input name="from" type="date" value="${esc(salesFilters.from)}"></label><label>Hasta<input name="to" type="date" value="${esc(salesFilters.to)}"></label><label>Canal<select name="channel">${option("", "Todos los canales", !salesFilters.channel)}${[...new Set(state.sales.map(item => item.channel))].map(item => option(item, item, item === salesFilters.channel)).join("")}</select></label><div class="form-actions"><button class="primary">Aplicar filtros</button><button id="clear-sales-filters" type="button" class="secondary">Limpiar</button><button id="export-sales" type="button" class="secondary" ${filtered.length ? "" : "disabled"}>Descargar CSV</button></div></form>`;
  const table = filtered.length ? rows(["Fecha", "Venta", "Cliente", "Canal", "Productos", "Descuento", "Envío", "Total", "Saldo", ""], [...filtered].reverse().map(item => `<tr><td>${esc(item.date)}</td><td>${esc(item.receiptNumber || `A${String(state.sales.indexOf(item) + 1).padStart(3, "0")}`)}</td><td>${esc(item.customerName)}</td><td>${esc(item.channel)}</td><td>${item.lines.map(line => `${esc(line.productName)} × ${line.quantity}`).join("<br>")}</td><td>${money(item.discount || 0)}</td><td>${money(item.shippingAmount || 0)}</td><td>${money(item.total)}</td><td>${money(item.total - paidAmount(state, item.orderId))}</td><td><button class="text-button" data-receipt="${esc(item.id)}">Comprobante</button></td></tr>`).join("")) : empty("No hay ventas para los filtros elegidos.");
  const productTable = products.size ? rows(["Producto", "Unidades", "Venta neta", "Costo", "Margen"], [...products.values()].sort((a, b) => b.revenue - a.revenue).map(item => `<tr><td>${esc(item.name)}</td><td>${item.quantity}</td><td>${money(item.revenue)}</td><td>${money(item.cost)}</td><td>${money(item.revenue - item.cost)}</td></tr>`).join("")) : empty("Sin productos vendidos en este período.");
  return `${section("Filtrar ventas", filterForm)}<div class="stats"><article><span>Ventas</span><strong>${filtered.length}</strong><small>Total ${money(totals.revenue)}</small></article><article><span>Margen de productos</span><strong>${money(totals.revenue - totals.shipping - totals.cost)}</strong><small>Sin cargo de envío ni costo de mercadería</small></article><article><span>Descuentos</span><strong>${money(totals.discount)}</strong><small>Aplicados manualmente</small></article><article><span>Por cobrar</span><strong>${money(totals.outstanding)}</strong><small>De las ventas filtradas</small></article></div>${section("Ventas realizadas", table)}${section("Productos vendidos", productTable)}`;
}

function dataView() {
  let account;
  if (!isCloudConfigured()) account = `<p>La nube de Cualitec todavía no está configurada. Los datos se guardan en este navegador.</p>`;
  else if (!session) account = `<p>Iniciá sesión para sincronizar datos entre dispositivos.</p><form id="login-form" class="form-grid"><label>Correo electrónico<input name="email" type="email" autocomplete="username" required></label><label>Contraseña<input name="password" type="password" autocomplete="current-password" required></label><div class="form-actions"><button class="primary">Ingresar</button></div></form>`;
  else account = `<p>Cuenta: <strong>${esc(session.user.email)}</strong></p><p>${cloudEnabled ? "Sincronización activa" : cloudPending ? "Los datos locales difieren de los de la nube. Descargá un respaldo antes de cargar la versión remota." : "Datos locales pendientes de subir a la nube."}</p><div class="form-actions">${cloudPending ? `<button id="load-cloud" class="secondary">Cargar datos de la nube</button>` : !cloudEnabled ? `<button id="upload-local" class="primary">Subir datos locales</button>` : `<button id="check-cloud" class="secondary">Probar sincronización</button>`}<button id="logout" class="secondary">Cerrar sesión</button></div>${cloudCheck ? `<p>${esc(cloudCheck)}</p>` : ""}<form id="password-form" class="form-grid"><label>Nueva contraseña<input name="password" type="password" autocomplete="new-password" minlength="8" required></label><label>Repetir contraseña<input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required></label><div class="form-actions"><button class="secondary">Guardar contraseña</button></div></form>`;
  const history = !session || !historyAvailable ? "" : section("Historial de recuperación", `<p>Las últimas 50 versiones sincronizadas se guardan en Supabase. Podés recuperar una anterior si cometés un error.</p><div class="form-actions"><button id="refresh-history" class="secondary">Actualizar historial</button></div>${historyStatus ? `<p>${esc(historyStatus)}</p>` : ""}${historySnapshots.length ? rows(["Versión", "Guardada", ""], historySnapshots.map(item => `<tr><td>${item.revision}</td><td>${esc(new Intl.DateTimeFormat("es-UY", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.created_at)))}</td><td><button class="text-button" data-restore-revision="${item.revision}" ${item.revision === cloudRevision || !cloudEnabled ? "disabled" : ""}>Recuperar</button></td></tr>`).join("")) : empty("Todavía no hay versiones disponibles.")}`);
  return `<div class="grid two">${section("Respaldo", `<p>Descargá una copia de tus datos o restaurá un respaldo de Cualitec.</p><div class="form-actions"><button id="export" class="primary">Descargar respaldo</button><label class="file-button">Importar respaldo<input id="import" type="file" accept="application/json,.json" hidden></label></div>`)}${section("Cuenta y almacenamiento", account)}</div>${history}`;
}

async function refreshHistory() {
  try { historySnapshots = await listCloudHistory(); historyStatus = ""; historyAvailable = true; }
  catch (error) { historySnapshots = []; historyStatus = `No se pudo cargar el historial: ${error.message}`; historyAvailable = false; }
  if (view === "data") render();
}

async function connectCloud() {
  session = await getSession();
  if (!session) { cloudEnabled = false; cloudPending = null; historySnapshots = []; historyStatus = ""; historyAvailable = false; render(); return; }
  const remote = await readCloud();
  cloudRevision = Number(remote?.revision || 0);
  if (remote && canonical(normalizeState(remote.data)) !== canonical(state)) {
    cloudPending = normalizeState(remote.data); cloudEnabled = false;
  } else if (!remote && Object.values(state).some(items => items.length)) {
    cloudPending = null; cloudEnabled = false;
  } else { cloudPending = null; cloudEnabled = true; }
  render();
  refreshHistory();
}

function render() {
  const titles = { dashboard: "Resumen", products: "Productos", purchases: "Compras", orders: "Pedidos", customers: "Clientes", sales: "Ventas", data: "Datos y respaldo" };
  document.querySelector("#view-title").textContent = titles[view];
  document.querySelector("#today").textContent = new Intl.DateTimeFormat("es-UY", { day: "numeric", month: "long", year: "numeric" }).format(new Date());
  document.querySelectorAll("[data-view]").forEach(button => button.classList.toggle("active", button.dataset.view === view));
  app.innerHTML = ({ dashboard, products, purchases, orders, customers, sales, data: dataView })[view]();
  if (view === "orders") syncOrderControls(document.querySelector("#order-form"));
}

function syncOrderControls(form, clearInactive = false) {
  if (!form) return;
  const discount = form.elements.discountType.value === "none", shipping = form.elements.shippingPayer.value !== "included_in_sale";
  if (clearInactive && discount) form.elements.discountValue.value = "0";
  if (clearInactive && shipping) form.elements.shippingAmount.value = "0";
  form.elements.discountValue.disabled = discount;
  form.elements.shippingAmount.disabled = shipping;
}

function addOrderProductByCode() {
  const input = document.querySelector("#order-code"), product = findProductByCode(state.products, input.value);
  if (!product) { toast("No se encontró un producto con ese código. Revisá el catálogo."); input.focus(); return; }
  const container = document.querySelector("#order-lines");
  const existing = [...container.querySelectorAll(".order-line")].find(row => row.querySelector('[name="productId"]').value === product.id && !row.hasAttribute("data-pristine"));
  if (existing) existing.querySelector('[name="quantity"]').value = Number(existing.querySelector('[name="quantity"]').value || 0) + 1;
  else {
    const pristine = container.querySelector('[data-pristine="true"]');
    if (pristine) pristine.outerHTML = orderLine({ productId: product.id, quantity: 1, unitPrice: product.price });
    else container.insertAdjacentHTML("beforeend", orderLine({ productId: product.id, quantity: 1, unitPrice: product.price }));
  }
  input.value = ""; input.focus(); toast(`${product.name}${product.variant ? ` · ${product.variant}` : ""} agregado al pedido.`);
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
    for (const [key, fallback] of [["discountType", "none"], ["discountValue", 0], ["shippingPayer", "recipient_on_delivery"], ["shippingAmount", 0], ["warrantyDays", 30]]) form.elements[key].value = item[key] ?? fallback;
    syncOrderControls(form);
    form.querySelector("#order-lines").innerHTML = item.lines.map(line => orderLine(line)).join("");
    form.scrollIntoView({ behavior: "smooth" });
  }
  if (target.id === "add-line") document.querySelector("#order-lines").insertAdjacentHTML("beforeend", orderLine());
  if (target.id === "add-by-code") addOrderProductByCode();
  if (target.classList.contains("remove-line")) { const container = target.closest("#order-lines"); if (container.children.length > 1) target.closest(".order-line").remove(); else toast("El pedido necesita al menos un producto."); }
  if (target.id === "clear-order") { const form = document.querySelector("#order-form"); form.reset(); form.elements.id.value = ""; form.querySelector("#order-lines").innerHTML = state.products.length ? orderLine() : ""; syncOrderControls(form, true); }
  if (target.id === "clear-sales-filters") { salesFilters = { from: "", to: "", channel: "" }; render(); }
  if (target.id === "clear-stock-filters") { stockFilters = { from: "", to: "", productId: "" }; render(); }
  if (target.id === "export-sales") {
    const report = salesReportCsv(state, filteredSales());
    const blob = new Blob(["\ufeff", report], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = `cualitec-ventas-${salesFilters.from || "inicio"}-${salesFilters.to || "hoy"}.csv`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (target.dataset.receipt) window.open(`receipt.html?sale=${encodeURIComponent(target.dataset.receipt)}`, "_blank", "noopener");
  if (target.dataset.deliver) {
    try { const next = deliverOrder(state, target.dataset.deliver, date()); persist(next); window.open(`receipt.html?sale=${encodeURIComponent(next.sales.at(-1).id)}`, "_blank", "noopener"); toast("Venta registrada. El comprobante está disponible en Ventas."); } catch (error) { toast(error.message); }
  }
  if (target.id === "export") {
    const blob = new Blob([JSON.stringify({ application: "Cualitec Gestión", version: 1, exportedAt: new Date().toISOString(), data: state }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = `cualitec-respaldo-${date()}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (target.id === "refresh-history") refreshHistory();
  if (target.dataset.restoreRevision) {
    const revision = Number(target.dataset.restoreRevision);
    if (!cloudEnabled || !historySnapshots.some(item => item.revision === revision)) { toast("Esa versión ya no está disponible."); return; }
    if (!confirm(`Se recuperará la versión ${revision} y reemplazará los datos actuales. El estado actual quedará en el historial. ¿Continuar?`)) return;
    saveQueue.then(async () => {
      const snapshot = normalizeState(await readCloudRevision(revision));
      const nextRevision = await writeCloud(snapshot, cloudRevision);
      state = snapshot; cloudRevision = nextRevision; cloudPending = null; cloudEnabled = true;
      localStorage.setItem(KEY, JSON.stringify(state));
      await refreshHistory(); render(); toast("Versión recuperada y sincronizada.");
    }).catch(error => toast(`No se pudo recuperar: ${error.message}`));
  }
  if (target.id === "logout") signOut().then(() => { session = null; cloudEnabled = false; cloudPending = null; render(); }).catch(error => toast(error.message));
  if (target.id === "load-cloud" && cloudPending && confirm("Los datos locales se reemplazarán por la versión de Supabase. Descargá un respaldo antes de continuar. ¿Cargar?")) {
    state = cloudPending; localStorage.setItem(KEY, JSON.stringify(state)); cloudPending = null; cloudEnabled = true; render();
  }
  if (target.id === "upload-local") writeCloud(state, cloudRevision).then(revision => { cloudRevision = revision; cloudEnabled = true; refreshHistory(); render(); toast("Datos subidos a Supabase."); }).catch(error => toast(error.message));
  if (target.id === "check-cloud") {
    target.disabled = true;
    saveQueue = saveQueue.then(async () => {
      const snapshot = structuredClone(state);
      cloudRevision = await writeCloud(snapshot, cloudRevision);
      await refreshHistory();
      const saved = await readCloud();
      if (Number(saved?.revision) !== cloudRevision || canonical(normalizeState(saved.data)) !== canonical(snapshot)) throw new Error("Los datos leídos no coinciden con los guardados.");
      cloudCheck = "Prueba correcta: Supabase guardó y devolvió los datos actuales.";
      render();
    }).catch(error => { cloudCheck = `No se pudo verificar: ${error.message}`; cloudEnabled = false; render(); });
  }
});

document.addEventListener("submit", async event => {
  if (event.target.getAttribute("id") === "stock-filter-form") {
    event.preventDefault(); const data = Object.fromEntries(new FormData(event.target));
    if (data.from && data.to && data.from > data.to) { toast("La fecha inicial debe ser anterior a la final."); return; }
    stockFilters = { from: data.from, to: data.to, productId: data.productId }; render(); return;
  }
  if (event.target.getAttribute("id") === "sales-filter-form") {
    event.preventDefault(); const data = Object.fromEntries(new FormData(event.target));
    if (data.from && data.to && data.from > data.to) { toast("La fecha inicial debe ser anterior a la final."); return; }
    salesFilters = { from: data.from, to: data.to, channel: data.channel }; render(); return;
  }
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
      const otherProducts = state.products.filter(item => item.id !== product.id);
      if (product.barcode && findProductByCode(otherProducts, product.barcode)) throw new Error("Ese código ya está asignado a otro producto.");
      if (product.sku && findProductByCode(otherProducts, product.sku)) throw new Error("Ese SKU ya está asignado a otra variante.");
      if (state.products.some(item => item.id !== product.id && item.name.trim().toLowerCase() === product.name.toLowerCase() && (item.variant || "").trim().toLowerCase() === product.variant.toLowerCase())) throw new Error("Ese producto y variante ya existen.");
      persist({ ...state, products: previous ? state.products.map(item => item.id === previous.id ? product : item) : [...state.products, product] });
    } else if (formId === "purchase-form") persist(addPurchase(state, { id: id("purchase"), ...data }));
    else if (formId === "adjust-form") persist(adjustStock(state, { id: id("adjustment"), ...data, date: new Date().toISOString() }));
    else if (formId === "payment-form") { persist(recordPayment(state, { id: id("payment"), ...data, note: data.note.trim() })); toast("Movimiento registrado."); return; }
    else {
      const previous = state.orders.find(item => item.id === data.id);
      if (previous?.status === "delivered") throw new Error("Una venta entregada no se puede modificar.");
      const lines = [...form.querySelectorAll(".order-line")].map(row => ({ productId: row.querySelector('[name="productId"]').value, quantity: Number(row.querySelector('[name="quantity"]').value), unitPrice: Number(row.querySelector('[name="unitPrice"]').value) }));
      const order = { id: data.id || id("order"), customerName: data.customerName.trim(), contact: data.contact.trim(), channel: data.channel, status: data.status, deposit: Number(previous?.deposit || 0), discountType: data.discountType, discountValue: Number(data.discountValue || 0), deliveryMethod: data.deliveryMethod, shippingPayer: data.shippingPayer, shippingAmount: Number(data.shippingAmount || 0), warrantyDays: Number(data.warrantyDays), trackingCode: data.trackingCode.trim(), deliveryDate: data.deliveryDate, notes: data.notes.trim(), createdAt: previous?.createdAt || new Date().toISOString(), lines };
      persist(saveOrder(state, order));
    }
    toast("Guardado correctamente.");
  } catch (error) { toast(error.message); }
});

document.addEventListener("change", async event => {
  if (event.target.closest(".order-line")) event.target.closest(".order-line").removeAttribute("data-pristine");
  if (["discountType", "shippingPayer"].includes(event.target.name) && event.target.closest("#order-form")) syncOrderControls(event.target.form, true);
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
document.addEventListener("input", event => {
  if (event.target.closest(".order-line")) event.target.closest(".order-line").removeAttribute("data-pristine");
  if (event.target.id === "product-search") {
    const query = event.target.value.trim().toLowerCase();
    const rows = [...document.querySelectorAll("[data-product-row]")];
    rows.forEach(row => { row.hidden = !row.dataset.search.includes(query); });
    document.querySelector("#product-search-empty").hidden = rows.some(row => !row.hidden);
  }
});
document.addEventListener("keydown", event => {
  if (event.target.id === "order-code" && event.key === "Enter") { event.preventDefault(); addOrderProductByCode(); }
});
render();
connectCloud().catch(error => toast(`No se pudo consultar Supabase: ${error.message}`));

