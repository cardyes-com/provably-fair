const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");
const { verify } = require("../booster-verifier.js");

const algorithm = "hmac-sha256-booster-rarity-v1";
const scale = 100000000;
const sha = value => createHash("sha256").update(value).digest("hex");

function proof() {
  const rulesJson = JSON.stringify({
    algorithm,
    probabilityScale: scale,
    rarities: [{ code: "R" }, { code: "AR" }],
    slots: [1, 2, 3, 4].map(slotNo => ({
      slotNo,
      weights: [{ rarity: "R", weight: 50000000 }, { rarity: "AR", weight: 50000000 }]
    }))
  });
  const serverSeed = "test-server-seed";
  return {
    algorithm, probabilityScale: scale, packId: "pack-from-go-vectors", packNo: 1, version: 2,
    clientSeed: "test-client-seed", serverSeed, serverSeedHash: sha(serverSeed), serverSeedRevealed: true,
    rulesJson, rulesHash: sha(rulesJson),
    slots: [
      { slotNo: 1, nonce: "0", roll: 38012813, rarity: "AR" },
      { slotNo: 2, nonce: "1", roll: 79200248, rarity: "R" },
      { slotNo: 3, nonce: "12", roll: 93188364, rarity: "R" },
      { slotNo: 4, nonce: "9007199254740993", roll: 63234242, rarity: "R" }
    ]
  };
}

test("recalculates Go test vectors, including a nonce above JavaScript's safe number range", async () => {
  const result = await verify(proof());
  assert.equal(result.state, "recalculated");
  assert.equal(result.calculatedSlots, 4);
  assert.equal(result.commitmentMatched, false);
  assert.deepEqual(result.packs[0].slots.map(x => x.rarity), ["AR", "R", "R", "R"]);
});

test("an unrevealed proof stays pending even with valid rules and reported results", async () => {
  const data = proof();
  delete data.serverSeed;
  data.serverSeedRevealed = false;
  const result = await verify(data);
  assert.equal(result.state, "awaiting_reveal");
  assert.equal(result.calculatedSlots, 0);
  assert.equal(result.totalSlots, 4);
});

test("changing the bytes of the original rules invalidates the rule commitment", async () => {
  const data = proof();
  data.rulesJson += "\n";
  await assert.rejects(verify(data), /rules JSON does not match/);
});

test("a roll with the right rarity still fails if the HMAC roll differs", async () => {
  const data = proof();
  data.slots[0].roll += 1;
  await assert.rejects(verify(data), /slot 1 roll does not match/);
});

test("invalid and duplicate slots cannot count toward a verified pack", async () => {
  const data = proof();
  data.slots[3].slotNo = 1;
  await assert.rejects(verify(data), /duplicate slot number/);
  data.slots.pop();
  await assert.rejects(verify(data), /missing or extra slots/);
});

test("an edited revealed seed fails the seed commitment check", async () => {
  const data = proof();
  data.serverSeed += "!";
  await assert.rejects(verify(data), /server seed hash mismatch/);
});
