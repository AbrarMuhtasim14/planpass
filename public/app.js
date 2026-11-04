const state = {
  user: null,
  report: null,
  sampleId: "",
  planId: null,
  redlineUrl: "",
  revisedUrl: "",
  autoFor: "",
  instruction: "",
  scale: 1,
  pan: { x: 0, y: 0 },
};

const $ = (id) => document.getElementById(id);
const els = {};

async function api(path, options = {}) {
  const res = await fetch(path, { credentials: "include", ...options });
  if (res.status === 401) {
    window.location.href = "/auth.html";
    return new Promise(() => {});
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `Request failed (${res.status})`);
  return data;
}

document.addEventListener("DOMContentLoaded", init);

async function init() {
  ["occupancy", "pixels-per-foot", "scope-input", "concepts-input", "benchmark", "upload", "signout", "ptt", "transcript", "plan-img", "overlay", "viewport", "canvas", "compare-wrap", "redline-img", "revised-wrap", "revised-img", "stage-empty", "gauge-arc", "gauge-text", "status-badge", "violations", "trace", "history", "inspect", "export-redline-img", "export-clean-img", "export-pkg", "permit", "email-permit", "dataset", "refresh-history"].forEach((id) => (els[id] = $(id)));
  const me = await fetch("/api/me", { credentials: "include" });
  if (!me.ok) {
    window.location.href = "/auth.html";
    return;
  }
  state.user = (await me.json()).user;

  els.benchmark.addEventListener("change", loadSample);
  els["scope-input"].addEventListener("input", () => { state.instruction = els["scope-input"].value; els.transcript.textContent = state.instruction || "No voice scope yet — or pick a preset:"; });
  loadSamples();
  els.upload.addEventListener("change", uploadPlan);
  els.inspect.addEventListener("click", runInspection);
  els["export-redline-img"].addEventListener("click", () => exportImage(state.redlineUrl, "redline"));
  els["export-clean-img"].addEventListener("click", () => exportImage(state.revisedUrl, "clean-revised"));
  els["export-pkg"].addEventListener("click", exportPackage);
  els.permit.addEventListener("click", () => download(`/api/inspections/${state.report.inspectionId}/permit.pdf`));
  els["email-permit"].addEventListener("click", emailPermit);
  els.dataset.addEventListener("click", () => download(`/api/inspections/${state.report.inspectionId}/dataset.jsonl`));
  els.signout.addEventListener("click", signOut);
  els["refresh-history"].addEventListener("click", loadHistory);
  document.querySelectorAll(".chip").forEach((chip) =>
    chip.addEventListener("click", () => setInstruction(chip.dataset.scope)),
  );
  document.querySelectorAll("[data-layer]").forEach((input) =>
    input.addEventListener("change", applyLayers),
  );
  document.querySelectorAll(".tab").forEach((tab) =>
    tab.addEventListener("click", () => activateTab(tab.dataset.tab)),
  );
  $("zoom-in").addEventListener("click", () => setZoom(state.scale * 1.2));
  $("zoom-out").addEventListener("click", () => setZoom(state.scale / 1.2));
  $("zoom-reset").addEventListener("click", () => {
    state.scale = 1;
    state.pan = { x: 0, y: 0 };
    applyTransform();
  });
  initPan();
  initVoice();
  loadHistory();
}

function activateTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${name}`));
}

function setInstruction(text) {
  state.instruction = text || "";
  if (els["scope-input"]) els["scope-input"].value = state.instruction;
  els.transcript.textContent = text || "No voice scope yet — or pick a preset:";
}

function agentParams() {
  return {
    occupancy: els.occupancy.value.trim(),
    instruction: state.instruction,
    transcript: state.instruction,
    concepts: els["concepts-input"].value.split(",").map((s) => s.trim()).filter(Boolean),
    pixelsPerFoot: Number(els["pixels-per-foot"].value) > 0 ? Number(els["pixels-per-foot"].value) : undefined,
  };
}

async function loadSamples() {
  try {
    const samples = await api("/api/samples");
    for (const s of samples) {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.label;
      opt.dataset.url = s.url;
      els.benchmark.appendChild(opt);
    }
  } catch { /* sample library unavailable; uploads still work */ }
}

// Samples are live-inspected inputs: rasterize the SVG in the browser, then
// run the exact same live pipeline as an uploaded plan. No canned results.
async function loadSample() {
  const opt = els.benchmark.selectedOptions[0];
  state.sampleId = els.benchmark.value;
  state.planId = null;
  if (!opt?.dataset.url) return;
  const blob = await (await fetch(opt.dataset.url)).blob();
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || 1000;
    canvas.height = img.naturalHeight || 800;
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    // Upload the rasterized sample as a plan (S3 key); never keep base64 state.
    const pngBlob = await new Promise((r) => canvas.toBlob(r, "image/png"));
    const form = new FormData();
    form.append("file", pngBlob, `${state.sampleId || "sample"}.png`);
    const data = await api("/api/plans/upload", { method: "POST", body: form });
    state.planId = data.plan.id;
    els["plan-img"].src = data.plan.url;
  } finally {
    URL.revokeObjectURL(url);
  }
  els["plan-img"].style.display = "block";
  els["stage-empty"].classList.add("hidden");
  runInspection();
}

async function uploadPlan(event) {
  let file = event.target.files[0];
  if (!file) return;
  // Rasterize SVG in the browser (vision models need pixels, not vectors);
  // PDFs cannot be rasterized here — ask for a raster export instead.
  if (file.type === "application/pdf") {
    alert("PDF upload: please export the sheet as PNG or JPEG first — vision inspection needs a raster image.");
    event.target.value = "";
    return;
  }
  if (file.type.includes("svg")) {
    try {
      const url = URL.createObjectURL(file);
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || 1000;
      canvas.height = img.naturalHeight || 800;
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      file = await new Promise((r) => canvas.toBlob(r, "image/png"));
      file.name = "floorplan.png";
    } catch {
      alert("Could not rasterize that SVG — please export it as PNG first.");
      return;
    }
  }
  const form = new FormData();
  form.append("file", file, file.name || "floorplan.png");
  try {
    const data = await api("/api/plans/upload", { method: "POST", body: form });
    state.planId = data.plan.id;
    state.sampleId = "";
    els["plan-img"].src = data.plan.url;
    els["plan-img"].style.display = "block";
    els["stage-empty"].classList.add("hidden");
  } catch (e) {
    console.error("Upload failed:", e);
    if (els["status-badge"]) {
      els["status-badge"].textContent = `Upload error: ${e.message}`;
      els["status-badge"].className = "status-badge hold";
    }
  }
}

async function runInspection() {
  if (!state.planId) return alert("Select a sample or upload a floorplan first.");
  setBusy(true);
  try {
    const report = await api("/api/inspect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        planId: state.planId,
        ...agentParams(),
      }),
    });
    renderReport(report);
    // Closed loop without buttons: on HOLD, auto-generate redline + clean
    // revised plan, then auto re-inspect the clean plan (once per inspection).
    if (report.violations.length && report.source !== "redline" && state.autoFor !== report.inspectionId) {
      state.autoFor = report.inspectionId;
      const src = report;
      setBusy(true);
      try {
        await generateRedline();
        await reverify();
        if (state.report && state.report !== src) activateTab("audit");
      } catch { /* artifacts remain viewable/exportable even if re-inspection fails */ }
      finally { setBusy(false); }
    }
  } catch (e) {
    console.error("Upload failed:", e);
    if (els["status-badge"]) {
      els["status-badge"].textContent = `Upload error: ${e.message}`;
      els["status-badge"].className = "status-badge hold";
    }
  } finally {
    setBusy(false);
  }
}

function renderReport(report) {
  state.report = report;
  const circumference = 327;
  els["gauge-arc"].style.strokeDashoffset = String(circumference - (circumference * report.readinessScore) / 100);
  els["gauge-arc"].style.stroke = report.status === "APPROVED" ? "#10b981" : "#ef4444";
  els["gauge-text"].textContent = `${report.readinessScore}%`;
  const badge = els["status-badge"];
  badge.textContent = report.status === "APPROVED" ? "APPROVED FOR PE SIGN-OFF" : "HOLD — REVISIONS REQUIRED";
  badge.className = `badge ${report.status === "APPROVED" ? "ok" : "hold"}`;

  els.violations.innerHTML = report.violations.length
    ? ""
    : '<p class="muted">No verified violations in the live audit result.</p>';
  for (const w of report.warnings ?? []) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = `Warning: ${w}`;
    els.violations.appendChild(p);
  }
  for (const v of report.violations) {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <span class="sev">${v.severity}</span>
      <h3>${v.id}: ${escapeHtml(v.title)}</h3>
      <p class="code">${escapeHtml(v.codeSection)}</p>
      <p><strong>Measured:</strong> ${escapeHtml(v.measuredValue)}</p>
      <p><strong>Required:</strong> ${escapeHtml(v.requiredValue)}</p>
      <button type="button">Redline This Violation</button>`;
    card.querySelector("button").addEventListener("click", generateRedline);
    els.violations.appendChild(card);
  }

  els.trace.innerHTML = "";
  for (const t of report.trace) {
    const details = document.createElement("details");
    details.className = "trace-node";
    details.innerHTML = `<summary>Node ${t.node} — ${escapeHtml(t.model)} · ${t.status} · ${t.latencyMs} ms</summary>`;
    els.trace.appendChild(details);
  }
  for (const m of report.mcpTrace) {
    const details = document.createElement("details");
    details.className = "trace-node";
    details.innerHTML = `<summary>MCP ${escapeHtml(m.tool)} · ${m.latencyMs} ms</summary><pre>${escapeHtml(
      JSON.stringify(m.input, null, 2) + "\n→ " + m.output,
    )}</pre>`;
    els.trace.appendChild(details);
  }

  drawOverlays(report);
  const redlineSrc = report.redlineUrl || (report.redlineImageBase64 ? `data:${report.redlineMime || "image/png"};base64,${report.redlineImageBase64}` : "");
  if (report.redlineUrl) state.redlineUrl = report.redlineUrl;
  if (report.revisedUrl) {
    state.revisedUrl = report.revisedUrl;
    els["revised-img"].src = report.revisedUrl;
    els["revised-img"].style.display = "block";
    const rph = $("revised-placeholder");
    if (rph) rph.style.display = "none";
  }
  if (redlineSrc) {
    els["redline-img"].src = redlineSrc;
    els["redline-img"].style.display = "block";
    const ph = $("compare-placeholder");
    if (ph) ph.style.display = "none";
  } else {
    els["redline-img"].src = "";
    els["redline-img"].style.display = "none";
    const ph = $("compare-placeholder");
    if (ph) ph.style.display = "block";
  }
  els["export-redline-img"].disabled = !state.redlineUrl;
  els["export-clean-img"].disabled = !state.revisedUrl;
  els["export-pkg"].disabled = !report.redlineKey && !report.revisedKey;
  els.permit.disabled = false;
  els["email-permit"].disabled = false;
  els.dataset.disabled = false;
}

