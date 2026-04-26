import { useState } from "react";

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

  async function onSubmit(e) {
    e.preventDefault();
    if (!claim.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setResult(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="container">
      <h1>live-fact-check</h1>
      <p className="subtitle">Paste a claim and get a verdict.</p>

      <form onSubmit={onSubmit}>
        <textarea
          value={claim}
          onChange={(e) => setClaim(e.target.value)}
          placeholder="e.g. The Eiffel Tower is taller than the Statue of Liberty."
          rows={4}
        />
        <button type="submit" disabled={loading || !claim.trim()}>
          {loading ? "Checking..." : "Check"}
        </button>
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
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
