(() => {
  const infiniteLink = document.getElementById("infinite-link");
  const boosterLink = document.getElementById("booster-link");
  const infinitePanel = document.getElementById("infinite-panel");
  const boosterPanel = document.getElementById("booster-panel");
  const input = document.getElementById("booster-data");
  const fileInput = document.getElementById("booster-file");
  const submit = document.getElementById("booster-check");
  const status = document.getElementById("booster-status");
  const results = document.getElementById("booster-results");
  const maxSize = 32 * 1024 * 1024;
  let revision = 0;

  function selectMode() {
    const booster = location.hash === "#booster";
    infinitePanel.hidden = booster;
    boosterPanel.hidden = !booster;
    (booster ? boosterLink : infiniteLink).setAttribute("aria-current", "location");
    (booster ? infiniteLink : boosterLink).removeAttribute("aria-current");
  }

  function showStatus(type, message, state) {
    status.className = "message " + type;
    status.textContent = message;
    status.dataset.state = state;
  }

  function resetResults() {
    results.replaceChildren();
    results.hidden = true;
  }

  function renderPacks(checked) {
    for (const pack of checked.packs) {
      const details = document.createElement("details");
      details.className = "pack-result";
      details.open = checked.packs.length === 1;
      const summary = document.createElement("summary");
      summary.textContent = "Pack " + pack.packNo + " · " + pack.slots.length + " slots · " +
        (pack.revealed ? "Recalculated" : "Awaiting reveal");
      const table = document.createElement("table");
      const headings = table.createTHead().insertRow();
      for (const name of ["Slot", pack.revealed ? "Calculated roll" : "Recorded roll", "Rarity"]) {
        const heading = document.createElement("th");
        heading.scope = "col";
        heading.textContent = name;
        headings.appendChild(heading);
      }
      const body = table.createTBody();
      for (const slot of pack.slots) {
        const row = body.insertRow();
        for (const value of [slot.slotNo, slot.roll, slot.rarity]) row.insertCell().textContent = value;
      }
      details.append(summary, table);
      results.appendChild(details);
    }
    results.hidden = false;
  }

  addEventListener("hashchange", selectMode);
  selectMode();

  input.addEventListener("input", () => {
    revision += 1;
    resetResults();
    showStatus("info", "Ready to check slot rarities.", "ready");
  });

  document.getElementById("booster-file-button").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    const target = ++revision;
    resetResults();
    if (file.size > maxSize) {
      showStatus("error", "Open a proof JSON file smaller than 32 MB.", "failed");
      return;
    }
    try {
      const value = await file.text();
      if (target !== revision) return;
      input.value = value;
      showStatus("info", "Proof loaded. Verify to check the slot rarities.", "ready");
    } catch {
      if (target === revision) showStatus("error", "The proof file could not be read.", "failed");
    }
  });

  document.getElementById("booster-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (submit.disabled) return;
    const target = ++revision;
    resetResults();
    if (!input.value.trim() || input.value.length > maxSize) {
      showStatus("error", "Paste a proof JSON object smaller than 32 MB.", "failed");
      return;
    }
    let data;
    try {
      data = JSON.parse(input.value);
    } catch {
      showStatus("error", "The proof is invalid JSON. Copy it again from Cardyes.", "failed");
      return;
    }
    submit.disabled = true;
    showStatus("info", "Checking slot rarities…", "checking");
    try {
      const checked = await BoosterVerifier.verify(data);
      if (target !== revision) return;
      const count = checked.calculatedSlots + "/" + checked.totalSlots + " slots";
      if (checked.state === "awaiting_reveal") {
        showStatus("warning", "Awaiting server seed reveal. " + count + " recalculated. Reveal the seed in Cardyes and copy the updated proof.", checked.state);
      } else if (checked.state === "verified") {
        showStatus("success", "Slot rarity verified. " + count + " matched the opening and pre-purchase record.", checked.state);
      } else {
        showStatus("success", "Slot rarities recalculated. " + count + " matched the proof. Pre-purchase record unavailable.", checked.state);
      }
      renderPacks(checked);
    } catch (error) {
      if (target === revision) showStatus("error", "Slot rarity verification failed. " + error.message, "failed");
    } finally {
      submit.disabled = false;
    }
  });
})();