function drawOverlays(report) {
  const svg = els.overlay;
  const layers = activeLayers();
  let html = "";
  for (const o of report.samOverlays) {
    const [x, y, x2, y2] = o.box_px;
    if (!x2 && !y2) continue;
    const color = o.compliant ? "#10b981" : "#ef4444";
    let mask = "";
    if (o.svg_path && o.mask_w && o.mask_h) {
      const sx = (x2 - x) / o.mask_w;
      const sy = (y2 - y) / o.mask_h;
      mask = `<path d="${o.svg_path}" transform="translate(${x} ${y}) scale(${sx} ${sy})" fill="${color}" fill-opacity="0.45" stroke="none"/>`;
    }
    html += `<g data-concept="${o.concept}"><rect x="${x}" y="${y}" width="${x2 - x}" height="${y2 - y}" fill="${color}" fill-opacity="0.14" stroke="${color}" stroke-width="2"/>${mask}<text class="callout" x="${x + 6}" y="${y + 16}" fill="${color}">${o.concept} #${o.objectId}</text></g>`;
  }
  for (const v of report.violations) {
    if (!layers.has("violation")) continue;
    const [x, y, x2, y2] = normToPx(v.normBox1000);
    html += `<g data-concept="violation"><rect x="${x}" y="${y}" width="${x2 - x}" height="${y2 - y}" fill="rgba(239,68,68,0.10)" stroke="#ef4444" stroke-width="2.5" stroke-dasharray="7 4"><animate attributeName="opacity" values="1;0.45;1" dur="1.6s" repeatCount="indefinite"/></rect><text class="callout" x="${x + 6}" y="${y - 8}">${v.id}: ${escapeHtml(v.codeSection)}</text></g>`;
  }
  svg.innerHTML = html;
  applyLayers();
}

