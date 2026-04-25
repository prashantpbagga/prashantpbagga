import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";

const app = express();
const client = new Anthropic();

app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

const MODEL = process.env.FACT_CHECK_MODEL || "claude-sonnet-4-6";
const MAX_SEARCHES = Number(process.env.MAX_SEARCHES || 4);

const SYSTEM_PROMPT = `You are a real-time fact-checker for a live stream of friends chatting.

You receive a rolling transcript and a list of claims that have already been checked in earlier turns. Your job:

1. Read the transcript and identify SPECIFIC, VERIFIABLE factual claims that have NOT already been checked. Things worth checking: numbers, dates, names, attributions, historical events, scientific facts, statistics, "did you know" trivia, "X is the largest/oldest/first…" statements.
2. SKIP: opinions, jokes, hypotheticals, predictions, personal anecdotes, vague statements, and anything already in the "previously checked" list (even paraphrased).
3. For each new claim worth checking, call the web_search tool to verify it. Prefer authoritative sources.
4. After your searches, output ONLY a single JSON array (no prose, no markdown fences) with this exact shape:

[
  {
    "claim": "<concise paraphrase of the claim as stated>",
    "verdict": "true" | "false" | "misleading" | "unverified",
    "correction": "<if false or misleading, the accurate fact in one short sentence; else empty string>",
    "explanation": "<one short sentence on what the source says>",
    "sources": ["<url>", "<url>"]
  }
]

If nothing new is worth checking, output exactly: []
Keep it tight — at most 3 claims per response, prioritise the most clearly checkable ones.`;

const seenClaims = new Set();

function normaliseClaim(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractJsonArray(text) {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

app.post("/check", async (req, res) => {
  const transcript = String(req.body?.transcript || "").trim();
  if (transcript.length < 30) return res.json({ claims: [] });

  const previouslyChecked = [...seenClaims].slice(-40).join("\n- ");
  const userContent =
    `Previously checked claims (do not repeat):\n- ${previouslyChecked || "(none yet)"}` +
    `\n\nRolling transcript (newest content is at the end):\n"""\n${transcript}\n"""`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: MAX_SEARCHES,
        },
      ],
      messages: [{ role: "user", content: userContent }],
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const raw = extractJsonArray(text);
    const fresh = [];
    for (const c of raw) {
      const key = normaliseClaim(c.claim);
      if (!key || seenClaims.has(key)) continue;
      seenClaims.add(key);
      fresh.push({
        claim: c.claim || "",
        verdict: ["true", "false", "misleading", "unverified"].includes(c.verdict)
          ? c.verdict
          : "unverified",
        correction: c.correction || "",
        explanation: c.explanation || "",
        sources: Array.isArray(c.sources) ? c.sources.filter(Boolean).slice(0, 4) : [],
      });
    }

    res.json({ claims: fresh });
  } catch (err) {
    console.error("[fact-check error]", err);
    res.status(500).json({ error: err?.message || "fact-check failed" });
  }
});

app.post("/reset", (_req, res) => {
  seenClaims.clear();
  res.json({ ok: true });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Live fact-checker running at http://localhost:${port}`);
});
