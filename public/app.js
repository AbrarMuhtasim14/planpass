const state = {
  user: null,
  report: null,
  benchmarkId: "",
  planId: null,
  imageBase64: "",
  imageMime: "image/png",
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
    throw new Error("Unauthorized");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `Request failed (${res.status})`);
  return data;
}

document.addEventListener("DOMContentLoaded", init);

async function init() {
  ["occupancy", "benchmark", "upload", "signout", "ptt", "transcript", "plan-img", "overlay", "viewport", "canvas", "compare-wrap", "redline-img", "stage-empty", "gauge-arc", "gauge-text", "status-badge", "violations", "trace", "history", "inspect", "redline", "reverify", "permit", "dataset", "refresh-history"].forEach((id) => (els[id] = $(id)));
  const me = await fetch("/api/me", { credentials: "include" });
  if (!me.ok) {
    window.location.href = "/auth.html";
    return;
  }
  state.user = (await me.json()).user;

  els.benchmark.addEventListener("change", loadBenchmark);
  els.upload.addEventListener("change", uploadPlan);
  els.inspect.addEventListener("click", runInspection);
  els.redline.addEventListener("click", generateRedline);
  els.reverify.addEventListener("click", reverify);
  els.permit.addEventListener("click", () => download(`/api/inspections/${state.report.inspectionId}/permit.pdf`));
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
  els.transcript.textContent = text || "No voice scope yet — or pick a preset:";
}

async function loadBenchmark() {
  const id = els.benchmark.value;
  state.benchmarkId = id;
  state.planId = null;
  if (!id) return;
  const res = await fetch(`/benchmarks/${id === "residential-adu" ? "residential-adu" : id}.svg`);
  // Benchmark files are cafe-violation.svg / cafe-compliant.svg / residential-adu.svg
  const file = { "cafe-violation": "cafe-violation.svg", "cafe-compliant": "cafe-compliant.svg", "residential-adu": "residential-adu.svg" }[id];
  const svgRes = await fetch(`/benchmarks/${file}`);
  els["plan-img"].src = URL.createObjectURL(await svgRes.blob());
  els["plan-img"].style.display = "block";
  els["stage-empty"].classList.add("hidden");
  setInstruction(
    id === "residential-adu"
      ? "Check this ADU for bedroom egress window and habitable room area."
      : "Audit this commercial floorplan for ADA restroom clearance and IBC egress corridor width",
  );
  runBenchmarkInspection(id);
}

async function runBenchmarkInspection(id) {
  setBusy(true);
  try {
    const report = await api(`/api/inspect/benchmark/${id}`, { method: "POST" });
    renderReport(report);
  } catch (e) {
    alert(e.message);
  } finally {
    setBusy(false);
  }
}

async function uploadPlan(event) {
  const file = event.target.files[0];
  if (!file) return;
  const form = new FormData();
  form.append("file", file);
  try {
    const data = await api("/api/plans/upload", { method: "POST", body: form });
    state.planId = data.plan.id;
    state.benchmarkId = "";
    els["plan-img"].src = data.plan.url;
    els["plan-img"].style.display = "block";
    els["stage-empty"].classList.add("hidden");
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    bytes.forEach((b) => (binary += String.fromCharCode(b)));
    state.imageBase64 = btoa(binary);
    state.imageMime = file.type || "image/png";
  } catch (e) {
    alert(e.message);
  }
}

async function runInspection() {
  if (state.benchmarkId) return runBenchmarkInspection(state.benchmarkId);
  if (!state.planId && !state.imageBase64) return alert("Select a benchmark or upload a floorplan first.");
  setBusy(true);
  try {
    const report = await api("/api/inspect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        planId: state.planId,
        imageBase64: state.imageBase64 || undefined,
        imageMime: state.imageMime,
        occupancy: els.occupancy.value,
        instruction: state.instruction,
        transcript: state.instruction,
      }),
    });
    renderReport(report);
  } catch (e) {
    alert(e.message);
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
    : '<p class="muted">No violations — all sampled IBC / ADA / IRC checks pass.</p>';
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
  if (report.redlineImageBase64) {
    els["redline-img"].src = `data:${report.redlineMime || "image/png"};base64,${report.redlineImageBase64}`;
    els["redline-img"].style.display = "block";
    const ph = $("compare-placeholder");
    if (ph) ph.style.display = "none";
  } else {
    els["redline-img"].src = "";
    els["redline-img"].style.display = "none";
    const ph = $("compare-placeholder");
    if (ph) ph.style.display = "block";
  }
  els.redline.disabled = report.status !== "HOLD";
  els.reverify.disabled = true;
  els.permit.disabled = report.status !== "APPROVED";
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
    html += `<g data-concept="${o.concept}"><rect x="${x}" y="${y}" width="${x2 - x}" height="${y2 - y}" fill="${color}" fill-opacity="0.14" stroke="${color}" stroke-width="2"/><text class="callout" x="${x + 6}" y="${y + 16}" fill="${color}">${o.concept} #${o.objectId}</text></g>`;
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
}

async function generateRedline() {
  if (!state.report) return;
  setBusy(true);
  try {
    const data = await api("/api/redline", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        inspectionId: state.report.inspectionId,
        benchmarkId: state.benchmarkId || undefined,
        imageBase64: state.benchmarkId ? undefined : state.imageBase64 || undefined,
        mode: state.benchmarkId === "cafe-violation" ? "deterministic" : state.imageBase64 ? "live" : "deterministic",
      }),
    });
    if (data.redlineImageBase64) {
      els["redline-img"].src = `data:${data.redlineMime};base64,${data.redlineImageBase64}`;
      els["redline-img"].style.display = "block";
      const ph = $("compare-placeholder");
      if (ph) ph.style.display = "none";
      document.querySelector('[data-layer="compare"]').checked = true;
      applyLayers();
    }
    if (data.reverifiedReport) renderReport(data.reverifiedReport);
    els.reverify.disabled = false;
    if (data.reverifiedReport) activateTab("audit");
  } catch (e) {
    alert(e.message);
  } finally {
    setBusy(false);
  }
}

async function reverify() {
  if (state.benchmarkId || state.report?.source === "redline") {
    const data = await api("/api/redline", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ benchmarkId: "cafe-violation", mode: "deterministic", inspectionId: state.report?.inspectionId }),
    });
    if (data.reverifiedReport) renderReport(data.reverifiedReport);
    return;
  }
  runInspection();
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
          } else if (report.planId) {
            const file = { "cafe-violation": "cafe-violation.svg", "cafe-compliant": "cafe-compliant.svg", "residential-adu": "residential-adu.svg" }[report.planId];
            if (file) {
              els["plan-img"].src = `/benchmarks/${file}`;
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
  els.redline.disabled = busy || state.report?.status !== "HOLD";
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
