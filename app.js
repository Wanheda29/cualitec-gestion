import { emptyState, normalizeState, orderStatuses, paymentMethods, discountTypes, availableQuantity, findProductByCode, addPurchase, adjustStock, saveOrder, deliverOrder, recordQuickSale, orderTotal, paidAmount, recordPayment, monthlySummary, stockMovements, paymentMovements, dailyPending } from "./domain.js?v=quick-sale-20261010";
import { isCloudConfigured, signIn, signOut, updatePassword, getSession, readCloud, writeCloud, listCloudHistory, readCloudRevision } from "./cloud.js?v=aftersales-20261002";
import { salesReportCsv, paymentReportCsv, salesVisualSummary } from "./reports.js?v=charts-20261010";
import { messageTypes, orderMessage, whatsappPhone, whatsappUrl } from "./messages.js?v=aftersales-20261002";
import { caseTypes, caseStatuses, warrantyInfo, saveServiceCase } from "./aftersales.js?v=aftersales-20261002";
import { canonical, fingerprint, syncDecision, mergeIndependentChanges } from "./sync.js?v=merge-20261010";
import { catalogCsvTemplate, parseCatalogCsv, validateCatalogRows, importCatalogRows } from "./catalog-import.js?v=catalog-import-20261010";

const KEY = "cualitec-gestion-v1";
const SYNC_KEY = "cualitec-sync-v1";
let state;
try { state = normalizeState(JSON.parse(localStorage.getItem(KEY)) || emptyState); }
catch { state = structuredClone(emptyState); }
let syncMeta;
try { syncMeta = JSON.parse(localStorage.getItem(SYNC_KEY)) || null; }
catch { syncMeta = null; }
let view = "dashboard";
let selectedOrderId = null;
let selectedCaseId = null, caseSaleId = null;
let session = null, cloudRevision = 0, cloudEnabled = false, cloudPending = null;
let cloudCheck = "";
let syncStatus = "checking", draftDirty = false, refreshPromise = null, pendingWrites = 0;
let salesFilters = { from: "", to: "", channel: "" };
let paymentFilters = { from: "", to: "", method: "" };
let stockFilters = { from: "", to: "", productId: "" };
let catalogPreview = null;
let historySnapshots = [], historyStatus = "", historyAvailable = false;
let saveQueue = Promise.resolve();
const app = document.querySelector("#app");
const money = value => new Intl.NumberFormat("es-UY", { style: "currency", currency: "UYU", maximumFractionDigits: 2 }).format(Number(value || 0));
const monthLabel = month => new Intl.DateTimeFormat("es-UY", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
const date = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; };
const id = prefix => `${prefix}_${crypto.randomUUID()}`;
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const syncLabels = { checking: "Consultando nube", saving: "Guardando", synced: "Sincronizado", offline: "Sin conexión", conflict: "Conflicto", remote_available: "Nueva versión disponible", local: "Solo en este navegador" };
const setSyncStatus = status => {
  syncStatus = status;
  const badge = document.querySelector("#sync-status");
  badge.textContent = syncLabels[status]; badge.className = `sync-status ${status}`;
  const description = document.querySelector("#sync-description");
  if (description) description.textContent = syncLabels[status];
};
const hasData = value => Object.values(value).some(items => Array.isArray(items) && items.length);
const acknowledge = async (snapshot, revision) => {
  syncMeta = { userId: session.user.id, revision, hash: await fingerprint(snapshot) };
  localStorage.setItem(SYNC_KEY, JSON.stringify(syncMeta));
};
const persist = next => {
  state = next; localStorage.setItem(KEY, JSON.stringify(state)); render();
  if (cloudEnabled) {
    const snapshot = structuredClone(next);
    pendingWrites++; setSyncStatus("saving");
    saveQueue = saveQueue.then(async () => {
      const revision = await writeCloud(snapshot, cloudRevision);
      cloudRevision = revision; await acknowledge(snapshot, revision);
      if (view === "data") await refreshHistory();
    }).catch(error => {
      cloudEnabled = false;
      setSyncStatus(error.message.includes("VERSION_CONFLICT") ? "conflict" : "offline");
      toast("No se guardó en Supabase. Los cambios siguen en este navegador; revisá la sincronización.");
      if (error.message.includes("VERSION_CONFLICT")) setTimeout(() => refreshCloud(), 0);
    }).finally(() => { pendingWrites--; if (cloudEnabled && !pendingWrites) setSyncStatus("synced"); });
  } else if (session && syncStatus !== "conflict" && syncStatus !== "remote_available") setSyncStatus("offline");
  else if (!session) setSyncStatus("local");
  if (session && syncStatus === "remote_available") setTimeout(() => refreshCloud(), 0);
};
const toast = message => { const target = document.querySelector("#toast"); target.textContent = message; target.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => target.classList.remove("show"), 4000); };
const option = (value, label, selected = false) => `<option value="${esc(value)}" ${selected ? "selected" : ""}>${esc(label)}</option>`;
const productOptions = selected => state.products.map(item => option(item.id, `${item.name}${item.variant ? ` · ${item.variant}` : ""}`, item.id === selected)).join("");
const productName = productId => { const item = state.products.find(product => product.id === productId); return item ? `${item.name}${item.variant ? ` · ${item.variant}` : ""}` : "Producto eliminado"; };
const orderLine = (line = {}) => `<div class="order-line" ${Object.keys(line).length ? "" : 'data-pristine="true"'}><label>Producto / variante<select name="productId" required>${productOptions(line.productId)}</select></label><label>Cantidad<input name="quantity" type="number" min="1" step="1" value="${esc(line.quantity ?? 1)}" required></label><label>Precio unitario<input name="unitPrice" type="number" min="0" step="0.01" value="${esc(line.unitPrice ?? state.products.find(item => item.id === (line.productId || state.products[0]?.id))?.price ?? "")}" required></label><button class="text-button remove-line" type="button">Quitar</button></div>`;
const quickProducts = () => state.products.filter(item => availableQuantity(state, item.id) > 0);
const quickSaleLine = (line = {}) => {
  const products = quickProducts(), selected = line.productId || products[0]?.id;
  return `<div class="order-line" ${Object.keys(line).length ? "" : 'data-pristine="true"'}><label>Producto / variante<select name="productId" required>${products.map(item => option(item.id, `${item.name}${item.variant ? ` · ${item.variant}` : ""} · ${availableQuantity(state, item.id)} disp.`, item.id === selected)).join("")}</select></label><label>Cantidad<input name="quantity" type="number" min="1" step="1" value="${esc(line.quantity ?? 1)}" required></label><label>Precio unitario<input name="unitPrice" type="number" min="0" step="0.01" value="${esc(line.unitPrice ?? state.products.find(item => item.id === selected)?.price ?? "")}" required></label><button class="text-button remove-line" type="button">Quitar</button></div>`;
};
const section = (title, body, action = "") => `<section class="panel"><div class="panel-head"><h2>${title}</h2>${action}</div>${body}</section>`;
const empty = label => `<p class="empty">${label}</p>`;
const badge = (label, tone = "") => `<span class="badge${/^[a-z-]+$/.test(tone) ? ` badge--${tone}` : ""}">${esc(label)}</span>`;
const rows = (headers, body) => `<div class="table-region">${headers.length >= 5 ? '<p class="table-scroll-hint">Deslizá la tabla para ver todas las columnas →</p>' : ""}<div class="table-wrap ${headers.length >= 9 ? "table-huge" : headers.length >= 7 ? "table-extra-wide" : headers.length >= 5 ? "table-wide" : ""}"><table><thead><tr>${headers.map(x => `<th>${x}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div></div>`;
const reportBars = (items, kind) => {
  if (!items.length) return empty("No hay ventas para mostrar con estos filtros.");
  const scale = kind === "months" ? Math.max(1, ...items.map(item => item.total)) : Math.max(1, items.reduce((sum, item) => sum + item.total, 0));
  return `<ol class="report-bars ${kind}">${items.map(item => {
    const width = Math.max(0, Math.min(100, Math.round(item.total / scale * 100)));
    return `<li><div class="report-bar-info"><strong>${esc(kind === "months" ? monthLabel(item.key) : item.key)}</strong><span>${money(item.total)}</span></div><div class="report-bar-track" aria-hidden="true"><span style="width:${width}%"></span></div><small>${item.count} ${item.count === 1 ? "venta" : "ventas"}</small></li>`;
  }).join("")}</ol>`;
};

function dashboard() {
  const month = date().slice(0, 7), summary = monthlySummary(state, month);
  const pending = state.orders.filter(item => !["delivered", "cancelled"].includes(item.status));
  const low = state.products.filter(item => Number(item.stock) <= Number(item.minStock || 0));
  const attention = dailyPending(state, date());
  const attentionCount = attention.today.length + attention.overdue.length + attention.unpaid.length + attention.stocked.length;
  const groups = [
    ["Entregas de hoy", attention.today, "No hay entregas previstas para hoy."],
    ["Entregas atrasadas", attention.overdue, "No hay entregas atrasadas."],
    ["Saldos por cobrar", attention.unpaid, "No hay ventas entregadas con saldo pendiente."],
    ["Encargos con stock disponible", attention.stocked, "No hay encargos con stock suficiente."]
  ];
  const pendingPanels = groups.map(([title, orders, message]) => `<article class="pending-group"><h3>${title} <span class="badge">${orders.length}</span></h3>${orders.length ? rows(["Cliente / productos", "Entrega", "Saldo", ""], orders.map(item => `<tr><td><strong>${esc(item.customerName)}</strong><small>${item.lines.map(line => `${esc(productName(line.productId))} × ${esc(line.quantity)}`).join("<br>")}</small></td><td>${esc(item.deliveryDate || "Sin fecha")}<small>${item.deliveryMethod === "dac" ? "DAC" : "Montevideo"}</small></td><td>${money(orderTotal(item) - paidAmount(state, item.id))}</td><td><button class="text-button" data-open-order="${esc(item.id)}" aria-label="Ver pedido de ${esc(item.customerName)}">Ver pedido</button></td></tr>`).join("")) : empty(message)}</article>`).join("");
  return `<div class="hero"><div class="hero-copy"><span class="eyebrow">PANEL DE CUALITEC</span><h2>Tu negocio, al día.</h2><p>Pedidos, stock y resultados de tus ventas por redes, en un solo lugar.</p></div><div class="hero-actions"><button class="primary" data-view="quick-sale">+ Venta rápida</button><button class="hero-link" data-view="orders">Nuevo pedido</button><span>${attentionCount} ${attentionCount === 1 ? "aviso" : "avisos"} para revisar</span></div></div>
    <div class="stats dashboard-stats"><article class="stat-card stat-sales"><span>Ventas del mes</span><strong>${money(summary.revenue)}</strong><small>${summary.sales} operaciones</small></article><article class="stat-card stat-margin"><span>Margen de productos</span><strong>${money(summary.revenue - summary.shipping - summary.cost)}</strong><small>Ventas menos costo de mercadería y envíos</small></article><article class="stat-card stat-orders"><span>Pedidos activos</span><strong>${pending.length}</strong><small>Por atender o entregar</small></article><article class="stat-card stat-stock"><span>Stock bajo</span><strong>${low.length}</strong><small>Productos para reponer</small></article></div>
    ${section("Pendientes de hoy", `<p class="form-hint">Entregas, cobros y encargos que necesitan atención. Un pedido puede aparecer en más de un grupo. El stock de cada encargo se comprueba por separado y todavía no queda reservado.</p><div class="grid two">${pendingPanels}</div>`)}
    <div class="grid two">${section("Pedidos en curso", pending.length ? rows(["Cliente", "Productos", "Estado", "Entrega"], pending.slice(-5).reverse().map(item => `<tr><td>${esc(item.customerName)}</td><td>${item.lines.map(line => `${esc(productName(line.productId))} × ${line.quantity}`).join("<br>")}</td><td>${badge(orderStatuses[item.status], item.status)}</td><td>${esc(item.deliveryDate || "Sin fecha")}</td></tr>`).join("")) : empty("Todavía no hay pedidos activos."))}
    ${section("Reponer pronto", low.length ? rows(["Producto", "En stock", "Disponible"], low.map(item => `<tr><td>${esc(item.name)}</td><td>${item.stock}</td><td>${availableQuantity(state, item.id)}</td></tr>`).join("")) : empty("El inventario está por encima de los mínimos."))}</div>`;
}

function products() {
  const form = `<form id="product-form" class="form-grid"><input name="id" type="hidden"><label>Producto o modelo<input name="name" required placeholder="Ej. Auriculares inalámbricos"></label><label>Categoría<input name="category" placeholder="Ej. Audio"></label><label>Variante (color, capacidad…)<input name="variant" placeholder="Ej. Negro · 128 GB"></label><label>Código de barras de esta variante<input name="barcode" inputmode="numeric" placeholder="Opcional"></label><label>SKU de esta variante<input name="sku" placeholder="Opcional"></label><label>Precio de venta<input name="price" type="number" min="0" step="0.01" required></label><label>Stock mínimo<input name="minStock" type="number" min="0" step="1" value="0" required></label><p class="form-hint wide">Creá un registro por cada color o capacidad. Cada variante tiene stock, precio y códigos propios.</p><div class="form-actions"><button class="primary">Guardar variante</button><button type="reset" class="secondary">Limpiar</button></div></form>`;
  const stockUnits = state.products.reduce((sum, item) => sum + Number(item.stock || 0), 0);
  const availableUnits = state.products.reduce((sum, item) => sum + availableQuantity(state, item.id), 0);
  const toRestock = state.products.filter(item => Number(item.stock || 0) <= Number(item.minStock || 0)).length;
  const summary = `<div class="stats inventory-stats"><article class="stat-card"><span>Variantes</span><strong>${state.products.length}</strong><small>En el catálogo</small></article><article class="stat-card"><span>Unidades en stock</span><strong>${stockUnits}</strong><small>Existencia física</small></article><article class="stat-card"><span>Unidades disponibles</span><strong>${availableUnits}</strong><small>Descontadas las reservas</small></article><article class="stat-card stat-stock"><span>Para reponer</span><strong>${toRestock}</strong><small>En el mínimo o por debajo</small></article></div>`;
  const table = state.products.length ? rows(["Producto", "Código de barras", "Stock", "Disponible", "Estado", "Costo prom.", "Precio", ""], state.products.map(item => {
    const stock = Number(item.stock || 0), available = availableQuantity(state, item.id);
    const restock = stock <= Number(item.minStock || 0);
    const status = stock <= 0 ? badge("Sin stock", "stock-empty") : restock ? badge("Reponer", "stock-low") : available <= 0 ? badge("Todo reservado", "stock-reserved") : badge("Disponible", "stock-available");
    return `<tr data-product-row data-restock="${restock}" data-unavailable="${available <= 0}" data-search="${esc([item.name, item.category, item.variant, item.barcode, item.sku].join(" ").toLowerCase())}"><td><strong>${esc(item.name)}</strong><small>${esc([item.category, item.variant].filter(Boolean).join(" · "))}</small></td><td>${esc(item.barcode || item.sku || "—")}</td><td>${stock}</td><td>${available}</td><td>${status}</td><td>${money(item.averageCost)}</td><td>${money(item.price)}</td><td><div class="row-actions"><button class="text-button" data-edit-product="${esc(item.id)}">Editar</button><button class="text-button" data-restock-product="${esc(item.id)}">Registrar entrada</button></div></td></tr>`;
  }).join("")) : empty("Agregá el primer producto de Cualitec.");
  const importer = `<p class="form-hint">Descargá la plantilla CSV, completá una fila por variante y elegí el archivo para revisar los datos. Se agregan productos nuevos; no se reemplazan los existentes. Si cargás stock inicial, indicá su costo unitario: quedará registrado como entrada de mercadería.</p><div class="form-actions"><button id="catalog-template" class="secondary" type="button">Descargar plantilla CSV</button><label class="file-button">Elegir CSV<input id="catalog-csv" type="file" accept=".csv,text/csv" hidden></label></div><div id="catalog-import-preview">${catalogPreviewMarkup()}</div>`;
  return `${summary}${section("Catálogo", `<p class="form-hint inventory-note">Disponible = stock físico menos unidades reservadas. «Reponer» se basa en el stock mínimo de cada variante.</p><label class="catalog-search">Buscar por nombre, código de barras o SKU<input id="product-search" autocomplete="off" placeholder="Escribí o escaneá un código"></label><div class="inventory-filters" role="group" aria-label="Filtrar productos"><button type="button" class="inventory-filter active" data-inventory-filter="all" aria-pressed="true">Todos</button><button type="button" class="inventory-filter" data-inventory-filter="restock" aria-pressed="false">Para reponer</button><button type="button" class="inventory-filter" data-inventory-filter="unavailable" aria-pressed="false">Sin disponibilidad</button></div><p id="product-search-empty" class="empty" hidden>No hay productos para esa búsqueda o filtro.</p>${table}`, '<button id="new-product" class="secondary" type="button">+ Agregar producto</button>')}${section("Agregar o editar producto", form)}${section("Importar catálogo desde CSV", importer)}`;
}

function catalogPreviewMarkup() {
  if (!catalogPreview) return "";
  const { name, rows: items } = catalogPreview;
  const units = items.reduce((sum, item) => sum + item.stock, 0);
  const preview = rows(["Producto / variante", "Código / SKU", "Precio", "Stock inicial", "Costo unitario"], items.slice(0, 30).map(item => `<tr><td><strong>${esc(item.name)}</strong><small>${esc([item.category, item.variant].filter(Boolean).join(" · "))}</small></td><td>${esc(item.barcode || item.sku || "—")}</td><td>${money(item.price)}</td><td>${item.stock}</td><td>${money(item.unitCost)}</td></tr>`).join(""));
  return `<div class="catalog-preview"><h3>Vista previa · ${items.length} ${items.length === 1 ? "variante" : "variantes"}</h3><p class="form-hint">${esc(name)} · ${units} unidades iniciales${items.length > 30 ? " · se muestran las primeras 30 filas" : ""}</p>${preview}<div class="form-actions"><button id="confirm-catalog-import" class="primary" type="button">Importar ${items.length} ${items.length === 1 ? "variante" : "variantes"}</button><button id="cancel-catalog-import" class="secondary" type="button">Cancelar</button></div></div>`;
}

function filterProducts() {
  const query = document.querySelector("#product-search")?.value.trim().toLowerCase() || "";
  const filter = document.querySelector("[data-inventory-filter].active")?.dataset.inventoryFilter || "all";
  const entries = [...document.querySelectorAll("[data-product-row]")];
  entries.forEach(row => { row.hidden = !row.dataset.search.includes(query) || (filter === "restock" && row.dataset.restock !== "true") || (filter === "unavailable" && row.dataset.unavailable !== "true"); });
  const message = document.querySelector("#product-search-empty");
  if (message) message.hidden = !entries.length || entries.some(row => !row.hidden);
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

function quickSale() {
  const available = quickProducts().length;
  const form = `<form id="quick-sale-form" class="form-grid"><label>Cliente<input name="customerName" required placeholder="Nombre del cliente"></label><label>Contacto / usuario de red<input name="contact" required placeholder="Teléfono o @usuario"></label><label>Canal<select name="channel">${["Instagram", "WhatsApp", "Facebook", "Otro"].map(item => option(item, item)).join("")}</select></label><label>Fecha de venta<input name="saleDate" type="date" value="${date()}" required></label><div class="wide"><label>Código de barras o SKU<input id="quick-sale-code" autocomplete="off" placeholder="Escribí o escaneá el código"></label><div class="form-actions"><button id="quick-add-by-code" class="secondary" type="button" ${available ? "" : "disabled"}>Agregar por código</button></div></div><div class="wide"><div id="quick-sale-lines" class="order-lines">${available ? quickSaleLine() : ""}</div><button id="quick-add-line" class="secondary" type="button" ${available ? "" : "disabled"}>Agregar producto</button></div><label>Descuento manual<select name="discountType">${Object.entries(discountTypes).map(([key, value]) => option(key, value)).join("")}</select></label><label>Valor del descuento<input name="discountValue" type="number" min="0" step="0.01" value="0" required></label><label>Entrega<select name="deliveryMethod"><option value="montevideo">Montevideo · en el día</option><option value="dac">Interior · DAC</option></select></label><label>Envío<select name="shippingPayer"><option value="recipient_on_delivery">Destinatario paga al recibir</option><option value="included_in_sale">Cualitec cobra el envío</option></select></label><label>Cargo de envío<input name="shippingAmount" type="number" min="0" step="0.01" value="0" required></label><label>Garantía (días)<input name="warrantyDays" type="number" min="0" step="1" value="30" required></label><label>Importe cobrado ahora<input name="paymentAmount" type="number" min="0" step="0.01" value="0" required></label><label>Medio de pago<select name="paymentMethod">${Object.entries(paymentMethods).map(([key, value]) => option(key, value)).join("")}</select></label><p class="form-hint wide">Si todavía no cobraste, dejá el importe en 0. Podés registrar el cobro más adelante desde Pedidos. Usá esta opción cuando la mercadería ya fue entregada; para entregas pendientes, creá un pedido.</p><div class="quick-sale-total wide" aria-live="polite"><span>Total estimado <strong id="quick-sale-total">${money(0)}</strong></span><span>Saldo luego del cobro <strong id="quick-sale-balance">${money(0)}</strong></span></div><div class="form-actions"><button class="primary" ${available ? "" : "disabled"}>Registrar venta y abrir comprobante</button><button id="clear-quick-sale" class="secondary" type="button">Limpiar</button></div></form>`;
  return `${section("Venta rápida", `<p class="form-hint">Registra una venta entregada con stock disponible y genera el comprobante. Las unidades reservadas para otros pedidos no aparecen como disponibles.</p>${available ? "" : '<p class="empty">No hay productos con unidades disponibles. Registrá una entrada de mercadería en Compras.</p>'}${form}`)}`;
}

function syncQuickSaleTotal() {
  const form = document.querySelector("#quick-sale-form");
  if (!form) return;
  const lines = [...form.querySelectorAll(".order-line")].map(row => ({ productId: row.querySelector('[name="productId"]').value, quantity: Number(row.querySelector('[name="quantity"]').value || 0), unitPrice: Number(row.querySelector('[name="unitPrice"]').value || 0) }));
  const total = orderTotal({ lines, discountType: form.elements.discountType.value, discountValue: Number(form.elements.discountValue.value || 0), shippingPayer: form.elements.shippingPayer.value, shippingAmount: Number(form.elements.shippingAmount.value || 0) });
  const paid = Number(form.elements.paymentAmount.value || 0);
  document.querySelector("#quick-sale-total").textContent = money(total);
  document.querySelector("#quick-sale-balance").textContent = money(Math.max(0, total - paid));
}

function selectedOrderDetails() {
  const order = state.orders.find(item => item.id === selectedOrderId);
  if (!order) return "";
  return section("Pedido seleccionado", `<div id="selected-order" tabindex="-1"><h3>${esc(order.customerName)}</h3><p>${esc(order.contact)} · ${esc(order.channel)} · ${badge(orderStatuses[order.status], order.status)}</p>${rows(["Producto", "Cantidad", "Precio unitario"], order.lines.map(line => `<tr><td>${esc(productName(line.productId))}</td><td>${esc(line.quantity)}</td><td>${money(line.unitPrice)}</td></tr>`).join(""))}<p>Total: <strong>${money(orderTotal(order))}</strong> · Cobrado: ${money(paidAmount(state, order.id))} · Saldo: <strong>${money(orderTotal(order) - paidAmount(state, order.id))}</strong></p><p>Entrega: ${esc(order.deliveryDate || "Sin fecha")} · ${order.deliveryMethod === "dac" ? "DAC" : "Montevideo"}${order.trackingCode ? ` · Guía: ${esc(order.trackingCode)}` : ""}</p>${order.notes ? `<p>Notas: ${esc(order.notes)}</p>` : ""}<div class="form-actions">${!["delivered", "cancelled"].includes(order.status) ? `<button class="secondary" data-edit-order="${esc(order.id)}">Editar pedido</button>` : ""}<button class="primary" data-order-payment="${esc(order.id)}">Registrar cobro o devolución</button></div></div>`);
}

function messageComposer() {
  const order = state.orders.find(item => item.id === selectedOrderId);
  if (!order) return "";
  const phone = whatsappPhone(order.contact);
  const types = Object.entries(messageTypes).filter(([type]) => type === "detail" || (order.status !== "cancelled" && (type !== "balance" || Math.round((orderTotal(order) - paidAmount(state, order.id)) * 100) > 0)));
  return section("Mensaje para el cliente", `<div class="form-grid"><label>Tipo de mensaje<select id="message-kind">${types.map(([value, label]) => option(value, label)).join("")}</select></label><label>Teléfono para WhatsApp<input id="message-phone" type="tel" value="${esc(phone ? `+${phone}` : "")}" placeholder="Ej. 099 123 456 o +598 99 123 456"></label><p class="form-hint wide" id="message-destination">${phone ? `Se abrirá WhatsApp para +${phone}.` : "Para WhatsApp, ingresá un celular uruguayo o un teléfono con código de país. Si el contacto es un usuario de Instagram, podés copiar el mensaje."}</p><label class="wide">Texto para revisar y editar<textarea id="order-message" rows="12">${esc(orderMessage(state, order.id))}</textarea></label><p class="form-hint wide">Revisá el destinatario y el texto. Abrir WhatsApp prepara el mensaje; vos decidís cuándo enviarlo. Las ediciones de este texto son temporales.</p><div class="form-actions"><button class="secondary" id="copy-order-message">Copiar mensaje</button><button class="primary" id="open-order-whatsapp" ${phone ? "" : "disabled"}>Abrir WhatsApp</button></div></div>`);
}

function updateMessageDestination() {
  const text = document.querySelector("#order-message"), phone = document.querySelector("#message-phone");
  if (!text || !phone) return;
  const number = whatsappPhone(phone.value);
  document.querySelector("#open-order-whatsapp").disabled = !whatsappUrl(phone.value, text.value);
  document.querySelector("#message-destination").textContent = number ? `Se abrirá WhatsApp para +${number}.` : "Ingresá un celular uruguayo o un teléfono con código de país. También podés copiar el mensaje.";
}

function orders() {
  const form = `<form id="order-form" class="form-grid"><input name="id" type="hidden"><label>Cliente<input name="customerName" required></label><label>Contacto / usuario de red<input name="contact" required placeholder="Teléfono o @usuario"></label><label>Canal<select name="channel">${["Instagram", "WhatsApp", "Facebook", "Otro"].map(x => option(x, x)).join("")}</select></label><label>Estado<select name="status">${Object.entries(orderStatuses).filter(([key]) => key !== "delivered").map(([key, value]) => option(key, value)).join("")}</select></label><div class="wide"><label>Código de barras o SKU<input id="order-code" autocomplete="off" placeholder="Escribí o escaneá el código"></label><div class="form-actions"><button id="add-by-code" class="secondary" type="button">Agregar por código</button></div><p class="form-hint">El lector escribe el código aquí como si fuera un teclado. También podés ingresarlo a mano y pulsar Enter.</p></div><div class="wide"><div id="order-lines" class="order-lines">${state.products.length ? orderLine() : ""}</div><button id="add-line" class="secondary" type="button" ${state.products.length ? "" : "disabled"}>Agregar producto</button></div><label>Descuento manual<select name="discountType">${Object.entries(discountTypes).map(([key, value]) => option(key, value)).join("")}</select></label><label>Valor del descuento<input name="discountValue" type="number" min="0" step="0.01" value="0" required></label><label>Entrega<select name="deliveryMethod"><option value="montevideo">Montevideo · en el día</option><option value="dac">Interior · DAC</option></select></label><label>Fecha prevista de entrega<input name="deliveryDate" type="date"></label><label>Envío<select name="shippingPayer"><option value="recipient_on_delivery">Destinatario paga al recibir</option><option value="included_in_sale">Cualitec cobra el envío</option></select></label><label>Cargo de envío<input name="shippingAmount" type="number" min="0" step="0.01" value="0" required></label><label>Garantía (días)<input name="warrantyDays" type="number" min="0" step="1" value="30" required></label><label>Guía DAC<input name="trackingCode" placeholder="Opcional"></label><label class="wide">Notas<textarea name="notes" rows="2" placeholder="Dirección, acuerdos, preferencias..."></textarea></label><p class="form-hint wide">Descuento y cargo de envío se ingresan manualmente. Por defecto, el destinatario paga el envío al recibir y no se suma a la venta.</p><div class="form-actions"><button class="primary" ${state.products.length ? "" : "disabled"}>Guardar pedido</button><button id="clear-order" class="secondary" type="button">Limpiar</button></div></form>`;
  const table = state.orders.length ? rows(["Cliente", "Productos", "Canal", "Estado", "Total / saldo", "Entrega", "Acciones"], [...state.orders].reverse().map(item => `<tr><td><strong>${esc(item.customerName)}</strong><small>${esc(item.contact)}</small></td><td>${item.lines.map(line => `${esc(productName(line.productId))} × ${line.quantity}`).join("<br>")}</td><td>${esc(item.channel)}</td><td>${badge(orderStatuses[item.status], item.status)}</td><td>${money(orderTotal(item))}<small>${item.status === "cancelled" ? `A devolver ${money(paidAmount(state, item.id))}` : `Cobrado ${money(paidAmount(state, item.id))} · Saldo ${money(orderTotal(item) - paidAmount(state, item.id))}`}</small></td><td>${item.deliveryMethod === "dac" ? "DAC" : "Montevideo"}<small>${esc(item.deliveryDate || "Sin fecha")}${item.trackingCode ? ` · ${esc(item.trackingCode)}` : ""}</small></td><td><div class="row-actions"><button class="text-button" data-open-order="${esc(item.id)}">Ver pedido</button>${item.status !== "delivered" ? `<button class="text-button" data-edit-order="${esc(item.id)}">Editar</button>` : ""}${!["delivered", "cancelled"].includes(item.status) ? `<button class="text-button" data-deliver="${esc(item.id)}">Entregar</button>` : ""}</div></td></tr>`).join("")) : empty("Registrá consultas o pedidos que llegan por redes.");
  const paymentForm = `<form id="payment-form" class="form-grid"><label>Pedido<select name="orderId" required>${state.orders.map(item => option(item.id, `${item.customerName} · ${money(orderTotal(item))}`)).join("")}</select></label><label>Movimiento<select name="kind"><option value="payment">Cobro</option><option value="refund">Devolución de dinero</option></select></label><label>Importe<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Medio de pago<select name="method">${Object.entries(paymentMethods).map(([key, value]) => option(key, value)).join("")}</select></label><label>Fecha<input name="date" type="date" value="${date()}" required></label><label>Referencia / nota<input name="note" placeholder="Opcional"></label><div class="form-actions"><button class="primary" ${state.orders.length ? "" : "disabled"}>Registrar movimiento</button></div></form>`;
  const legacyDeposits = state.orders.filter(item => Number(item.deposit || 0) > 0).map(item => ({ id: `legacy_${item.id}`, orderId: item.id, date: item.createdAt?.slice(0, 10) || "—", amount: Number(item.deposit), kind: "payment", method: "Seña anterior", note: "Registrada antes del historial de pagos" }));
  const movements = [...legacyDeposits, ...(state.payments || [])];
  const history = movements.length ? rows(["Fecha", "Pedido", "Movimiento", "Medio", "Importe", "Nota"], [...movements].reverse().map(item => `<tr><td>${esc(item.date)}</td><td>${esc(state.orders.find(order => order.id === item.orderId)?.customerName || "Pedido eliminado")}</td><td>${item.kind === "refund" ? "Devolución" : "Cobro"}</td><td>${esc(paymentMethods[item.method] || item.method)}</td><td>${item.kind === "refund" ? "−" : "+"}${money(item.amount)}</td><td>${esc(item.note || "—")}</td></tr>`).join("")) : empty("Los cobros y devoluciones aparecerán aquí.");
  return `${section("Pedidos", table, '<button id="new-order" class="secondary" type="button">+ Nuevo pedido</button>')}${section("Nuevo pedido", form)}<div class="grid two">${section("Cobros y devoluciones", paymentForm)}${section("Historial de pagos", history)}</div>`;
}

function aftersales() {
  const current = state.serviceCases.find(item => item.id === selectedCaseId);
  const sale = state.sales.find(item => item.id === (current?.saleId || caseSaleId)) || state.sales.at(-1);
  const salesTable = state.sales.length ? rows(["Venta / cliente", "Productos", "Plazo registrado", "", ""], [...state.sales].reverse().map(item => {
    const info = warrantyInfo(state, item, date());
    const contact = item.contact || state.orders.find(order => order.id === item.orderId)?.contact || "";
    return `<tr data-warranty-row data-search="${esc([item.receiptNumber, item.customerName, contact, ...item.lines.map(line => line.productName)].join(" ").toLowerCase())}"><td><strong>${esc(item.receiptNumber || item.id)}</strong><small>${esc(item.customerName)} · ${esc(contact)}<br>Venta: ${esc(item.date)}</small></td><td>${item.lines.map(line => `${esc(line.productName)} × ${esc(line.quantity)}`).join("<br>")}</td><td>${badge(info.status, info.remaining === null ? "neutral" : info.remaining < 0 ? "expired" : "covered")}<small>${info.end ? `${info.days} días · Hasta ${esc(info.end)}` : "Según condiciones registradas"}</small></td><td><button class="text-button" data-start-case="${esc(item.id)}">Registrar caso</button></td><td><button class="text-button" data-receipt="${esc(item.id)}">Comprobante</button></td></tr>`;
  }).join("")) : empty("Las ventas entregadas aparecerán aquí.");
  const form = `<form id="service-case-form" class="form-grid"><input name="id" type="hidden" value="${esc(current?.id || "")}"><label>Venta<select name="saleId" required ${current ? "disabled" : ""}>${state.sales.map(item => option(item.id, `${item.receiptNumber || item.id} · ${item.customerName}`, item.id === sale?.id)).join("")}</select></label><label>Producto de la venta<select name="productId" required ${current ? "disabled" : ""}>${(sale?.lines || []).map(line => option(line.productId, line.productName, line.productId === current?.productId)).join("")}</select></label><label>Tipo<select name="type">${Object.entries(caseTypes).map(([key, label]) => option(key, label, key === (current?.type || "warranty"))).join("")}</select></label><label>Estado<select name="status">${Object.entries(caseStatuses).map(([key, label]) => option(key, label, key === (current?.status || "received"))).join("")}</select></label><label>Fecha de recepción<input name="openedAt" type="date" value="${esc(current?.openedAt || date())}" required></label><label class="wide">Motivo / problema<textarea name="issue" rows="3" required>${esc(current?.issue || "")}</textarea></label><label class="wide">Seguimiento / solución<textarea name="resolution" rows="3">${esc(current?.resolution || "")}</textarea></label><div class="form-actions"><button class="primary" ${sale ? "" : "disabled"}>Guardar caso</button><button class="secondary" id="clear-service-case" type="button">Nuevo caso</button></div></form>`;
  const cases = [...state.serviceCases].reverse();
  const history = cases.length ? rows(["Venta / cliente", "Producto", "Caso / estado", "Motivo / seguimiento", ""], cases.map(item => {
    const original = state.sales.find(sale => sale.id === item.saleId);
    return `<tr><td>${esc(original?.receiptNumber || item.saleId)}<small>${esc(original?.customerName || "Venta no encontrada")}<br>${esc(item.openedAt)}</small></td><td>${esc(original?.lines.find(line => line.productId === item.productId)?.productName || "Producto")}</td><td>${esc(caseTypes[item.type])}<small>${badge(caseStatuses[item.status], item.status)}</small></td><td>${esc(item.issue)}${item.resolution ? `<small>${esc(item.resolution)}</small>` : ""}<details><summary>Historial (${item.history?.length || 0})</summary>${(item.history || []).map(update => `<p>${esc(update.recordedAt.slice(0, 10))} · ${esc(caseStatuses[update.status])}<br>${esc(update.issue)}${update.resolution ? `<br>${esc(update.resolution)}` : ""}</p>`).join("")}</details></td><td><button class="text-button" data-edit-case="${esc(item.id)}">Ver / actualizar</button></td></tr>`;
  }).join("")) : empty("Todavía no hay casos de posventa registrados.");
  const active = cases.filter(item => ["received", "reviewing"].includes(item.status)).length;
  return `${section("Garantías registradas", `<p>El plazo se calcula desde la fecha de la venta usando los días registrados en el comprobante. Podés registrar y atender un caso aunque el plazo haya vencido.</p><label class="catalog-search">Buscar venta, cliente, contacto o producto<input id="warranty-search" placeholder="Comprobante, cliente o producto"></label><p id="warranty-search-empty" class="empty" hidden>No hay ventas para esa búsqueda.</p>${salesTable}`)}${section(current ? "Actualizar caso" : "Nuevo caso de posventa", `<p class="form-hint">Este registro permite seguir la atención. Los movimientos de stock y las devoluciones de dinero se registran en Compras y Pedidos cuando corresponda.</p>${form}`)}${section(`Casos de posventa · ${active} abiertos`, history)}`;
}

function customers() {
  const map = new Map();
  for (const order of state.orders) { const key = order.contact.trim().toLowerCase(); const previous = map.get(key) || { name: order.customerName, contact: order.contact, count: 0, spent: 0 }; previous.count++; if (order.status === "delivered") previous.spent += orderTotal(order); map.set(key, previous); }
  return section("Clientes registrados en pedidos", map.size ? rows(["Cliente", "Contacto", "Pedidos", "Ventas entregadas"], [...map.values()].map(item => `<tr><td>${esc(item.name)}</td><td>${esc(item.contact)}</td><td>${item.count}</td><td>${money(item.spent)}</td></tr>`).join("")) : empty("Los clientes aparecerán al registrar pedidos."));
}

const filteredSales = () => state.sales.filter(item => (!salesFilters.from || item.date >= salesFilters.from) && (!salesFilters.to || item.date <= salesFilters.to) && (!salesFilters.channel || item.channel === salesFilters.channel));
const filteredPayments = () => paymentMovements(state).filter(item => (!paymentFilters.from || (item.date && item.date >= paymentFilters.from)) && (!paymentFilters.to || (item.date && item.date <= paymentFilters.to)) && (!paymentFilters.method || item.method === paymentFilters.method));

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
  const payments = filteredPayments();
  const charged = payments.filter(item => item.kind === "payment").reduce((sum, item) => sum + item.amount, 0);
  const refunded = -payments.filter(item => item.kind === "refund").reduce((sum, item) => sum + item.amount, 0);
  const paymentFilterForm = `<form id="payment-filter-form" class="form-grid"><label>Desde<input name="from" type="date" value="${esc(paymentFilters.from)}"></label><label>Hasta<input name="to" type="date" value="${esc(paymentFilters.to)}"></label><label>Medio de pago<select name="method">${option("", "Todos los medios", !paymentFilters.method)}${Object.entries(paymentMethods).map(([key, value]) => option(key, value, key === paymentFilters.method)).join("")}${paymentMovements(state).some(item => item.method === "legacy") ? option("legacy", "Sin medio registrado", paymentFilters.method === "legacy") : ""}</select></label><div class="form-actions"><button class="primary">Aplicar filtros</button><button id="clear-payment-filters" type="button" class="secondary">Limpiar</button><button id="export-payments" type="button" class="secondary" ${payments.length ? "" : "disabled"}>Descargar CSV</button></div></form>`;
  const paymentTable = payments.length ? rows(["Fecha", "Movimiento", "Cliente", "Comprobante", "Medio", "Importe neto", "Nota"], payments.map(item => `<tr><td>${esc(item.date || "Sin fecha")}</td><td>${item.kind === "refund" ? "Devolución" : "Cobro"}</td><td>${esc(item.customerName)}</td><td>${esc(item.receiptNumber || "—")}</td><td>${esc(item.method === "legacy" ? "Sin medio registrado" : paymentMethods[item.method] || item.method)}</td><td class="${item.amount < 0 ? "stock-out" : "stock-in"}">${item.amount < 0 ? "−" : "+"}${money(Math.abs(item.amount))}</td><td>${esc(item.note || "—")}</td></tr>`).join("")) : empty("No hay cobros ni devoluciones para los filtros elegidos.");
  const visuals = salesVisualSummary(filtered);
  const charts = filtered.length ? `<div class="grid two sales-charts">${section("Evolución mensual", `<p class="form-hint">Últimos seis meses con ventas dentro de los filtros elegidos.</p>${reportBars(visuals.months, "months")}`)}${section("Ventas por canal", `<p class="form-hint">Participación de cada canal en el importe vendido del período.</p>${reportBars(visuals.channels, "channels")}`)}</div>` : "";
  const paymentReport = `${paymentFilterForm}<p class="form-hint">Este informe usa la fecha del cobro o devolución; puede diferir de la fecha de venta. Las señas antiguas sin fecha quedan fuera al filtrar por período.</p><div class="stats payment-stats"><article><span>Cobrado</span><strong>${money(charged)}</strong></article><article><span>Devuelto</span><strong>${money(refunded)}</strong></article><article><span>Ingreso neto</span><strong>${money(charged - refunded)}</strong></article></div>${paymentTable}`;
  return `${section("Filtrar ventas", filterForm)}<div class="stats"><article><span>Ventas</span><strong>${filtered.length}</strong><small>Total ${money(totals.revenue)}</small></article><article><span>Margen de productos</span><strong>${money(totals.revenue - totals.shipping - totals.cost)}</strong><small>Sin cargo de envío ni costo de mercadería</small></article><article><span>Descuentos</span><strong>${money(totals.discount)}</strong><small>Aplicados manualmente</small></article><article><span>Por cobrar</span><strong>${money(totals.outstanding)}</strong><small>De las ventas filtradas</small></article></div>${charts}${section("Ventas realizadas", table)}${section("Productos vendidos", productTable)}${section("Cobros y devoluciones por fecha", paymentReport)}`;
}

function dataView() {
  let account;
  if (!isCloudConfigured()) account = `<p>La nube de Cualitec todavía no está configurada. Los datos se guardan en este navegador.</p>`;
  else if (!session) account = `<p>Iniciá sesión para sincronizar datos entre dispositivos.</p><form id="login-form" class="form-grid"><label>Correo electrónico<input name="email" type="email" autocomplete="username" required></label><label>Contraseña<input name="password" type="password" autocomplete="current-password" required></label><div class="form-actions"><button class="primary">Ingresar</button></div></form>`;
  else account = `<p>Cuenta: <strong>${esc(session.user.email)}</strong></p><p>Estado: <strong id="sync-description">${syncLabels[syncStatus]}</strong></p><p class="form-hint">Si las dos PC modifican registros distintos, se combinan cuando el resultado conserva stock, saldos y números de comprobante válidos. Los cambios que se contradicen siguen requiriendo una elección.</p>${cloudPending ? `<p>${syncStatus === "remote_available" ? "Hay datos nuevos en Supabase. Terminá o descartá el formulario sin guardar antes de cargarlos." : "Esta PC y Supabase tienen cambios distintos. Descargá un respaldo antes de elegir cuál conservar."}</p>` : syncStatus === "offline" ? `<p>Los cambios de esta PC siguen guardados aquí. Revisá la conexión para enviarlos a Supabase.</p>` : ""}<div class="form-actions"><button id="refresh-cloud" class="secondary">Revisar versión en Supabase</button>${cloudPending ? `<button id="load-cloud" class="secondary">Usar datos de Supabase</button>${syncStatus === "conflict" ? `<button id="keep-local" class="primary">Conservar datos de esta PC</button>` : ""}` : cloudEnabled ? `<button id="check-cloud" class="secondary">Probar sincronización</button>` : ""}<button id="logout" class="secondary">Cerrar sesión</button></div>${cloudCheck ? `<p>${esc(cloudCheck)}</p>` : ""}<form id="password-form" class="form-grid"><label>Nueva contraseña<input name="password" type="password" autocomplete="new-password" minlength="8" required></label><label>Repetir contraseña<input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required></label><div class="form-actions"><button class="secondary">Guardar contraseña</button></div></form>`;
  const history = !session || !historyAvailable ? "" : section("Historial de recuperación", `<p>Las últimas 50 versiones sincronizadas se guardan en Supabase. Podés recuperar una anterior si cometés un error.</p><div class="form-actions"><button id="refresh-history" class="secondary">Actualizar historial</button></div>${historyStatus ? `<p>${esc(historyStatus)}</p>` : ""}${historySnapshots.length ? rows(["Versión", "Guardada", ""], historySnapshots.map(item => `<tr><td>${item.revision}</td><td>${esc(new Intl.DateTimeFormat("es-UY", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.created_at)))}</td><td><button class="text-button" data-restore-revision="${item.revision}" ${item.revision === cloudRevision || !cloudEnabled ? "disabled" : ""}>Recuperar</button></td></tr>`).join("")) : empty("Todavía no hay versiones disponibles.")}`);
  return `<div class="grid two">${section("Respaldo", `<p>Descargá una copia de tus datos o restaurá un respaldo de Cualitec.</p><div class="form-actions"><button id="export" class="primary">Descargar respaldo</button><label class="file-button">Importar respaldo<input id="import" type="file" accept="application/json,.json" hidden></label></div>`)}${section("Cuenta y almacenamiento", account)}</div>${history}`;
}

async function refreshHistory() {
  try { historySnapshots = await listCloudHistory(); historyStatus = ""; historyAvailable = true; }
  catch (error) { historySnapshots = []; historyStatus = `No se pudo cargar el historial: ${error.message}`; historyAvailable = false; }
  if (view === "data" && !draftDirty) render();
}

async function tryMergeCloud(localSnapshot, remoteState, remoteRevision, knownHash) {
  if (draftDirty || !knownHash || !syncMeta?.revision) return false;
  let base;
  try { base = normalizeState(await readCloudRevision(syncMeta.revision)); }
  catch { return false; } // Una versión antigua puede haber salido del historial de 50 copias.
  if (await fingerprint(base) !== knownHash) return false;
  if (canonical(state) !== canonical(localSnapshot)) { setTimeout(() => refreshCloud(), 0); return "retry"; }
  const merged = mergeIndependentChanges(base, localSnapshot, remoteState);
  if (!merged) return false;
  const alreadyRemote = canonical(merged) === canonical(remoteState);
  cloudEnabled = false; setSyncStatus("saving");
  let revision = remoteRevision;
  if (!alreadyRemote) {
    try { revision = await writeCloud(merged, remoteRevision); }
    catch (error) {
      if (!error.message.includes("VERSION_CONFLICT")) throw error;
      cloudEnabled = false; setSyncStatus("offline"); setTimeout(() => refreshCloud(), 0);
      return "retry";
    }
  }
  cloudRevision = revision;
  if (canonical(state) !== canonical(localSnapshot)) {
    cloudEnabled = false; setSyncStatus("offline"); setTimeout(() => refreshCloud(), 0);
    return "retry";
  }
  state = merged; localStorage.setItem(KEY, JSON.stringify(state));
  cloudPending = null;
  await acknowledge(merged, revision);
  if (canonical(state) !== canonical(merged)) {
    setSyncStatus("offline"); setTimeout(() => refreshCloud(), 0);
    return "retry";
  }
  cloudEnabled = true; setSyncStatus("synced"); render(); refreshHistory();
  toast("Se combinaron cambios independientes de ambas PC.");
  return "merged";
}

async function refreshCloud() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    await saveQueue;
    session = await getSession();
    if (!session) { cloudEnabled = false; cloudPending = null; historySnapshots = []; historyStatus = ""; historyAvailable = false; setSyncStatus("local"); if (!draftDirty) render(); return; }
    setSyncStatus("checking");
    const localSnapshot = structuredClone(state);
    const remote = await readCloud();
    if (canonical(state) !== canonical(localSnapshot)) { setSyncStatus(pendingWrites ? "saving" : "offline"); setTimeout(() => refreshCloud(), 0); return; }
    const remoteState = remote ? normalizeState(remote.data) : structuredClone(emptyState);
    const localHash = await fingerprint(localSnapshot), remoteHash = remote ? await fingerprint(remoteState) : "";
    if (canonical(state) !== canonical(localSnapshot)) { setSyncStatus(pendingWrites ? "saving" : "offline"); setTimeout(() => refreshCloud(), 0); return; }
    const knownHash = syncMeta?.userId === session.user.id ? syncMeta.hash : "";
    cloudRevision = Number(remote?.revision || 0);
    const decision = syncDecision({ localHash, remoteHash, acknowledgedHash: knownHash, hasLocalData: hasData(localSnapshot), hasRemoteData: !!remote });
    if (decision === "equal") {
      cloudPending = null; cloudEnabled = true; await acknowledge(localSnapshot, cloudRevision);
      setSyncStatus("synced"); if (!draftDirty) render();
    } else if (decision === "use_remote") {
      if (draftDirty) {
        cloudPending = remoteState; cloudEnabled = false; setSyncStatus("remote_available");
        toast("Hay una versión nueva en Supabase. Guardá o descartá el formulario antes de cargarla.");
      } else {
        state = remoteState; localStorage.setItem(KEY, JSON.stringify(state));
        cloudPending = null; cloudEnabled = true; await acknowledge(remoteState, cloudRevision);
        setSyncStatus("synced"); render(); toast("Se cargaron los cambios de la otra PC.");
      }
    } else if (decision === "push_local") {
      setSyncStatus("saving");
      try {
        const revision = await writeCloud(localSnapshot, cloudRevision);
        cloudRevision = revision; cloudPending = null; cloudEnabled = true;
        await acknowledge(localSnapshot, revision);
        if (canonical(state) !== canonical(localSnapshot)) { cloudEnabled = false; setSyncStatus("offline"); setTimeout(() => refreshCloud(), 0); }
        else { setSyncStatus("synced"); if (!draftDirty) render(); }
      } catch (error) {
        if (!error.message.includes("VERSION_CONFLICT")) throw error;
        const latest = await readCloud();
        cloudRevision = Number(latest?.revision || 0);
        const latestState = normalizeState(latest.data);
        const merge = await tryMergeCloud(localSnapshot, latestState, cloudRevision, knownHash);
        if (merge === "merged" || merge === "retry") return;
        cloudPending = latestState; cloudEnabled = false; setSyncStatus("conflict"); if (!draftDirty) render();
        toast("La otra PC guardó cambios mientras se sincronizaba. Elegí qué versión conservar.");
      }
    } else {
      const merge = await tryMergeCloud(localSnapshot, remoteState, cloudRevision, knownHash);
      if (merge === "merged" || merge === "retry") return;
      cloudPending = remoteState; cloudEnabled = false; setSyncStatus("conflict"); if (!draftDirty) render();
      toast("Hay cambios diferentes en esta PC y en Supabase. Elegí qué versión conservar.");
    }
    refreshHistory();
  })().catch(error => {
    cloudEnabled = false; setSyncStatus("offline"); if (!draftDirty) render();
    toast(`No se pudo consultar Supabase: ${error.message}. Los datos locales siguen guardados.`);
  }).finally(() => { refreshPromise = null; });
  return refreshPromise;
}

async function connectCloud() { await refreshCloud(); }

function render() {
  draftDirty = false;
  const titles = { dashboard: "Resumen", "quick-sale": "Venta rápida", products: "Productos", purchases: "Compras", orders: "Pedidos", customers: "Clientes", sales: "Ventas", aftersales: "Garantías y posventa", data: "Datos y respaldo" };
  document.querySelector("#view-title").textContent = titles[view];
  document.querySelector("#today").textContent = new Intl.DateTimeFormat("es-UY", { day: "numeric", month: "long", year: "numeric" }).format(new Date());
  document.querySelectorAll("[data-view]").forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    if (button.closest(".sidebar")) { if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current"); }
  });
  app.innerHTML = ({ dashboard, "quick-sale": quickSale, products, purchases, orders, customers, sales, aftersales, data: dataView })[view]();
  if (view === "orders" && selectedOrderId) {
    app.insertAdjacentHTML("afterbegin", selectedOrderDetails() + messageComposer());
    document.querySelector("#payment-form").elements.orderId.value = selectedOrderId;
  }
  if (view === "orders") syncOrderControls(document.querySelector("#order-form"));
  if (view === "quick-sale") { syncOrderControls(document.querySelector("#quick-sale-form")); syncQuickSaleTotal(); }
  setSyncStatus(syncStatus);
}

function syncOrderControls(form, clearInactive = false) {
  if (!form) return;
  const discount = form.elements.discountType.value === "none", shipping = form.elements.shippingPayer.value !== "included_in_sale";
  if (clearInactive && discount) form.elements.discountValue.value = "0";
  if (clearInactive && shipping) form.elements.shippingAmount.value = "0";
  form.elements.discountValue.disabled = discount;
  form.elements.shippingAmount.disabled = shipping;
}

function addProductByCode(quick = false) {
  const input = document.querySelector(quick ? "#quick-sale-code" : "#order-code"), product = findProductByCode(state.products, input.value);
  if (!product) { toast("No se encontró un producto con ese código. Revisá el catálogo."); input.focus(); return; }
  if (quick && availableQuantity(state, product.id) <= 0) { toast("Esa variante no tiene unidades disponibles para una venta rápida."); input.focus(); return; }
  const container = document.querySelector(quick ? "#quick-sale-lines" : "#order-lines");
  const line = quick ? quickSaleLine : orderLine;
  const existing = [...container.querySelectorAll(".order-line")].find(row => row.querySelector('[name="productId"]').value === product.id && !row.hasAttribute("data-pristine"));
  if (existing) existing.querySelector('[name="quantity"]').value = Number(existing.querySelector('[name="quantity"]').value || 0) + 1;
  else {
    const pristine = container.querySelector('[data-pristine="true"]');
    if (pristine) pristine.outerHTML = line({ productId: product.id, quantity: 1, unitPrice: product.price });
    else container.insertAdjacentHTML("beforeend", line({ productId: product.id, quantity: 1, unitPrice: product.price }));
  }
  if (quick) syncQuickSaleTotal();
  input.value = ""; input.focus(); toast(`${product.name}${product.variant ? ` · ${product.variant}` : ""} agregado a ${quick ? "la venta" : "el pedido"}.`);
}

document.addEventListener("click", event => {
  const target = event.target.closest("button"); if (!target) return;
  if (target.id === "catalog-template") {
    const blob = new Blob(["\ufeff", catalogCsvTemplate], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = "cualitec-plantilla-productos.csv"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (target.id === "cancel-catalog-import") { catalogPreview = null; document.querySelector("#catalog-import-preview").innerHTML = ""; }
  if (target.id === "confirm-catalog-import") {
    try {
      if (!catalogPreview) throw new Error("Elegí un CSV para importar.");
      const count = catalogPreview.rows.length;
      const next = importCatalogRows(state, catalogPreview.rows, date());
      catalogPreview = null; persist(next);
      toast(`${count} ${count === 1 ? "variante importada" : "variantes importadas"}.`);
    } catch (error) { toast(error.message); }
  }
  if (target.dataset.inventoryFilter) {
    document.querySelectorAll("[data-inventory-filter]").forEach(button => {
      const active = button === target;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    filterProducts();
  }
  if (target.dataset.restockProduct) {
    view = "purchases"; render();
    const form = document.querySelector("#purchase-form");
    form.elements.productId.value = target.dataset.restockProduct;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
    form.elements.quantity.focus({ preventScroll: true });
  }
  if (target.id === "sync-status") { view = "data"; render(); if (syncStatus === "remote_available") refreshCloud(); }
  if (target.dataset.view) { view = target.dataset.view; render(); document.querySelector(".sidebar").classList.remove("open"); document.querySelector("#menu").setAttribute("aria-expanded", "false"); if (syncStatus === "remote_available") refreshCloud(); }
  if (target.id === "menu" || target.id === "close-menu") { const open = target.id === "menu" ? document.querySelector(".sidebar").classList.toggle("open") : (document.querySelector(".sidebar").classList.remove("open"), false); document.querySelector("#menu").setAttribute("aria-expanded", String(open)); }
  if (target.id === "new-order" || target.id === "new-product") {
    if (draftDirty && !confirm("Hay cambios sin guardar en el formulario. ¿Descartarlos para empezar uno nuevo?")) return;
    const order = target.id === "new-order", form = document.querySelector(order ? "#order-form" : "#product-form");
    if (order) document.querySelector("#clear-order").click(); else form.reset();
    draftDirty = false;
    form.scrollIntoView({ behavior: "smooth", block: "start" }); form.elements[order ? "customerName" : "name"].focus({ preventScroll: true });
  }
  if (target.dataset.startCase || target.dataset.editCase || target.id === "clear-service-case") {
    selectedCaseId = target.dataset.editCase || null;
    caseSaleId = target.dataset.startCase || null;
    view = "aftersales"; render();
    const form = document.querySelector("#service-case-form");
    form.scrollIntoView({ behavior: "smooth", block: "start" }); form.elements.issue.focus({ preventScroll: true });
  }
  if (target.id === "copy-order-message") {
    const text = document.querySelector("#order-message");
    if (!text.value.trim()) { toast("Escribí un mensaje antes de copiarlo."); return; }
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text.value).then(() => toast("Mensaje copiado.")).catch(() => { text.focus(); text.select(); toast("No se pudo copiar automáticamente. El texto quedó seleccionado para copiarlo."); });
    else { text.focus(); text.select(); toast("El texto quedó seleccionado para copiarlo."); }
  }
  if (target.id === "open-order-whatsapp") {
    const url = whatsappUrl(document.querySelector("#message-phone").value, document.querySelector("#order-message").value);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    else { updateMessageDestination(); toast("Revisá el teléfono y el mensaje."); }
  }
  if (target.dataset.openOrder) {
    selectedOrderId = target.dataset.openOrder; view = "orders"; render();
    const paymentForm = document.querySelector("#payment-form");
    paymentForm.elements.orderId.value = selectedOrderId;
    const details = document.querySelector("#selected-order");
    details?.focus({ preventScroll: true }); details?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  if (target.dataset.orderPayment) {
    const form = document.querySelector("#payment-form");
    form.elements.orderId.value = target.dataset.orderPayment;
    form.scrollIntoView({ behavior: "smooth", block: "center" }); form.elements.amount.focus({ preventScroll: true });
  }
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
  if (target.id === "quick-add-line") { document.querySelector("#quick-sale-lines").insertAdjacentHTML("beforeend", quickSaleLine()); syncQuickSaleTotal(); }
  if (target.id === "add-by-code") addProductByCode();
  if (target.id === "quick-add-by-code") addProductByCode(true);
  if (target.classList.contains("remove-line")) { const container = target.closest("#order-lines,#quick-sale-lines"); if (container.children.length > 1) { target.closest(".order-line").remove(); if (container.id === "quick-sale-lines") syncQuickSaleTotal(); } else toast("Se necesita al menos un producto."); }
  if (target.id === "clear-order") { const form = document.querySelector("#order-form"); form.reset(); form.elements.id.value = ""; form.querySelector("#order-lines").innerHTML = state.products.length ? orderLine() : ""; syncOrderControls(form, true); }
  if (target.id === "clear-quick-sale") { const form = document.querySelector("#quick-sale-form"); form.reset(); form.querySelector("#quick-sale-lines").innerHTML = quickProducts().length ? quickSaleLine() : ""; syncOrderControls(form, true); syncQuickSaleTotal(); draftDirty = false; }
  if (target.id === "clear-sales-filters") { salesFilters = { from: "", to: "", channel: "" }; render(); }
  if (target.id === "clear-payment-filters") { paymentFilters = { from: "", to: "", method: "" }; render(); }
  if (target.id === "clear-stock-filters") { stockFilters = { from: "", to: "", productId: "" }; render(); }
  if (target.id === "export-sales") {
    const report = salesReportCsv(state, filteredSales());
    const blob = new Blob(["\ufeff", report], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = `cualitec-ventas-${salesFilters.from || "inicio"}-${salesFilters.to || "hoy"}.csv`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (target.id === "export-payments") {
    const blob = new Blob(["\ufeff", paymentReportCsv(filteredPayments())], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = `cualitec-cobros-${paymentFilters.from || "inicio"}-${paymentFilters.to || "hoy"}.csv`;
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
  if (target.id === "refresh-cloud") refreshCloud();
  if (target.dataset.restoreRevision) {
    const revision = Number(target.dataset.restoreRevision);
    if (!cloudEnabled || !historySnapshots.some(item => item.revision === revision)) { toast("Esa versión ya no está disponible."); return; }
    if (!confirm(`Se recuperará la versión ${revision} y reemplazará los datos actuales. El estado actual quedará en el historial. ¿Continuar?`)) return;
    saveQueue.then(async () => {
      const snapshot = normalizeState(await readCloudRevision(revision));
      const nextRevision = await writeCloud(snapshot, cloudRevision);
      state = snapshot; cloudRevision = nextRevision; cloudPending = null; cloudEnabled = true;
      localStorage.setItem(KEY, JSON.stringify(state));
      await acknowledge(snapshot, nextRevision); setSyncStatus("synced");
      await refreshHistory(); render(); toast("Versión recuperada y sincronizada.");
    }).catch(error => toast(`No se pudo recuperar: ${error.message}`));
  }
  if (target.id === "logout") signOut().then(() => { session = null; cloudEnabled = false; cloudPending = null; setSyncStatus("local"); render(); }).catch(error => toast(error.message));
  if (target.id === "load-cloud" && cloudPending && confirm("Se reemplazarán los datos de este navegador por los de Supabase. Descargá un respaldo antes de continuar. ¿Usar Supabase?")) {
    saveQueue.then(async () => {
      const latest = await readCloud();
      if (!latest) throw new Error("No se encontró la versión de Supabase.");
      cloudRevision = Number(latest.revision);
      state = normalizeState(latest.data); localStorage.setItem(KEY, JSON.stringify(state)); cloudPending = null; cloudEnabled = true;
      await acknowledge(state, cloudRevision); setSyncStatus("synced"); render(); toast("Se cargaron los datos de Supabase.");
    }).catch(error => toast(error.message));
  }
  if (target.id === "keep-local" && cloudPending && confirm("Los datos de esta PC se guardarán como una nueva versión en Supabase. La versión anterior quedará en el historial. ¿Continuar?")) {
    saveQueue.then(async () => {
      setSyncStatus("saving");
      const snapshot = structuredClone(state);
      const revision = await writeCloud(snapshot, cloudRevision);
      cloudRevision = revision; cloudPending = null; cloudEnabled = true;
      await acknowledge(snapshot, revision); setSyncStatus("synced"); await refreshHistory(); render(); toast("Se conservaron y sincronizaron los datos de esta PC.");
    }).catch(error => { toast(`No se pudo conservar esta versión: ${error.message}`); refreshCloud(); });
  }
  if (target.id === "check-cloud") {
    target.disabled = true;
    saveQueue = saveQueue.then(async () => {
      const snapshot = structuredClone(state);
      cloudRevision = await writeCloud(snapshot, cloudRevision);
      await acknowledge(snapshot, cloudRevision); setSyncStatus("synced");
      await refreshHistory();
      const saved = await readCloud();
      if (Number(saved?.revision) !== cloudRevision || canonical(normalizeState(saved.data)) !== canonical(snapshot)) throw new Error("Los datos leídos no coinciden con los guardados.");
      cloudCheck = "Prueba correcta: Supabase guardó y devolvió los datos actuales.";
      render();
    }).catch(error => { cloudCheck = `No se pudo verificar: ${error.message}`; cloudEnabled = false; setSyncStatus("offline"); render(); });
  }
});

document.addEventListener("submit", async event => {
  if (event.target.getAttribute("id") === "service-case-form") {
    event.preventDefault();
    const form = event.target, data = Object.fromEntries(new FormData(form));
    try {
      const next = saveServiceCase(state, { ...data, id: data.id || id("case"), saleId: form.elements.saleId.value, productId: form.elements.productId.value });
      selectedCaseId = null; caseSaleId = data.saleId || form.elements.saleId.value;
      persist(next); toast("Caso de posventa guardado.");
    } catch (error) { toast(error.message); }
    return;
  }
  if (event.target.getAttribute("id") === "payment-filter-form") {
    event.preventDefault(); const data = Object.fromEntries(new FormData(event.target));
    if (data.from && data.to && data.from > data.to) { toast("La fecha inicial debe ser anterior a la final."); return; }
    paymentFilters = { from: data.from, to: data.to, method: data.method }; render(); return;
  }
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
  const form = event.target, formId = form.getAttribute("id"); if (!["product-form", "purchase-form", "adjust-form", "order-form", "payment-form", "quick-sale-form"].includes(formId)) return;
  event.preventDefault(); const data = Object.fromEntries(new FormData(form));
  try {
    if (formId === "quick-sale-form") {
      const lines = [...form.querySelectorAll(".order-line")].map(row => ({ productId: row.querySelector('[name="productId"]').value, quantity: Number(row.querySelector('[name="quantity"]').value), unitPrice: Number(row.querySelector('[name="unitPrice"]').value) }));
      const order = { id: id("order"), customerName: data.customerName.trim(), contact: data.contact.trim(), channel: data.channel, lines, discountType: data.discountType, discountValue: Number(data.discountValue || 0), deliveryMethod: data.deliveryMethod, deliveryDate: data.saleDate, shippingPayer: data.shippingPayer, shippingAmount: Number(data.shippingAmount || 0), warrantyDays: Number(data.warrantyDays), createdAt: new Date().toISOString() };
      const next = recordQuickSale(state, { order, saleDate: data.saleDate, paymentAmount: Number(data.paymentAmount), paymentMethod: data.paymentMethod });
      persist(next);
      window.open(`receipt.html?sale=${encodeURIComponent(next.sales.at(-1).id)}`, "_blank", "noopener");
      toast("Venta registrada. El comprobante está disponible en Ventas.");
      return;
    }
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
  if (event.target.closest("#product-form,#purchase-form,#adjust-form,#order-form,#payment-form,#quick-sale-form,#service-case-form,#password-form,#login-form") || ["message-kind", "message-phone", "order-message"].includes(event.target.id)) draftDirty = true;
  if (event.target.name === "saleId" && event.target.closest("#service-case-form")) {
    const sale = state.sales.find(item => item.id === event.target.value);
    event.target.form.elements.productId.innerHTML = (sale?.lines || []).map(line => option(line.productId, line.productName)).join("");
  }
  if (event.target.id === "message-kind") {
    try { document.querySelector("#order-message").value = orderMessage(state, selectedOrderId, event.target.value); updateMessageDestination(); }
    catch (error) { toast(error.message); }
  }
  if (event.target.closest(".order-line")) event.target.closest(".order-line").removeAttribute("data-pristine");
  if (["discountType", "shippingPayer"].includes(event.target.name) && event.target.closest("#order-form,#quick-sale-form")) syncOrderControls(event.target.form, true);
  if (event.target.closest("#quick-sale-form")) syncQuickSaleTotal();
  if (event.target.id === "catalog-csv") {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error("El CSV debe ocupar menos de 1 MB.");
      const parsed = parseCatalogCsv(await file.text());
      validateCatalogRows(state, parsed);
      catalogPreview = { name: file.name, rows: parsed };
      const preview = document.querySelector("#catalog-import-preview");
      if (preview) preview.innerHTML = catalogPreviewMarkup();
    } catch (error) {
      catalogPreview = null;
      const preview = document.querySelector("#catalog-import-preview");
      if (preview) preview.innerHTML = `<p class="import-error" role="alert">${esc(error.message)}</p>`;
    }
    event.target.value = "";
  }
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
  if (event.target.closest("#product-form,#purchase-form,#adjust-form,#order-form,#payment-form,#quick-sale-form,#service-case-form,#password-form,#login-form") || ["message-phone", "order-message"].includes(event.target.id)) draftDirty = true;
  if (event.target.closest("#quick-sale-form")) syncQuickSaleTotal();
  if (event.target.id === "warranty-search") {
    const query = event.target.value.trim().toLowerCase(), entries = [...document.querySelectorAll("[data-warranty-row]")];
    entries.forEach(row => { row.hidden = !row.dataset.search.includes(query); });
    document.querySelector("#warranty-search-empty").hidden = entries.some(row => !row.hidden);
  }
  if (["message-phone", "order-message"].includes(event.target.id)) updateMessageDestination();
  if (event.target.closest(".order-line")) event.target.closest(".order-line").removeAttribute("data-pristine");
  if (event.target.id === "product-search") {
    filterProducts();
  }
});
document.addEventListener("keydown", event => {
  if (event.target.id === "order-code" && event.key === "Enter") { event.preventDefault(); addProductByCode(); }
  if (event.target.id === "quick-sale-code" && event.key === "Enter") { event.preventDefault(); addProductByCode(true); }
});
render();
connectCloud().catch(error => toast(`No se pudo consultar Supabase: ${error.message}`));
document.addEventListener("visibilitychange", () => { if (!document.hidden && isCloudConfigured()) refreshCloud(); });
window.addEventListener("focus", () => { if (isCloudConfigured()) refreshCloud(); });
window.addEventListener("online", () => { if (isCloudConfigured()) refreshCloud(); });

