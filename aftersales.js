export const caseTypes = { warranty: "Reclamo de garantía", exchange: "Cambio", repair: "Reparación" };
export const caseStatuses = { received: "Recibido", reviewing: "En revisión", resolved: "Resuelto", closed: "Cerrado" };

function calendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? parsed : null;
}

export function warrantyInfo(state, sale, today) {
  const order = state.orders.find(item => item.id === sale.orderId);
  const days = Number(sale.warrantyDays ?? order?.warrantyDays ?? 30);
  const start = calendarDate(sale.date), current = calendarDate(today);
  if (!start || !current || !Number.isInteger(days) || days <= 0) return { days, end: "", status: "Sin plazo calculable", remaining: null };
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + days);
  const remaining = Math.round((end - current) / 86400000);
  return { days, end: end.toISOString().slice(0, 10), status: current < start ? "Venta futura" : remaining >= 0 ? "Dentro del plazo registrado" : "Plazo registrado vencido", remaining };
}

export function saveServiceCase(state, input) {
  const cases = state.serviceCases || [];
  const previous = cases.find(item => item.id === input.id);
  const sale = state.sales.find(item => item.id === input.saleId);
  if (!sale || !sale.lines.some(line => line.productId === input.productId)) throw new Error("Elegí una venta y uno de sus productos.");
  if (previous && (previous.saleId !== input.saleId || previous.productId !== input.productId)) throw new Error("La venta y el producto de un caso no se pueden cambiar.");
  if (typeof input.id !== "string" || !input.id || !Object.hasOwn(caseTypes, input.type) || !Object.hasOwn(caseStatuses, input.status)) throw new Error("Revisá el tipo y el estado del caso.");
  if (!calendarDate(input.openedAt) || input.openedAt < sale.date) throw new Error("La fecha del caso debe ser válida y no anterior a la venta.");
  const issue = String(input.issue || "").trim(), resolution = String(input.resolution || "").trim();
  if (!issue) throw new Error("Describí el motivo del caso.");
  if (["resolved", "closed"].includes(input.status) && !resolution) throw new Error("Indicá la solución o el motivo de cierre.");
  const entry = { id: input.id, saleId: sale.id, productId: input.productId, type: input.type, status: input.status, openedAt: input.openedAt, issue, resolution, history: [...(previous?.history || []), { status: input.status, issue, resolution, recordedAt: new Date().toISOString() }] };
  return { ...state, serviceCases: previous ? cases.map(item => item.id === entry.id ? entry : item) : [...cases, entry] };
}
