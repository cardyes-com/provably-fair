(() => {
  const packsLink = document.getElementById("packs-link");
  const boostersLink = document.getElementById("boosters-link");
  const packsPanel = document.getElementById("packs-panel");
  const boostersPanel = document.getElementById("boosters-panel");
  const form = document.getElementById("booster-form");
  const input = document.getElementById("booster-data");
  const loadSample = document.getElementById("load-booster-sample");
  const submit = document.getElementById("booster-check");
  const feedback = document.getElementById("booster-feedback");
  const status = document.getElementById("booster-status");
  const results = document.getElementById("booster-results");
  const resultSlot = document.getElementById("booster-result-slot");
  const resultRollLabel = document.getElementById("booster-result-roll-label");
  const resultRoll = document.getElementById("booster-result-roll");
  const resultRarity = document.getElementById("booster-result-rarity");
  const recopyHint = "Get a fresh card slot proof from Cardyes and copy it again.";

  // Card slot 4 from the verifier's existing synthetic test vectors.
  const algorithm = "hmac-sha256-booster-rarity-v1";
  const probabilityScale = 100000000;
  const sampleProof = {
    slotNo: 4,
    nonce: "9007199254740993",
    roll: 63234242,
    rarity: "R",
    clientSeed: "test-client-seed",
    serverSeed: "test-server-seed",
    serverSeedHash: "941aece9e4c35a56286c2b2674219eb9f04ab96355b159302332a471c163e912",
    rulesHash: "6cc331318ceac7755111701b1ff58a5999e786f9e4d87fab96e28608d21ee5a4",
    rulesJson: JSON.stringify({
      algorithm,
      probabilityScale,
      rarities: [{ code: "R" }, { code: "AR" }],
      slots: [1, 2, 3, 4].map(slotNo => {
        const arWeight = slotNo === 4 ? 50000000 : 80000000;
        return {
          slotNo,
          weights: [{ rarity: "R", weight: probabilityScale - arWeight }, { rarity: "AR", weight: arWeight }]
        };
      })
    })
  };

  input.placeholder = JSON.stringify(sampleProof, (_key, value) => typeof value === "string" ? "..." : value, 2);

  function selectProofType() {
    const boosters = location.hash === "#boosters";
    packsPanel.hidden = boosters;
    boostersPanel.hidden = !boosters;
    (boosters ? boostersLink : packsLink).setAttribute("aria-current", "location");
    (boosters ? packsLink : boostersLink).removeAttribute("aria-current");
  }

  function showStatus(message, type = "info") {
    status.className = "message " + type;
    status.textContent = message;
    feedback.hidden = false;
  }

  function clearFeedback() {
    feedback.hidden = true;
    results.hidden = true;
  }

  window.addEventListener("hashchange", selectProofType);
  selectProofType();

  input.addEventListener("input", clearFeedback);

  input.addEventListener("paste", event => {
    const pastedText = event.clipboardData?.getData("text");
    const replacesWholeProof = input.selectionStart === 0 && input.selectionEnd === input.value.length;
    if (!pastedText || !replacesWholeProof || input.readOnly) return;

    let proof;
    try {
      proof = JSON.parse(pastedText);
    } catch {
      return;
    }
    if (!proof || typeof proof !== "object" || Array.isArray(proof)) return;

    event.preventDefault();
    input.value = JSON.stringify(proof, null, 2);
    input.scrollTop = 0;
    clearFeedback();
  });

  loadSample.addEventListener("click", () => {
    input.value = JSON.stringify(sampleProof, null, 2);
    input.scrollTop = 0;
    clearFeedback();
    showStatus("Sample proof loaded. Click Check to recalculate.");
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    clearFeedback();
    let data;
    try {
      data = JSON.parse(input.value);
    } catch {
      showStatus(`Invalid card slot proof JSON. ${recopyHint}`, "error");
      return;
    }

    submit.disabled = true;
    loadSample.disabled = true;
    input.readOnly = true;
    showStatus("Checking the card slot…");
    try {
      const checked = await BoosterVerifier.verify(data);
      const pending = checked.state === "awaiting_reveal";
      if (pending) {
        showStatus("Awaiting server seed reveal. Reveal the seed in Cardyes and copy this slot again.", "warning");
      } else {
        showStatus(`Card slot ${checked.slotNo} recalculated. The roll and rarity match the proof. Pre-purchase record check skipped.`, "success");
      }
      resultSlot.textContent = checked.slotNo;
      resultRollLabel.textContent = pending ? "Recorded roll" : "Calculated roll";
      resultRoll.textContent = checked.roll;
      resultRarity.textContent = checked.rarity;
      results.hidden = false;
    } catch (error) {
      showStatus(`Verification failed. ${error.message} ${recopyHint}`, "error");
    } finally {
      submit.disabled = false;
      loadSample.disabled = false;
      input.readOnly = false;
    }
  });
})();