function normToPx([x, y, x2, y2]) {
  return [(x * 1000) / 1000, (y * 800) / 1000, (x2 * 1000) / 1000, (y2 * 800) / 1000];
}

function activeLayers() {
  const layers = new Set();
  document.querySelectorAll("[data-layer]").forEach((i) => {
    if (i.checked) layers.add(i.dataset.layer);
  });
  return layers;
}

function applyLayers() {
  const layers = activeLayers();
  const all = layers.has("all");
  document.querySelectorAll("#overlay [data-concept]").forEach((g) => {
    const concept = g.dataset.concept;
    g.style.display = all || layers.has(concept) ? "" : "none";
  });
  els["compare-wrap"].classList.toggle("hidden", !layers.has("compare"));
  els["revised-wrap"].classList.toggle("hidden", !layers.has("revised"));
}

async function generateRedline() {
  if (!state.report) return;
  setBusy(true);
  try {
    // Dual generation: visual redline + clean revised plan (S3 keys + URLs only).
    const data = await api("/api/redline", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inspectionId: state.report.inspectionId }),
    });
    if (data.redline?.url) {
      state.redlineUrl = data.redline.url;
      state.revisedUrl = data.revised?.url || "";
      state.report.redlineKey = data.redline.key;
      state.report.revisedKey = data.revised?.key;
      els["redline-img"].src = data.redline.url;
      els["redline-img"].style.display = "block";
      const ph = $("compare-placeholder");
      if (ph) ph.style.display = "none";
      if (state.revisedUrl) {
        els["revised-img"].src = state.revisedUrl;
        els["revised-img"].style.display = "block";
        const rph = $("revised-placeholder");
        if (rph) rph.style.display = "none";
        document.querySelector('[data-layer="revised"]').checked = true;
      }
      document.querySelector('[data-layer="compare"]').checked = true;
      applyLayers();
    }
    els["export-redline-img"].disabled = !state.redlineUrl;
    els["export-clean-img"].disabled = !state.revisedUrl;
    els["export-pkg"].disabled = false;
  } catch (e) {
    console.error("Upload failed:", e);
    if (els["status-badge"]) {
      els["status-badge"].textContent = `Upload error: ${e.message}`;
      els["status-badge"].className = "status-badge hold";
    }
  } finally {
    setBusy(false);
  }
}

async function exportImage(url, kind) {
  if (!url) return;
  try {
    const blob = await (await fetch(url)).blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `planpass-${kind}-${state.report?.inspectionId ?? "plan"}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    console.error("Upload failed:", e);
    if (els["status-badge"]) {
      els["status-badge"].textContent = `Upload error: ${e.message}`;
      els["status-badge"].className = "status-badge hold";
    }
  }
}

async function exportPackage() {
  if (!state.report) return;
  try {
    const pkg = await api(`/api/inspections/${state.report.inspectionId}/package`);
    const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `planpass-package-${state.report.inspectionId}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    console.error("Upload failed:", e);
    if (els["status-badge"]) {
      els["status-badge"].textContent = `Upload error: ${e.message}`;
      els["status-badge"].className = "status-badge hold";
    }
  }
}

async function reverify() {
  // Re-inspect the CLEAN REVISED plan (no markup), never the redline image.
  if (!state.revisedUrl && !state.report?.revisedKey) return alert("Generate the redline + clean revised plan first, then re-inspect the clean plan.");
  setBusy(true);
  try {
    const { concepts, pixelsPerFoot, occupancy } = agentParams();
    const report = await api("/api/reverify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inspectionId: state.report?.inspectionId, concepts, pixelsPerFoot, occupancy }),
    });
    // Keep the comparison view pointing at the generated artifacts.
    report.redlineUrl = state.redlineUrl || report.redlineUrl;
    report.revisedUrl = state.revisedUrl || report.revisedUrl;
    renderReport(report);
    activateTab("audit");
  } catch (e) {
    console.error("Upload failed:", e);
    if (els["status-badge"]) {
      els["status-badge"].textContent = `Upload error: ${e.message}`;
      els["status-badge"].className = "status-badge hold";
    }
  } finally {
    setBusy(false);
  }
}

