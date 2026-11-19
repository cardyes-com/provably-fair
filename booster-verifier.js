const BoosterVerifier = (() => {
  const ALGORITHM = "hmac-sha256-booster-rarity-v1";
  const EXPORT_SCHEMA = "cardyes-booster-rarity-v1";
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

  function parseNonce(value, label) {
    requireThat(typeof value === "string" && /^(0|[1-9][0-9]{0,19})$/.test(value),
      label + " must be a decimal string.");
    const nonce = BigInt(value);
    requireThat(nonce <= MAX_NONCE, label + " exceeds the uint64 range.");
    return nonce;
  }

  function rowsBySlot(rows, count, label) {
    requireThat(Array.isArray(rows) && rows.length === count, label + " has missing or extra slots.");
    const bySlot = new Array(count);
    for (const row of rows) {
      requireThat(object(row) && integer(row.slotNo, 1, count), label + " has an invalid slot number.");
      requireThat(!bySlot[row.slotNo - 1], label + " has a duplicate slot number.");
      bySlot[row.slotNo - 1] = row;
    }
    return bySlot;
  }

  async function hash(textValue) {
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(textValue)));
    return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  }

  async function readRules(proof) {
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
    return rowsBySlot(rules.slots, rules.slots.length, "The committed rules").map(slot => {
      const label = "Rules for slot " + slot.slotNo;
      requireThat(Array.isArray(slot.weights) && integer(slot.weights.length, 1, rarities.size), label + " have invalid weights.");
      const seen = new Set();
      for (const entry of slot.weights) {
        requireThat(object(entry) && rarities.has(entry.rarity) && !seen.has(entry.rarity) && integer(entry.weight, 0, SCALE),
          label + " have an invalid rarity weight.");
        seen.add(entry.rarity);
      }
      let total = 0;
      const entries = [...slot.weights].sort((a, b) => a.rarity < b.rarity ? -1 : 1);
      const intervals = entries.map(entry => {
        total += entry.weight;
        return { rarity: entry.rarity, endExclusive: total };
      });
      requireThat(total === SCALE, label + " do not sum to the probability scale.");
      return intervals;
    });
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

  function readExport(data) {
    requireThat(object(data), "Paste a single pack proof or a Cardyes proof export.");
    if (data.schema === undefined) return { scope: "pack", proofs: [data], commitment: null, order: null };
    requireThat(data.schema === EXPORT_SCHEMA, "This proof export format is unsupported.");
    requireThat(data.scope === "pack" || data.scope === "order", "The export scope must be pack or order.");
    const { scope, order, proofs, commitment = null } = data;
    requireThat(object(order) && text(order.drawOrderId) && text(order.boosterId) && integer(order.version, 1) &&
      integer(order.requestedQty, 1, 20) && integer(order.completedQty, 1, order.requestedQty) &&
      integer(order.cardsPerPack, 1, 50) && hexHash(order.rulesHash), "The order result is invalid.");
    const count = scope === "pack" ? 1 : order.completedQty;
    requireThat(Array.isArray(proofs) && proofs.length === count && Array.isArray(order.packs) && order.packs.length === count,
      "The export must contain a proof and a result for every included pack.");
    if (commitment !== null) {
      requireThat(object(commitment) && commitment.boosterId === order.boosterId &&
        commitment.version === order.version && commitment.rulesHash === order.rulesHash &&
        commitment.qty === order.requestedQty, "The order does not match the pre-purchase record.");
    }
    return { scope, proofs, commitment, order };
  }

  async function verify(data) {
    requireThat(globalThis.crypto?.subtle, "Open the verifier over HTTPS or on localhost to run the cryptographic checks.");
    const { scope, proofs, commitment, order } = readExport(data);
    const first = proofs[0];
    requireThat(object(first) && first.algorithm === ALGORITHM && first.probabilityScale === SCALE,
      "This booster proof algorithm or probability scale is unsupported.");
    requireThat(text(first.clientSeed) && hexHash(first.serverSeedHash) && integer(first.version, 1),
      "The booster proof has invalid seed or version fields.");
    const rules = await readRules(first);
    const cardsPerPack = rules.length;
    const orderPacks = new Map();
    const orderPackNumbers = new Set();
    if (order) {
      requireThat(order.version === first.version && order.rulesHash === first.rulesHash && order.cardsPerPack === cardsPerPack,
        "The proof rules do not match the order result.");
      for (const pack of order.packs) {
        requireThat(object(pack) && text(pack.packId) && integer(pack.packNo, 1, order.requestedQty) &&
          !orderPacks.has(pack.packId) && !orderPackNumbers.has(pack.packNo), "The order has an invalid or duplicate pack.");
        orderPacks.set(pack.packId, pack);
        orderPackNumbers.add(pack.packNo);
      }
    }
    let startNonce = null;
    if (commitment) {
      requireThat(commitment.serverSeedHash === first.serverSeedHash && commitment.clientSeed === first.clientSeed,
        "The proof seeds do not match the pre-purchase record.");
      startNonce = parseNonce(commitment.nonceNext, "The pre-purchase nonce");
    }

    const packIds = new Set();
    const nonces = new Set();
    const packs = [];
    let revealedSeed;
    let key;
    let calculatedSlots = 0;

    for (const proof of proofs) {
      requireThat(object(proof) && text(proof.packId) && integer(proof.packNo, 1, order?.requestedQty ?? 20) &&
        !packIds.has(proof.packId), "The export has an invalid or duplicate pack proof.");
      packIds.add(proof.packId);
      const label = "Pack " + proof.packNo;
      requireThat(proof.algorithm === ALGORITHM && proof.probabilityScale === SCALE && proof.version === first.version &&
        proof.rulesHash === first.rulesHash && proof.rulesJson === first.rulesJson,
        label + " does not use the same committed rules.");
      requireThat(proof.clientSeed === first.clientSeed && proof.serverSeedHash === first.serverSeedHash,
        label + " does not use the same seed commitment.");
      requireThat(typeof proof.serverSeedRevealed === "boolean", label + " has an invalid reveal status.");
      if (proof.serverSeedRevealed) {
        requireThat(text(proof.serverSeed), label + " is missing the revealed seed.");
        if (!key) {
          requireThat(await hash(proof.serverSeed) === proof.serverSeedHash, label + " has a server seed hash mismatch.");
          revealedSeed = proof.serverSeed;
          key = await crypto.subtle.importKey("raw", encoder.encode(revealedSeed), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
        }
        requireThat(proof.serverSeed === revealedSeed, label + " has a different revealed seed.");
      }

      let resultSlots;
      if (order) {
        const result = orderPacks.get(proof.packId);
        requireThat(result?.packNo === proof.packNo, label + " does not match a pack in the order result.");
        resultSlots = rowsBySlot(result.slots, cardsPerPack, label + " result");
      }
      const slots = [];
      for (const [index, slot] of rowsBySlot(proof.slots, cardsPerPack, label + " proof").entries()) {
        const slotLabel = label + ", slot " + slot.slotNo;
        const nonce = parseNonce(slot.nonce, slotLabel + " nonce");
        requireThat(!nonces.has(nonce), slotLabel + " reuses a nonce.");
        nonces.add(nonce);
        if (startNonce !== null) {
          const offset = (proof.packNo - 1) * cardsPerPack + index;
          requireThat(nonce === startNonce + BigInt(offset), slotLabel + " does not match the pre-purchase nonce.");
        }
        requireThat(integer(slot.roll, 0, SCALE - 1), slotLabel + " has an invalid roll.");
        const rarity = rules[index].find(interval => slot.roll < interval.endExclusive).rarity;
        requireThat(rarity === slot.rarity, slotLabel + " rarity does not match the committed rule for its roll.");
        requireThat(!resultSlots || resultSlots[index].rarity === rarity, slotLabel + " rarity does not match the opening result.");
        if (proof.serverSeedRevealed) {
          const roll = await computeRoll(key, proof.clientSeed, slot.nonce);
          requireThat(roll === slot.roll, slotLabel + " roll does not match the revealed seed.");
          calculatedSlots += 1;
        }
        slots.push({ slotNo: slot.slotNo, roll: slot.roll, rarity });
      }
      packs.push({ packNo: proof.packNo, revealed: proof.serverSeedRevealed, slots });
    }

    const totalSlots = packs.length * cardsPerPack;
    return {
      scope,
      packs: packs.sort((a, b) => a.packNo - b.packNo),
      calculatedSlots,
      totalSlots,
      commitmentMatched: commitment !== null,
      state: calculatedSlots < totalSlots ? "awaiting_reveal" : commitment ? "verified" : "recalculated"
    };
  }

  return { verify };
})();

if (typeof module !== "undefined") module.exports = BoosterVerifier;
