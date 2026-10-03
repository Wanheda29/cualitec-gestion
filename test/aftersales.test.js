import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, normalizeState } from "../domain.js";
import { warrantyInfo, saveServiceCase } from "../aftersales.js";

const initial = () => ({ ...structuredClone(emptyState), orders: [{id:"o1", warrantyDays:30}], sales: [{id:"s1", orderId:"o1", date:"2026-09-02", warrantyDays:30, lines:[{productId:"p1",productName:"Auriculares"},{productId:"p2",productName:"Parlante"}]}] });
const entry = () => ({id:"c1",saleId:"s1",productId:"p1",type:"warranty",status:"received",openedAt:"2026-10-02",issue:"No carga",resolution:""});

test("el plazo registrado incluye la fecha final y cruza meses y años bisiestos", () => {
  const state=initial(), sale=state.sales[0];
  assert.deepEqual(warrantyInfo(state,sale,"2026-10-02"), {days:30,end:"2026-10-02",status:"Dentro del plazo registrado",remaining:0});
  assert.equal(warrantyInfo(state,sale,"2026-10-03").status,"Plazo registrado vencido");
  assert.equal(warrantyInfo(state,{...sale,date:"2024-02-28",warrantyDays:2},"2024-03-01").end,"2024-03-01");
  assert.equal(warrantyInfo(state,{...sale,warrantyDays:0},"2026-10-02").end,"");
  assert.equal(warrantyInfo(state,{...sale,date:"2026-02-30"},"2026-10-02").end,"");
  assert.equal(warrantyInfo(state,{...sale,date:"2026-10-05"},"2026-10-02").status,"Venta futura");
});

test("guardar y resolver un caso conserva el vínculo y el historial sin alterar la venta", () => {
  const state=initial(), opened=saveServiceCase(state,entry());
  assert.equal(state.serviceCases.length,0);
  assert.deepEqual(opened.sales,state.sales);
  assert.throws(()=>saveServiceCase(opened,{...entry(),saleId:"missing"}),/venta/);
  assert.throws(()=>saveServiceCase(opened,{...entry(),productId:"p2"}),/cambiar/);
  assert.throws(()=>saveServiceCase(opened,{...entry(),status:"resolved"}),/solución/);
  const resolved=saveServiceCase(opened,{...entry(),status:"resolved",resolution:"Se cambió el cable"});
  assert.equal(resolved.serviceCases.length,1);
  assert.equal(resolved.serviceCases[0].history.length,2);
  assert.equal(resolved.serviceCases[0].history[0].status,"received");
  assert.equal(resolved.serviceCases[0].history[1].resolution,"Se cambió el cable");
  assert.deepEqual(resolved.products,state.products);
  assert.deepEqual(resolved.payments,state.payments);
});

test("acepta casos fuera del plazo y rechaza fechas o productos incompatibles",()=>{
  const state=initial();
  assert.equal(saveServiceCase(state,{...entry(),openedAt:"2026-12-01"}).serviceCases.length,1);
  for(const patch of [{openedAt:"2026-09-01"},{openedAt:"2026-02-30"},{productId:"missing"},{issue:" "},{type:"unknown"},{status:"unknown"}]) assert.throws(()=>saveServiceCase(state,{...entry(),...patch}));
});

test("los respaldos antiguos reciben casos vacíos y los nuevos conservan el historial",()=>{
  const old=initial(); delete old.serviceCases;
  assert.deepEqual(normalizeState(old).serviceCases,[]);
  const saved=saveServiceCase(old,entry());
  assert.deepEqual(normalizeState(JSON.parse(JSON.stringify(saved))).serviceCases,saved.serviceCases);
});
