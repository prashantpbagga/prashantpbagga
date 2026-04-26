import { useState, useRef } from "react";

const VERDICT_LABEL = {
  true: "True",
  false: "False",
  mixed: "Mixed",
  unverified: "Unverified",
};

export default function App() {
  const [claim, setClaim] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [isRecording, setIsRecording] = useState(false);
  const [interim, setInterim] = useState("");

  const wsRef = useRef(null);
  const recorderRef = useRef(null);

  async function startRecording() {
    setError(null);
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Microphone access denied.");
      return;
    }

    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/api/transcribe`);
    wsRef.current = ws;

    ws.onmessage = (evt) => {
      let data;
      try { data = JSON.parse(evt.data); } catch { return; }

      if (data.error) { setError(data.error); stopRecording(); return; }
      if (data.type !== "Results") return;

      const alt = data.channel?.alternatives?.[0];
      if (!alt?.transcript) return;

      if (data.is_final) {
        setClaim((prev) => (prev + " " + alt.transcript).trim());
        setInterim("");
      } else {
        setInterim(alt.transcript);
      }
    };

    ws.onerror = () => setError("WebSocket error — is the backend running?");

    await new Promise((res) => ws.addEventListener("open", res));

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";

    const recorder = new MediaRecorder(stream, { mimeType });
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(e.data);
    };

    recorder.start(250);
    setIsRecording(true);
  }

  function stopRecording() {
    recorderRef.current?.stop();
    recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    wsRef.current?.close();
    setIsRecording(false);
    setInterim("");
  }

  async function onSubmit(e) {
    e.preventDefault();
    const text = claim.trim();
    if (!text) return;
    if (isRecording) stopRecording();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim: text }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setResult(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const displayText = claim + (interim ? " " + interim : "");

  return (
    <main className="container">
      <h1>live-fact-check</h1>
      <p className="subtitle">Type a claim or speak it live, then hit Check.</p>

      <form onSubmit={onSubmit}>
        <div className="textarea-wrap">
          <textarea
            value={displayText}
            onChange={(e) => { setClaim(e.target.value); setInterim(""); }}
            placeholder="e.g. The Eiffel Tower is taller than the Statue of Liberty."
            rows={4}
            disabled={isRecording}
          />
          {isRecording && <span className="rec-dot" title="Recording" />}
        </div>

        <div className="actions">
          <button type="submit" disabled={loading || !displayText.trim()}>
            {loading ? "Checking…" : "Check"}
          </button>

          <button
            type="button"
            className={isRecording ? "btn-stop" : "btn-mic"}
            onClick={isRecording ? stopRecording : startRecording}
          >
            {isRecording ? "Stop" : "Speak"}
          </button>

          {(claim || interim) && (
            <button
              type="button"
              className="btn-clear"
              onClick={() => { setClaim(""); setInterim(""); setResult(null); setError(null); }}
            >
              Clear
            </button>
          )}
        </div>
      </form>

      {error && <p className="error">Error: {error}</p>}

      {result && (
        <section className={`result verdict-${result.verdict}`}>
          <h2>{VERDICT_LABEL[result.verdict] ?? result.verdict}</h2>
          <p className="confidence">
            Confidence: {(result.confidence * 100).toFixed(0)}%
          </p>
          <p>{result.explanation}</p>
          {result.sources.length > 0 && (
            <ul>
              {result.sources.map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
