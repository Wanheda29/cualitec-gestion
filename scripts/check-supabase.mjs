import { cloudConfig } from "../cloud-config.js";

const url = new URL("/rest/v1/keepalive", cloudConfig.url);
url.searchParams.set("select", "id");
url.searchParams.set("limit", "1");

const response = await fetch(url, {
  headers: { apikey: cloudConfig.publishableKey },
  signal: AbortSignal.timeout(15000),
});

if (!response.ok) {
  throw new Error(`La consulta a Supabase falló (HTTP ${response.status}).`);
}

const rows = await response.json();
if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.id !== 1) {
  throw new Error("La tabla de verificación no devolvió la fila esperada.");
}

console.log("Consulta a Supabase completada.");
