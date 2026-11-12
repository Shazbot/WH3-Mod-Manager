import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CaabItem, CaabRecordNode } from "../esf/codecs/caabTree";
import { encodeU32 } from "./addFaction";
import { removeCaiFactionPosts } from "./removeFaction";

function record(name: string, groups: CaabItem[][]): CaabRecordNode {
  return { kind: "record", name, nameIndex: 0, version: 0, flags: 0xc0,
    isRoot: false, hasNestedBlocks: true, groups, blockSizeWidth: 1,
    groupCountWidth: 1, groupSizeWidths: groups.map(() => 1) };
}

function fixture(rows: { owner: number; post: number; component: number; postOwner?: number }[]) {
  const chunks: Buffer[] = [];
  let offset = 0;
  function values(...values: number[]): CaabItem[] {
    const data = Buffer.concat(values.map(encodeU32));
    const span: CaabItem = { kind: "raw", start: offset, end: offset + data.length };
    chunks.push(data); offset += data.length;
    return [span];
  }
  const groups = rows.map((row) => [
    record("OWNED_DIRECT", [values(row.owner)]),
    record("CAI_BDI_COMPONENT", [values(row.component)]),
    record("CAI_CHARACTER_POST", [values(row.post, row.postOwner ?? 0)]),
  ]);
  const posts = record("CAI_CHARACTER_POSTS", groups);
  posts.groupSizeWidths = groups.map((_, i) => i + 1);
  const root = record("ROOT", [[posts]]);
  return { source: Buffer.concat(chunks), root, posts };
}

test("post keys colliding with another faction's IDs do not determine ownership", () => {
  const f = fixture([
    { owner: 27558, post: 3245, component: 6756097 },
    { owner: 27558, post: 3246, component: 6821633 },
    { owner: 27558, post: 32345, component: 1280257 },
    { owner: 27630, post: 7930625, component: 3345922 },
    { owner: 32345, post: 5222913, component: 638210, postOwner: 7930625 },
  ]);
  const surviving = f.posts.groups.slice(0, 4);
  assert.equal(removeCaiFactionPosts(f.root, f.source, 32345), 1);
  assert.deepEqual(f.posts.groups, surviving);
  assert.deepEqual(f.posts.groupSizeWidths, [1, 2, 3, 4]);
});

test("a faction ID in the post body does not override a different OWNED_DIRECT owner", () => {
  const f = fixture([{ owner: 99, post: 32345, component: 120, postOwner: 32345 }]);
  const original = f.posts.groups.slice();
  assert.equal(removeCaiFactionPosts(f.root, f.source, 32345), 0);
  assert.deepEqual(f.posts.groups, original);
  assert.deepEqual(f.posts.groupSizeWidths, [1]);
});

test("all posts of the removed faction are removed with matching size metadata", () => {
  const f = fixture([
    { owner: 32345, post: 10, component: 100 },
    { owner: 99, post: 11, component: 101 },
    { owner: 32345, post: 12, component: 102 },
  ]);
  const surviving = f.posts.groups[1];
  assert.equal(removeCaiFactionPosts(f.root, f.source, 32345), 2);
  assert.deepEqual(f.posts.groups, [surviving]);
  assert.deepEqual(f.posts.groupSizeWidths, [2]);
});

test("missing post table is rejected", () => {
  assert.throws(() => removeCaiFactionPosts(record("ROOT", [[]]), Buffer.alloc(0), 32345), /CAI_CHARACTER_POSTS not found/);
});