async function emailPermit() {
  if (!state.report) return;
  try {
    const data = await api(`/api/inspections/${state.report.inspectionId}/email-permit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    alert(data.sent ? `Permit packet emailed (id: ${data.id ?? "n/a"})` : `Email not sent: ${data.error ?? "unknown"}`);
  } catch (e) {
    alert(`Email failed: ${e.message}`);
  }
}

async function loadHistory() {
  try {
    const data = await api("/api/inspections");
    els.history.innerHTML = "";
    for (const row of data.inspections) {
      const li = document.createElement("li");
      li.style.cursor = "pointer";
      li.style.padding = "6px 8px";
      li.style.borderRadius = "4px";
      li.textContent = `${row.id} · ${row.status} · ${row.readiness_score}% · ${new Date(row.created_at).toLocaleString()}`;
      li.addEventListener("click", async () => {
        try {
          const report = await api(`/api/inspections/${row.id}`);
          if (row.plan_id) {
            const plan = await api(`/api/plans/${row.plan_id}`).catch(() => null);
            if (plan?.url) {
              els["plan-img"].src = plan.url;
              els["plan-img"].style.display = "block";
              els["stage-empty"].classList.add("hidden");
            }
          }
          renderReport(report);
          activateTab("audit");
        } catch (e) {
          alert(e.message);
        }
      });
      els.history.appendChild(li);
    }
    if (!data.inspections.length) els.history.innerHTML = "<li>No inspections yet.</li>";
  } catch {
    els.history.innerHTML = "<li>History unavailable.</li>";
  }
}

function download(path) {
  const a = document.createElement("a");
  a.href = path;
  a.click();
}

async function signOut() {
  await fetch("/api/auth/sign-out", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: "{}" });
  window.location.href = "/auth.html";
}

function setBusy(busy) {
  els.inspect.disabled = busy;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

// --- Pan / zoom ---
function applyTransform() {
  els.canvas.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.scale})`;
}
function setZoom(scale) {
  state.scale = Math.max(0.4, Math.min(4, scale));
  applyTransform();
}
function initPan() {
  let dragging = false;
  let last = { x: 0, y: 0 };
  els.viewport.addEventListener("pointerdown", (e) => {
    dragging = true;
    last = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener("pointerup", () => (dragging = false));
  window.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    state.pan.x += e.clientX - last.x;
    state.pan.y += e.clientY - last.y;
    last = { x: e.clientX, y: e.clientY };
    applyTransform();
  });
  els.viewport.addEventListener("wheel", (e) => {
    e.preventDefault();
    setZoom(state.scale * (e.deltaY < 0 ? 1.08 : 0.92));
  }, { passive: false });
}

// --- Voice push-to-talk + WAV encoding (Node 1 client) ---
function initVoice() {
  const canvas = $("waveform");
  const ctx = canvas.getContext("2d");
  let recorder = null;
  let chunks = [];
  let stream = null;
  let raf = 0;
  let audioCtx = null;

  const start = async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      els.transcript.textContent = "Microphone unavailable — type scope via preset chips.";
      return;
    }
    els.ptt.classList.add("recording");
    els.ptt.setAttribute("aria-pressed", "true");
    chunks = [];
    const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = async () => {
      els.ptt.classList.remove("recording");
      els.ptt.setAttribute("aria-pressed", "false");
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      const wav = await blobToWav(blob);
      const res = await fetch("/api/voice/transcribe", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "audio/wav" },
        body: wav,
      });
      const data = await res.json().catch(() => ({}));
      if (data.text) setInstruction(data.text);
      else els.transcript.textContent = data.error ? `Voice error: ${data.error}` : "No speech recognized — try a preset chip.";
    };
    recorder.start();
    audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 128;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const draw = () => {
      raf = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(data);
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#38bdf8";
      data.forEach((v, i) => ctx.fillRect(i * 4, canvas.height - v / 7, 3, v / 7));
    };
    draw();
  };
  const stop = () => recorder?.state === "recording" && recorder.stop();
  els.ptt.addEventListener("pointerdown", start);
  els.ptt.addEventListener("pointerup", stop);
  els.ptt.addEventListener("pointerleave", stop);
}

async function blobToWav(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 16000);
  const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
  const samples = decoded.getChannelData(0);
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, decoded.sampleRate, true);
  view.setUint32(28, decoded.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (const s of samples) {
    view.setInt16(offset, Math.max(-1, Math.min(1, s)) * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}
