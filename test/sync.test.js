import test from "node:test";
import assert from "node:assert/strict";
import { fingerprint, syncDecision } from "../sync.js";

test("fingerprints ignore object key order but detect changed values", async () => {
  assert.equal(await fingerprint({ products: [{ id: "1", stock: 2 }], sales: [] }), await fingerprint({ sales: [], products: [{ stock: 2, id: "1" }] }));
  assert.notEqual(await fingerprint({ stock: 2 }), await fingerprint({ stock: 3 }));
});

test("the remote version loads when only the other PC changed", () => {
  assert.equal(syncDecision({ localHash: "old", remoteHash: "new", acknowledgedHash: "old", hasLocalData: true, hasRemoteData: true }), "use_remote");
});

test("local changes save when the remote version is unchanged", () => {
  assert.equal(syncDecision({ localHash: "new", remoteHash: "old", acknowledgedHash: "old", hasLocalData: true, hasRemoteData: true }), "push_local");
  assert.equal(syncDecision({ localHash: "empty", remoteHash: "old", acknowledgedHash: "old", hasLocalData: false, hasRemoteData: true }), "push_local");
});

test("different edits on both PCs require a choice", () => {
  assert.equal(syncDecision({ localHash: "a", remoteHash: "b", acknowledgedHash: "old", hasLocalData: true, hasRemoteData: true }), "conflict");
  assert.equal(syncDecision({ localHash: "a", remoteHash: "b", acknowledgedHash: "", hasLocalData: true, hasRemoteData: true }), "conflict");
});

test("a new browser with no data downloads the remote version", () => {
  assert.equal(syncDecision({ localHash: "empty", remoteHash: "existing", acknowledgedHash: "", hasLocalData: false, hasRemoteData: true }), "use_remote");
});
