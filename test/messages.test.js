import test from "node:test";
import assert from "node:assert/strict";
import { whatsappPhone, whatsappUrl, orderMessage } from "../messages.js";

const state = () => ({ products: [{ id: "p1", name: "Auriculares", variant: "Negro" }], purchases: [], sales: [], stockAdjustments: [], orders: [{ id: "o1", customerName: "Ana", contact: "@ana", status: "reserved", deliveryMethod: "dac", deliveryDate: "2026-10-05", trackingCode: "DAC123", shippingPayer: "included_in_sale", shippingAmount: 100, discountType: "percent", discountValue: 10, deposit: 200, lines: [{ productId: "p1", quantity: 2, unitPrice: 1000 }] }], payments: [{ id: "pay1", orderId: "o1", kind: "payment", amount: 300 }, { id: "refund", orderId: "o1", kind: "refund", amount: 50 }] });

test("WhatsApp normaliza celulares locales e internacionales y rechaza contactos ambiguos", () => {
  for (const phone of ["099 123 456", "99 123 456", "+598 (99) 123-456", "00598 99 123 456", "59899123456"]) assert.equal(whatsappPhone(phone), "59899123456");
  assert.equal(whatsappPhone("+54 9 11 1234 5678"), "5491112345678");
  for (const phone of ["@ana99123456", "Ana 099123456", "099123456 / 098123456", "12345", "000", "+000123456789", "", "ana@example.com"]) assert.equal(whatsappPhone(phone), "");
});

test("el enlace de WhatsApp conserva el texto editado y codifica caracteres especiales", () => {
  const text = "Hola Ana & Juan\nSaldo: $ 1.000,00 ¿Confirmás?";
  const url = new URL(whatsappUrl("099123456", text));
  assert.equal(url.origin, "https://wa.me");
  assert.equal(url.pathname, "/59899123456");
  assert.equal(url.searchParams.get("text"), text);
  assert.equal(whatsappUrl("@ana", text), "");
  assert.equal(whatsappUrl("099123456", "  "), "");
});

test("el mensaje calcula descuentos, envío, señas, cobros y devoluciones", () => {
  const message = orderMessage(state(), "o1");
  assert.match(message, /Auriculares · Negro × 2/);
  assert.match(message, /Descuento: .*200,00/);
  assert.match(message, /Total: .*1\.900,00/);
  assert.match(message, /Cobrado: .*450,00/);
  assert.match(message, /Saldo pendiente: .*1\.450,00/);
  assert.match(message, /Guía DAC: DAC123/);
  assert.match(message, /05\/10\/2026/);
  assert.doesNotMatch(message, /@ana|Costo|Cliente de ejemplo/);
});

test("no reclama cobros en pedidos pagados o cancelados ni promete envíos realizados", () => {
  const data = state();
  assert.match(orderMessage(data, "o1", "balance"), /1\.450,00/);
  const delivery = orderMessage(data, "o1", "delivery");
  assert.match(delivery, /Fecha prevista/);
  assert.doesNotMatch(delivery, /enviado|despachado/);
  data.orders[0].deposit = 1650;
  assert.throws(() => orderMessage(data, "o1", "balance"), /saldo/);
  data.orders[0].status = "cancelled";
  assert.throws(() => orderMessage(data, "o1", "balance"), /saldo/);
  assert.throws(() => orderMessage(data, "o1", "delivery"), /cancelado/);
  assert.match(orderMessage(data, "o1"), /pendiente de devolución/);
  assert.doesNotMatch(orderMessage(data, "o1"), /Fecha prevista/);
});
