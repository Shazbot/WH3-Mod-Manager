import { describe, expect, it } from "vitest";

import {
  buildCacheIdentityKey,
  createCacheRebuildPolicy,
} from "../../src/vanillaDbCache/rebuildPolicy";

const identity = { game: "wh3", dbPackSize: 100, dbPackMtimeMs: 200, schemaHash: "abc" };
const key = buildCacheIdentityKey(identity);

describe("cache rebuild policy", () => {
  it("allows building for an identity it has never seen fail", () => {
    expect(createCacheRebuildPolicy().mayBuild(key)).toBe(true);
  });

  it("allows one retry after a recoverable failure", () => {
    const policy = createCacheRebuildPolicy();

    expect(policy.recordRecoverableFailure(key).abandoned).toBe(false);
    expect(policy.mayBuild(key)).toBe(true);
  });

  it("gives up when the retry fails too", () => {
    const policy = createCacheRebuildPolicy();
    policy.recordRecoverableFailure(key);

    expect(policy.recordRecoverableFailure(key).abandoned).toBe(true);
    expect(policy.mayBuild(key)).toBe(false);
  });

  it("counts different recoverable failures against the same retry budget", () => {
    const policy = createCacheRebuildPolicy();

    expect(policy.recordRecoverableFailure(key).failureCount).toBe(1);
    expect(policy.recordRecoverableFailure(key).failureCount).toBe(2);
  });

  it("gives up immediately on a cache the reader will not open at all", () => {
    // Built and then rejected by its own reader: another identical build fails identically.
    const policy = createCacheRebuildPolicy();
    policy.recordUnopenable(key);

    expect(policy.mayBuild(key)).toBe(false);
    expect(policy.isAbandoned(key)).toBe(true);
  });

  it("keeps identities apart, so one bad cache does not block another game", () => {
    const policy = createCacheRebuildPolicy();
    const otherKey = buildCacheIdentityKey({ ...identity, game: "wh2" });
    policy.recordUnopenable(key);

    expect(policy.mayBuild(otherKey)).toBe(true);
  });

  it("starts fresh after the game is patched or the schema changes", () => {
    // The point of keying on size, mtime and schema hash: giving up must not outlive its cause.
    const policy = createCacheRebuildPolicy();
    policy.recordUnopenable(key);

    expect(policy.mayBuild(buildCacheIdentityKey({ ...identity, dbPackMtimeMs: 999 }))).toBe(true);
    expect(policy.mayBuild(buildCacheIdentityKey({ ...identity, dbPackSize: 999 }))).toBe(true);
    expect(policy.mayBuild(buildCacheIdentityKey({ ...identity, schemaHash: "changed" }))).toBe(true);
  });

  it("honours a configured number of retries", () => {
    const policy = createCacheRebuildPolicy(0);

    expect(policy.recordRecoverableFailure(key).abandoned).toBe(true);
  });
});

describe("cache identity key", () => {
  it("distinguishes every field that should force a fresh attempt", () => {
    const keys = new Set([
      key,
      buildCacheIdentityKey({ ...identity, game: "wh2" }),
      buildCacheIdentityKey({ ...identity, dbPackSize: 1 }),
      buildCacheIdentityKey({ ...identity, dbPackMtimeMs: 1 }),
      buildCacheIdentityKey({ ...identity, schemaHash: "z" }),
    ]);

    expect(keys.size).toBe(5);
  });
});
