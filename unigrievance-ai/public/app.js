const DEPARTMENTS = {
  electricity: { label: "Electricity Board", icon: "⚡", color: "#E8A33D" },
  roads: { label: "Roads & Infrastructure", icon: "🛣️", color: "#D98A5F" },
  water: { label: "Water Supply", icon: "💧", color: "#4FA37D" },
  municipal: { label: "Municipal Corporation", icon: "🏢", color: "#8FA0C9" },
  cyber: { label: "Cyber Cell", icon: "🛡️", color: "#C9584B" },
  other: { label: "General / Other", icon: "❔", color: "#8B93A7" },
};

const sevColor = (s) => (s === "High" ? "#C9584B" : s === "Medium" ? "#E8A33D" : "#4FA37D");

let groups = [];
let filterDept = "all";
let sessionLog = [];
let hasLoaded = false;
const expanded = new Set();

const $ = (sel) => document.querySelector(sel);

// ---------- tabs ----------
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const view = btn.dataset.view;
    $("#view-file").hidden = view !== "file";
    $("#view-dashboard").hidden = view !== "dashboard";
    if (view === "dashboard") renderDashboard();
  });
});

// ---------- department filter chips ----------
document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    filterDept = chip.dataset.dept;
    renderDashboard();
  });
});

$("#refresh-btn").addEventListener("click", loadComplaints);

// ---------- voice input (live-updating transcript, Hindi/English + other Indian langs) ----------
let recognizer = null;
let recording = false;
let baseText = ""; // text already in the box before this recording session started

function stopRecordingUI() {
  recording = false;
  $("#mic-btn").classList.remove("recording");
  $("#mic-btn").innerHTML = `<span class="mic-dot"></span> Voice`;
}

$("#mic-btn").addEventListener("click", () => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    showError("Voice input needs a Chromium-based browser (Chrome/Edge).");
    return;
  }
  if (recording) {
    recognizer?.stop();
    return;
  }
  const box = $("#complaint-text");
  baseText = box.value.trim();

  recognizer = new SR();
  // "auto-detect" isn't natively supported by Web Speech API, so we use the
  // citizen's selected language (defaults to Hindi+English mixed via en-IN,
  // which Chrome's recognizer handles reasonably for Hinglish speech).
  recognizer.lang = $("#lang-select").value || "en-IN";
  recognizer.interimResults = true;
  recognizer.continuous = true;
  recognizer.maxAlternatives = 1;

  recognizer.onresult = (e) => {
    let finalChunk = "";
    let interimChunk = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const transcript = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalChunk += transcript + " ";
      else interimChunk += transcript;
    }
    if (finalChunk) baseText = (baseText ? baseText + " " : "") + finalChunk.trim();
    // live-update: committed text + greyed-out interim guess, updated on every word
    box.value = interimChunk ? `${baseText} ${interimChunk}` : baseText;
  };
  recognizer.onend = stopRecordingUI;
  recognizer.onerror = stopRecordingUI;

  recognizer.start();
  recording = true;
  $("#mic-btn").classList.add("recording");
  $("#mic-btn").innerHTML = `<span class="mic-dot"></span> Listening…`;
});

// ---------- submit complaint ----------
$("#submit-btn").addEventListener("click", submitComplaint);

async function submitComplaint() {
  const text = $("#complaint-text").value.trim();
  if (!text) return;
  const btn = $("#submit-btn");
  btn.disabled = true;
  btn.textContent = "⏳ AI is reading your complaint…";
  hideError();

  try {
    const res = await fetch("/api/complaints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Something went wrong");

    sessionLog.unshift(data);
    renderResult(data);
    renderSessionLog();
    $("#complaint-text").value = "";
    await loadComplaints();
  } catch (err) {
    showError(err.message || "The AI counter is busy right now. Please try again.");
  } finally {
    btn.disabled = false;
    btn.textContent = "➤ Submit complaint";
  }
}

function showError(msg) {
  const el = $("#error-msg");
  el.textContent = "⚠ " + msg;
  el.hidden = false;
}
function hideError() {
  $("#error-msg").hidden = true;
}

function renderResult({ group, isNew, reply, telemetry }) {
  const meta = DEPARTMENTS[group.department] || DEPARTMENTS.other;
  const t = telemetry || {
    category: group.department,
    urgency: group.severity,
    stackCount: group.reports.length,
    targetPortal: group.targetPortal,
  };

  const lines = [
    { label: "AI ANALYSIS", text: `Detected category: <b>${meta.label}</b> &nbsp;·&nbsp; Urgency: <b style="color:${sevColor(t.urgency)}">${t.urgency}</b>` },
  ];
  if (!isNew) {
    lines.push({
      label: "STACKING",
      text: `Matched with ${t.stackCount - 1} existing local report${t.stackCount - 1 > 1 ? "s" : ""} — community priority amplified to <b style="color:var(--accent)">×${t.stackCount}</b>`,
    });
  }
  lines.push({ label: "AUTO-ROUTING", text: `Structured payload dispatched → <span class="mono-url">${escapeHTML(t.targetPortal)}</span>` });
  lines.push({ label: "STATUS", text: `✓ Ticket <b>${group.id}</b> confirmed`, success: true });

  const linesHTML = lines
    .map(
      (l, i) => `
      <div class="telemetry-line" style="animation-delay:${i * 0.18}s">
        <span class="t-label${l.success ? " t-label-ok" : ""}">${l.label}</span>
        <span class="t-text">${l.text}</span>
      </div>`
    )
    .join("");

  $("#result-area").innerHTML = `
    <div class="telemetry">
      <div class="telemetry-head"><span class="live-dot"></span> LIVE ROUTING TRACE</div>
      ${linesHTML}
    </div>
    <p class="result-label">${isNew ? "New ticket printed" : `Merged into existing issue`}</p>
    ${stubHTML(group)}
    <div class="reply-box"><span class="reply-tag">🌐 Citizen reply</span>${escapeHTML(reply)}</div>
  `;
  bindStubEvents($("#result-area"));
}

