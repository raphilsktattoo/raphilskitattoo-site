/**
 * Real backend wiring for the "Agendar sessão" wizard on raphilskitattoo.com.
 *
 * The wizard itself (its 6 steps, styling, chips, calendar) is untouched —
 * this script only adds: (1) a real file picker + drag-and-drop behind the
 * "ARRASTE OU CLIQUE" reference boxes (they previously only toggled a fake
 * counter, no file was ever attached to anything), and (2) a real submission
 * to the studio's own backend when "Enviar pedido" is clicked (previously a
 * no-op — nothing was ever sent anywhere, not even the earlier steps).
 *
 * Talks to POST https://app.artgang.com.br/api/public/marketing-intake/{upload-url,submit},
 * a small CORS-enabled pair of routes on the Tattoo OS app built specifically
 * for this site (same underlying lead-creation logic as the studio's other
 * intake form, just reachable cross-origin). See that repo's
 * src/app/api/public/marketing-intake/ for the server side.
 */
(function () {
  "use strict";

  const API_BASE = "https://app.artgang.com.br";
  const ACCENT_BG = "rgb(255, 86, 60)";
  const MAX_REF_FILES = 4;

  const state = {
    formToken: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    desc: "", styles: [], color: "", cover: false,
    place: "", size: "", first: "", skin: "",
    notes: "",
    name: "", phone: "", email: "", birth: "", city: "",
    budget: "", urgency: "", source: "", periods: [],
    dataDesejada: "",
    files: [], // { file: File, key: string|null }
  };

  function leaves(root) {
    return [...root.querySelectorAll("*")].filter((el) => el.children.length === 0 && el.textContent.trim());
  }

  function findHeader(text) {
    const target = text.trim().toUpperCase();
    return [...document.querySelectorAll("*")].find((el) => el.children.length === 0 && el.textContent.trim().toUpperCase() === target);
  }

  function singleChip(headerText) {
    const header = findHeader(headerText);
    if (!header) return "";
    for (const leaf of leaves(header.parentElement)) {
      if (leaf === header) continue;
      if (getComputedStyle(leaf.parentElement).backgroundColor === ACCENT_BG) return leaf.textContent.trim();
    }
    return "";
  }

  function multiChips(headerText) {
    const header = findHeader(headerText);
    if (!header) return [];
    return leaves(header.parentElement)
      .filter((leaf) => leaf !== header && getComputedStyle(leaf.parentElement).backgroundColor === ACCENT_BG)
      .map((leaf) => leaf.textContent.trim());
  }

  function inputValue(placeholder) {
    const el = document.querySelector(`input[placeholder="${placeholder}"], textarea[placeholder="${placeholder}"]`);
    return el ? el.value.trim() : "";
  }

  function isCoverActive() {
    return [...document.querySelectorAll("*")].some((el) => el.children.length === 0 && el.textContent.trim() === "Sim, é um cover-up");
  }

  function captureCurrentStep() {
    const text = document.body.innerText;
    if (text.includes("PASSO 1 DE 6")) {
      state.desc = inputValue("Ex.: um retrato realista da minha avó com flores ao redor…") || state.desc;
      state.styles = multiChips("ESTILO (ATÉ 2)");
      state.color = singleChip("PALETA") || state.color;
      state.cover = isCoverActive();
    } else if (text.includes("PASSO 2 DE 6")) {
      state.place = singleChip("LOCAL DO CORPO") || state.place;
      state.size = singleChip("TAMANHO APROXIMADO") || state.size;
      state.first = singleChip("É SUA PRIMEIRA TATUAGEM?") || state.first;
      state.skin = singleChip("TOM DE PELE") || state.skin;
    } else if (text.includes("PASSO 3 DE 6")) {
      state.notes = inputValue("Alergias, cicatrizes, prazos, significado da peça...") || state.notes;
    } else if (text.includes("PASSO 4 DE 6")) {
      state.name = inputValue("Seu nome") || state.name;
      state.phone = inputValue("+55 11 90000-0000") || state.phone;
      state.email = inputValue("voce@email.com") || state.email;
      state.birth = inputValue("DD/MM/AAAA") || state.birth;
      state.city = inputValue("Alphaville, Barueri") || state.city;
    } else if (text.includes("PASSO 5 DE 6")) {
      state.budget = singleChip("ORÇAMENTO PREVISTO") || state.budget;
      state.urgency = singleChip("QUANDO VOCÊ QUER FAZER") || state.urgency;
      state.source = singleChip("COMO VOCÊ ME ENCONTROU?") || state.source;
      state.periods = multiChips("PERÍODOS QUE FUNCIONAM PRA VOCÊ");
    } else if (text.includes("PASSO 6 DE 6")) {
      const m = text.match(/Data desejada\n([^\n]+)/);
      state.dataDesejada = m ? m[1].trim() : state.dataDesejada;
    }
  }

  // ---- Reference-image upload (real file picker + drag/drop) ----

  const hiddenInput = document.createElement("input");
  hiddenInput.type = "file";
  hiddenInput.accept = "image/*,.heic,.heif";
  hiddenInput.multiple = true;
  hiddenInput.style.display = "none";
  document.body.appendChild(hiddenInput);

  let statusEl = null;

  function findDropzones() {
    // Every ancestor up to the page header also textContent-matches (it's
    // a substring of their much larger aggregate text), so bound by text
    // LENGTH first, then keep only the outermost among what's left — that
    // discards the small inner icon/label div nested one level inside
    // each real box, without ever pulling in page-level ancestors.
    const shortMatches = [...document.querySelectorAll("div")].filter((el) => {
      const t = el.textContent.trim();
      return t.length <= 100 && /ARRASTE OU CLIQUE|^REFERÊNCIA \d/.test(t);
    });
    return shortMatches.filter((el) => !shortMatches.some((other) => other !== el && other.contains(el)));
  }

  function ensureStatusLine() {
    const zones = findDropzones();
    if (zones.length === 0) return;
    const grid = zones[0].parentElement;
    if (!grid || grid.dataset.wizardStatusAdded) return;
    grid.dataset.wizardStatusAdded = "1";
    statusEl = document.createElement("p");
    statusEl.style.cssText = "grid-column:1/-1;font-size:12px;color:#7d7979;margin:8px 0 0;font-family:Archivo,sans-serif;";
    grid.appendChild(statusEl);
    renderStatus();
  }

  function renderStatus() {
    if (!statusEl) return;
    statusEl.textContent = state.files.length
      ? `${state.files.length} arquivo(s) selecionado(s): ${state.files.map((f) => f.file.name).join(", ")}`
      : "";
  }

  function addFiles(fileList) {
    const remaining = MAX_REF_FILES - state.files.length;
    if (remaining <= 0) return;
    const picked = Array.from(fileList).slice(0, remaining);
    for (const file of picked) state.files.push({ file, key: null });
    // Also click the existing (harmless) dropzone once per added file so
    // its own pre-existing checkmark UI advances in step, matching real
    // upload count — zero changes to that UI's own code, just driving it
    // with the same click it already knows how to handle. That click
    // toggles (fills the next empty slot, or empties the last-filled one
    // if you click IT specifically) — always click a currently-EMPTY
    // slot ("+"/"ARRASTE OU CLIQUE") so it only ever fills forward.
    for (let i = 0; i < picked.length; i++) {
      const empty = findDropzones().find((z) => /ARRASTE OU CLIQUE/.test(z.textContent));
      if (empty) empty.click();
    }
    ensureStatusLine();
    renderStatus();
  }

  hiddenInput.addEventListener("change", (e) => {
    addFiles(e.target.files);
    hiddenInput.value = "";
  });

  document.addEventListener(
    "click",
    (e) => {
      const zones = findDropzones();
      if (zones.some((z) => z.contains(e.target))) {
        ensureStatusLine();
        hiddenInput.click();
      }
    },
    true
  );

  document.addEventListener(
    "dragover",
    (e) => {
      if (findDropzones().some((z) => z.contains(e.target))) e.preventDefault();
    },
    true
  );

  document.addEventListener(
    "drop",
    (e) => {
      if (findDropzones().some((z) => z.contains(e.target))) {
        e.preventDefault();
        addFiles(e.dataTransfer.files);
      }
    },
    true
  );

  // ---- Step capture + real submission ----

  document.addEventListener(
    "click",
    (e) => {
      const btn = e.target.closest ? e.target.closest("button") : null;
      if (!btn) return;
      const label = btn.textContent.trim();
      if (/continuar/i.test(label) || /enviar pedido/i.test(label)) {
        captureCurrentStep();
        if (/enviar pedido/i.test(label)) submitReal();
      }
    },
    true
  );

  async function uploadOneFile(entry) {
    const authRes = await fetch(`${API_BASE}/api/public/marketing-intake/upload-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        formToken: state.formToken,
        file: { fileName: entry.file.name, contentType: entry.file.type || "image/jpeg", byteSize: entry.file.size },
      }),
    });
    const auth = await authRes.json();
    if (!auth.ok) throw new Error(auth.error || "upload_authorization_failed");
    await fetch(auth.uploadUrl, { method: "PUT", headers: { "Content-Type": entry.file.type || "image/jpeg" }, body: entry.file });
    return { key: auth.key, fileName: entry.file.name, contentType: entry.file.type || "image/jpeg", byteSize: entry.file.size };
  }

  function showFeedback(success, message) {
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(19,18,17,.92);font-family:Archivo,sans-serif;padding:24px;";
    const box = document.createElement("div");
    box.style.cssText = `max-width:420px;border:2px solid ${success ? "#ff563c" : "#e5484d"};padding:32px;text-align:center;background:#131211;`;
    const title = document.createElement("p");
    title.style.cssText = "margin:0 0 12px;font-size:20px;font-weight:800;text-transform:uppercase;color:#f3f2f2;";
    title.textContent = success ? "Pedido enviado!" : "Não conseguimos enviar";
    const body = document.createElement("p");
    body.style.cssText = "margin:0 0 24px;font-size:14px;color:#d7d3d3;line-height:1.5;";
    body.textContent = message;
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "FECHAR";
    closeBtn.style.cssText =
      "border:2px solid #ff563c;background:#ff563c;color:#131211;font:800 12px/1 Archivo,sans-serif;letter-spacing:.08em;padding:14px 28px;cursor:pointer;";
    closeBtn.onclick = () => {
      overlay.remove();
      if (success) location.reload();
    };
    box.appendChild(title);
    box.appendChild(body);
    box.appendChild(closeBtn);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  let submitted = false;

  async function submitReal() {
    if (submitted) return;
    submitted = true;

    try {
      const uploadedFiles = [];
      for (const entry of state.files) {
        try {
          uploadedFiles.push(await uploadOneFile(entry));
        } catch (err) {
          console.error("[wizard] reference upload failed", err);
        }
      }

      const notesLines = [];
      if (state.budget) notesLines.push(`Orçamento previsto: ${state.budget}`);
      if (state.source) notesLines.push(`Como conheceu: ${state.source}`);
      if (state.first) notesLines.push(`Primeira tatuagem: ${state.first}`);
      if (state.skin) notesLines.push(`Tom de pele: ${state.skin}`);
      if (state.birth) notesLines.push(`Data de nascimento: ${state.birth}`);
      if (state.city) notesLines.push(`Cidade/bairro: ${state.city}`);
      if (state.notes) notesLines.push(`Observações do cliente: ${state.notes}`);

      const availabilityParts = [];
      if (state.urgency) availabilityParts.push(state.urgency);
      if (state.periods.length) availabilityParts.push(`Períodos: ${state.periods.join(", ")}`);
      if (state.dataDesejada) availabilityParts.push(`Data desejada: ${state.dataDesejada}`);

      const payload = {
        formToken: state.formToken,
        contact: {
          name: state.name,
          phone: state.phone || undefined,
          email: state.email || undefined,
        },
        project: {
          idea: state.desc || "(sem descrição)",
          style: state.styles.length ? state.styles.join(", ") : state.color || undefined,
          bodyPlacement: state.place || undefined,
          approxSize: state.size || undefined,
          isCoverUp: !!state.cover,
          availability: availabilityParts.join(" · ") || undefined,
          additionalNotes: notesLines.join("\n") || undefined,
        },
        attribution: {
          howHeard: state.source || undefined,
          landingPage: location.href,
          referrer: document.referrer || undefined,
        },
        uploadedFiles,
      };

      const res = await fetch(`${API_BASE}/api/public/marketing-intake/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await res.json();

      if (result.outcome === "created") {
        showFeedback(true, "Recebemos seu pedido! Vou responder pelo WhatsApp ou e-mail informado em até 24h.");
      } else if (result.outcome === "validation_error") {
        submitted = false;
        const firstError = Object.values(result.fieldErrors || {})[0];
        showFeedback(false, firstError || "Confira seus dados (nome e um contato) e tente novamente.");
      } else {
        submitted = false;
        showFeedback(false, "Tivemos um problema no envio. Tente novamente em instantes ou chame no WhatsApp.");
      }
    } catch (err) {
      console.error("[wizard] submission failed", err);
      submitted = false;
      showFeedback(false, "Sem conexão no momento. Tente novamente em instantes ou chame no WhatsApp.");
    }
  }
})();
