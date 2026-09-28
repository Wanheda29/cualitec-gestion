import { cloudConfig } from "./cloud-config.js";

let clientPromise;
export const isCloudConfigured = () => /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(cloudConfig.url) && cloudConfig.publishableKey.startsWith("sb_publishable_");

async function client() {
  if (!isCloudConfigured()) throw new Error("Supabase todavía no está configurado.");
  if (!clientPromise) clientPromise = new Promise((resolve, reject) => {
    if (globalThis.supabase?.createClient) { resolve(globalThis.supabase.createClient(cloudConfig.url, cloudConfig.publishableKey)); return; }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    script.onload = () => resolve(globalThis.supabase.createClient(cloudConfig.url, cloudConfig.publishableKey));
    script.onerror = () => reject(new Error("No se pudo cargar Supabase."));
    document.head.append(script);
  });
  return clientPromise;
}

export async function signIn(email, password) {
  const { data, error } = await (await client()).auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return data.session;
}
export async function signOut() {
  const { error } = await (await client()).auth.signOut();
  if (error) throw new Error(error.message);
}
export async function getSession() {
  if (!isCloudConfigured()) return null;
  const { data, error } = await (await client()).auth.getSession();
  if (error) throw new Error(error.message);
  return data.session;
}
export async function readCloud() {
  const { data, error } = await (await client()).from("owner_data").select("data,revision").maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
export async function writeCloud(data, revision) {
  const { data: nextRevision, error } = await (await client()).rpc("save_owner_data", { p_expected_revision: revision, p_data: data });
  if (error) throw new Error(error.message);
  return Number(nextRevision);
}