function renderSessionLog() {
  if (sessionLog.length <= 1) {
    $("#session-log").innerHTML = "";
    return;
  }
  const items = sessionLog
    .slice(1)
    .map((s) => `<p class="session-item">${s.isNew ? "Filed" : "Merged"} — ${escapeHTML(s.group.title)}</p>`)
    .join("");
  $("#session-log").innerHTML = `<p class="section-label" style="margin:24px 4px 8px;">Earlier this session</p>${items}`;
}

// ---------- dashboard ----------
async function loadComplaints() {
  try {
    const res = await fetch("/api/complaints");
    groups = await res.json();
  } catch {
    groups = groups || [];
  }
  hasLoaded = true;
  renderStats();
  if (!$("#view-dashboard").hidden) renderDashboard();
}

function renderStats() {
  const totalReports = groups.reduce((s, g) => s + g.reports.length, 0);
  const unique = groups.length;
  const merged = Math.max(totalReports - unique, 0);
  const depts = new Set(groups.map((g) => g.department)).size;
  $("#stat-total").textContent = totalReports;
  $("#stat-unique").textContent = unique;
  $("#stat-merged").textContent = merged;
  $("#stat-depts").textContent = depts;
}

function renderDashboard() {
  const visible = groups
    .filter((g) => filterDept === "all" || g.department === filterDept)
    .sort((a, b) => b.reports.length - a.reports.length || b.createdAt - a.createdAt);

  if (!hasLoaded && visible.length === 0) {
    $("#dashboard-list").innerHTML = `
      <div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>`;
    return;
  }
  if (visible.length === 0) {
    $("#dashboard-list").innerHTML = `<p class="empty-msg">No tickets yet for this filter. File a complaint to see it appear here.</p>`;
    return;
  }
  $("#dashboard-list").innerHTML = visible.map(stubHTML).join("");
  bindStubEvents($("#dashboard-list"));
}

function stubHTML(g) {
  const meta = DEPARTMENTS[g.department] || DEPARTMENTS.other;
  const stacked = g.reports.length > 1;
  const isExpanded = expanded.has(g.id);
  const statusColor = g.status === "Resolved" ? "#4FA37D" : "#E8A33D";
  const statusIcon = g.status === "Resolved" ? "✓" : "📡";

  const reportsHTML = g.reports
    .map(
      (r) => `
      <div class="report-item">
        <div class="report-item-top"><span>🌐 ${escapeHTML(r.language)}</span><span>${new Date(r.timestamp).toLocaleString("en-IN")}</span></div>
        <p>${escapeHTML(r.translatedText)}</p>
      </div>`
    )
    .join("");

  return `
    <div class="stub" data-id="${g.id}">
      <div class="stub-top">
        <div style="display:flex;gap:12px;align-items:flex-start;min-width:0;">
          <div class="stub-icon" style="background:${meta.color}22;border:1px solid ${meta.color}55;">${meta.icon}</div>
          <div style="min-width:0;">
            <p class="stub-token">TOKEN ${g.id}</p>
            <p class="stub-title">${escapeHTML(g.title)}</p>
          </div>
        </div>
        ${stacked ? `<div class="stub-stack">📚 ×${g.reports.length}</div>` : ""}
      </div>
      <div class="perforation"></div>
      <div class="stub-meta">
        <span class="badge" style="color:${meta.color};background:${meta.color}22;border:1px solid ${meta.color}55;">${meta.label}</span>
        <span class="badge" style="color:#0F1A30;background:${sevColor(g.severity)};">${g.severity}</span>
        <span class="badge-loc">📍 ${escapeHTML(g.location)}</span>
        <span class="badge-status" style="color:${statusColor};">${statusIcon} ${g.status}</span>
      </div>
      <button class="stub-toggle" data-action="toggle">${isExpanded ? "Hide reports" : `View ${g.reports.length} citizen report${g.reports.length > 1 ? "s" : ""}`}</button>
      ${isExpanded ? `<div class="reports-list">${reportsHTML}</div>` : ""}
      ${g.status !== "Resolved" ? `<button class="resolve-btn" data-action="resolve">Mark resolved (demo)</button>` : ""}
    </div>
  `;
}

function bindStubEvents(container) {
  container.querySelectorAll(".stub").forEach((stub) => {
    const id = stub.dataset.id;
    const toggleBtn = stub.querySelector('[data-action="toggle"]');
    const resolveBtn = stub.querySelector('[data-action="resolve"]');
    if (toggleBtn) {
      toggleBtn.addEventListener("click", () => {
        if (expanded.has(id)) expanded.delete(id);
        else expanded.add(id);
        if (!$("#view-dashboard").hidden) renderDashboard();
        else if ($("#result-area").innerHTML.includes(id)) {
          const item = sessionLog[0];
          if (item) renderResult(item);
        }
      });
    }
    if (resolveBtn) {
      resolveBtn.addEventListener("click", async () => {
        await fetch(`/api/complaints/${id}/resolve`, { method: "PATCH" });
        await loadComplaints();
      });
    }
  });
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// ---------- init ----------
loadComplaints();
setInterval(loadComplaints, 10000);
