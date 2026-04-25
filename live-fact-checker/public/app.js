const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const toggleBtn = document.getElementById("toggle");
const clearBtn = document.getElementById("clear");
const statusEl = document.getElementById("status");
const dotEl = document.getElementById("dot");
const transcriptEl = document.getElementById("transcript");
const checksEl = document.getElementById("checks");
const hintEl = document.getElementById("hint");

const CHECK_INTERVAL_MS = 6000;
const MIN_NEW_CHARS = 60;
const CONTEXT_WINDOW_MS = 120_000;

let recognition = null;
let listening = false;
let inflight = false;
let transcriptBuffer = []; // {text, ts}
let lastSentChars = 0;
let interimEl = null;

if (!SR) {
  toggleBtn.disabled = true;
  setStatus("SpeechRecognition not supported — use Chrome or Edge.", "error");
}

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = "status " + cls;
  dotEl.className = "dot " + (cls === "listening" ? "live" : cls === "checking" ? "checking" : "");
}

function appendFinal(text) {
  removeInterim();
  const div = document.createElement("div");
  div.className = "line";
  div.textContent = text;
  transcriptEl.appendChild(div);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function showInterim(text) {
  if (!interimEl) {
    interimEl = document.createElement("div");
    interimEl.className = "line interim";
    transcriptEl.appendChild(interimEl);
  }
  interimEl.textContent = text;
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function removeInterim() {
  if (interimEl) {
    interimEl.remove();
    interimEl = null;
  }
}

function startRecognition() {
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = navigator.language?.startsWith("en") ? navigator.language : "en-US";

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      const text = r[0].transcript.trim();
      if (!text) continue;
      if (r.isFinal) {
        transcriptBuffer.push({ text, ts: Date.now() });
        appendFinal(text);
      } else {
        showInterim(text);
      }
    }
  };

  recognition.onerror = (e) => {
    console.warn("SpeechRecognition error:", e.error);
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      setStatus("Microphone blocked. Allow access and reload.", "error");
      stopListening();
    } else if (e.error === "no-speech") {
      // ignore — recognition will restart
    } else {
      setStatus("Mic: " + e.error, "error");
    }
  };

  recognition.onend = () => {
    if (listening) {
      try { recognition.start(); } catch { /* already started */ }
    }
  };

  try {
    recognition.start();
  } catch (e) {
    console.warn(e);
  }
}

function stopListening() {
  listening = false;
  if (recognition) {
    try { recognition.onend = null; recognition.stop(); } catch {}
    recognition = null;
  }
  toggleBtn.textContent = "Start listening";
  setStatus("Idle", "idle");
}

function startListening() {
  listening = true;
  startRecognition();
  toggleBtn.textContent = "Stop listening";
  setStatus("Listening", "listening");
}

async function checkLoop() {
  if (!listening || inflight) return;

  const totalChars = transcriptBuffer.reduce((n, x) => n + x.text.length + 1, 0);
  const newChars = totalChars - lastSentChars;
  if (newChars < MIN_NEW_CHARS) return;

  const cutoff = Date.now() - CONTEXT_WINDOW_MS;
  const windowText = transcriptBuffer
    .filter((i) => i.ts >= cutoff)
    .map((i) => i.text)
    .join(" ")
    .slice(-2000);

  inflight = true;
  setStatus("Checking…", "checking");
  try {
    const res = await fetch("/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: windowText }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    (data.claims || []).forEach(renderClaim);
    lastSentChars = totalChars;
    setStatus("Listening", "listening");
  } catch (err) {
    console.error(err);
    setStatus("Check failed — retrying", "error");
  } finally {
    inflight = false;
  }
}

function renderClaim(claim) {
  const verdict = (claim.verdict || "unverified").toLowerCase();
  const card = document.createElement("div");
  card.className = "claim " + verdict;

  const sources = (claim.sources || [])
    .slice(0, 3)
    .map((u) => {
      let host = u;
      try { host = new URL(u).hostname.replace(/^www\./, ""); } catch {}
      return `<a href="${escapeAttr(u)}" target="_blank" rel="noopener">${escapeHtml(host)}</a>`;
    })
    .join(" · ");

  card.innerHTML = `
    <div class="verdict">${escapeHtml(verdict.toUpperCase())}</div>
    <div class="claim-text">${escapeHtml(claim.claim || "")}</div>
    ${claim.correction ? `<div class="correction">↪ ${escapeHtml(claim.correction)}</div>` : ""}
    ${claim.explanation ? `<div class="explanation">${escapeHtml(claim.explanation)}</div>` : ""}
    ${sources ? `<div class="sources">${sources}</div>` : ""}
  `;
  checksEl.prepend(card);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
function escapeAttr(s) { return escapeHtml(s); }

toggleBtn.addEventListener("click", () => {
  if (listening) stopListening();
  else startListening();
});

clearBtn.addEventListener("click", async () => {
  transcriptBuffer = [];
  lastSentChars = 0;
  transcriptEl.innerHTML = "";
  checksEl.innerHTML = "";
  try { await fetch("/reset", { method: "POST" }); } catch {}
});

setInterval(checkLoop, CHECK_INTERVAL_MS);

hintEl.textContent = "Tip: add this URL as a Browser Source in OBS for an on-stream overlay.";
