const BoosterVerifier = (() => {
  const ALGORITHM = "hmac-sha256-booster-rarity-v1";
  const SLOT_SCHEMA = "cardyes-booster-slot-rarity-v1";
  const SCALE = 100000000;
  const MAX_NONCE = (1n << 64n) - 1n;
  const ROLL_LIMIT = MAX_NONCE - MAX_NONCE % BigInt(SCALE);
  const encoder = new TextEncoder();
  const hashPattern = /^[a-f0-9]{64}$/;
  const rarityPattern = /^[A-Z][A-Z0-9_]{0,7}$/;

  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const text = value => typeof value === "string" && value.trim().length > 0;
  const hexHash = value => typeof value === "string" && hashPattern.test(value);
  const integer = (value, min, max = Number.MAX_SAFE_INTEGER) =>
    Number.isSafeInteger(value) && value >= min && value <= max;

  function requireThat(condition, message) {
    if (!condition) throw new Error(message);
  }

  function validateNonce(value) {
    requireThat(typeof value === "string" && /^(0|[1-9][0-9]{0,19})$/.test(value),
      "The card slot nonce must be a decimal string.");
    requireThat(BigInt(value) <= MAX_NONCE, "The card slot nonce exceeds the uint64 range.");
  }

  async function hash(textValue) {
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(textValue)));
    return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  }

  async function readSlotIntervals(proof) {
    requireThat(text(proof.rulesJson) && hexHash(proof.rulesHash), "The rule commitment is missing or invalid.");
    requireThat(await hash(proof.rulesJson) === proof.rulesHash, "The rules JSON does not match its hash.");
    let rules;
    try {
      rules = JSON.parse(proof.rulesJson);
    } catch {
      throw new Error("The committed rules are not valid JSON.");
    }
    requireThat(object(rules) && rules.algorithm === ALGORITHM && rules.probabilityScale === SCALE,
      "The committed rules use an unsupported algorithm or probability scale.");
    requireThat(Array.isArray(rules.rarities) && integer(rules.rarities.length, 1, 24), "The rarity definitions are invalid.");
    const rarities = new Set();
    for (const rarity of rules.rarities) {
      requireThat(object(rarity) && typeof rarity.code === "string" && rarityPattern.test(rarity.code) && !rarities.has(rarity.code),
        "The committed rules have invalid or duplicate rarities.");
      rarities.add(rarity.code);
    }
    requireThat(Array.isArray(rules.slots) && integer(rules.slots.length, 1, 50), "The committed slot count is invalid.");
    requireThat(integer(proof.slotNo, 1, rules.slots.length), "The card slot number is outside the committed rules.");
    const matchingSlots = rules.slots.filter(slot => object(slot) && slot.slotNo === proof.slotNo);
    requireThat(matchingSlots.length === 1, "The committed rules must contain exactly one entry for this card slot.");
    const { weights } = matchingSlots[0];
    requireThat(Array.isArray(weights) && integer(weights.length, 1, rarities.size), "The card slot has invalid weights.");
    const seen = new Set();
    for (const entry of weights) {
      requireThat(object(entry) && rarities.has(entry.rarity) && !seen.has(entry.rarity) && integer(entry.weight, 0, SCALE),
        "The card slot has an invalid rarity weight.");
      seen.add(entry.rarity);
    }
    let total = 0;
    const entries = [...weights].sort((a, b) => a.rarity < b.rarity ? -1 : 1);
    const intervals = entries.map(entry => {
      total += entry.weight;
      return { rarity: entry.rarity, endExclusive: total };
    });
    requireThat(total === SCALE, "The card slot weights do not sum to the probability scale.");
    return intervals;
  }

  async function computeRoll(key, clientSeed, nonce) {
    const base = "booster:v1:" + clientSeed + ":" + nonce;
    for (let counter = 0; ; counter += 1) {
      const message = counter === 0 ? base : base + ":" + counter;
      const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
      const value = new DataView(digest).getBigUint64(0);
      if (value < ROLL_LIMIT) return Number(value % BigInt(SCALE));
    }
  }

  async function verify(proof) {
    requireThat(globalThis.crypto?.subtle, "Open the verifier over HTTPS or on localhost to run the cryptographic checks.");
    requireThat(object(proof) && (proof.schema === undefined || proof.schema === SLOT_SCHEMA),
      "Copy the JSON for one Booster card slot from Cardyes.");
    requireThat(text(proof.clientSeed) && hexHash(proof.serverSeedHash), "The card slot proof has invalid seed fields.");
    const { serverSeed, serverSeedRevealed } = proof;
    requireThat(serverSeed !== undefined || serverSeedRevealed !== undefined,
      "The card slot proof is missing the server seed and reveal status.");
    requireThat(serverSeedRevealed === undefined || typeof serverSeedRevealed === "boolean",
      "The card slot proof has an invalid seed reveal status.");
    requireThat(serverSeedRevealed !== false || serverSeed === undefined,
      "Only include the server seed after it has been revealed.");
    validateNonce(proof.nonce);
    requireThat(integer(proof.roll, 0, SCALE - 1), "The card slot has an invalid roll.");

    const intervals = await readSlotIntervals(proof);
    const rarity = intervals.find(interval => proof.roll < interval.endExclusive).rarity;
    requireThat(rarity === proof.rarity, "The rarity does not match the committed rule for this card slot.");
    if (serverSeedRevealed === false) {
      return { slotNo: proof.slotNo, roll: proof.roll, rarity, state: "awaiting_reveal" };
    }

    requireThat(text(serverSeed), "The revealed server seed is missing.");
    requireThat(await hash(serverSeed) === proof.serverSeedHash, "The server seed hash does not match.");
    const key = await crypto.subtle.importKey("raw", encoder.encode(serverSeed),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const roll = await computeRoll(key, proof.clientSeed, proof.nonce);
    requireThat(roll === proof.roll, "The roll does not match the revealed server seed.");
    return { slotNo: proof.slotNo, roll, rarity, state: "recalculated" };
  }

  return { verify };
})();

if (typeof module !== "undefined") module.exports = BoosterVerifier;
