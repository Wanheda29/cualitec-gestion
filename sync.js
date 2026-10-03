export const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

export async function fingerprint(value) {
  const bytes = new TextEncoder().encode(canonical(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export function syncDecision({ localHash, remoteHash, acknowledgedHash, hasLocalData, hasRemoteData }) {
  if (!hasRemoteData && !hasLocalData) return "equal";
  if (hasRemoteData && localHash === remoteHash) return "equal";
  if (!hasRemoteData) return "push_local";
  if (acknowledgedHash && localHash === acknowledgedHash) return "use_remote";
  if (acknowledgedHash && remoteHash === acknowledgedHash) return "push_local";
  if (!acknowledgedHash && !hasLocalData) return "use_remote";
  return "conflict";
}
