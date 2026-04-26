import asyncio
import json
import os
from typing import Literal

import anthropic
import websockets
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from tavily import TavilyClient

load_dotenv()

DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY", "")
DEEPGRAM_URL = (
    "wss://api.deepgram.com/v1/listen"
    "?model=nova-2&interim_results=true&punctuate=true&endpointing=400"
)

TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")

app = FastAPI(title="live-fact-check", version="0.1.0")

origins = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

FACT_CHECK_SYSTEM = (
    "You are an expert fact-checker. Given a claim and web search results, "
    "analyze the evidence and return a JSON object with exactly these fields:\n"
    '- "verdict": one of "true", "false", "mixed", or "unverified"\n'
    '- "confidence": a float between 0.0 and 1.0\n'
    '- "explanation": 2-4 sentences grounded only in the provided sources\n\n'
    "Base your verdict solely on the search results provided. If the results are "
    "insufficient or conflicting, use \"mixed\" or \"unverified\" accordingly."
)

Verdict = Literal["true", "false", "mixed", "unverified"]


class CheckRequest(BaseModel):
    claim: str = Field(min_length=1, max_length=2000)


class Source(BaseModel):
    title: str
    url: str


class CheckResponse(BaseModel):
    claim: str
    verdict: Verdict
    confidence: float
    explanation: str
    sources: list[Source]


async def _claude_verdict(claim: str, results: list[dict]) -> tuple[Verdict, float, str]:
    client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)

    search_context = "\n\n".join(
        f"Title: {r.get('title', '')}\nURL: {r.get('url', '')}\n"
        f"Content: {r.get('content', '')[:800]}"
        for r in results
    )

    response = await client.messages.create(
        model="claude-opus-4-7",
        max_tokens=1024,
        thinking={"type": "adaptive"},
        system=[
            {
                "type": "text",
                "text": FACT_CHECK_SYSTEM,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        output_config={
            "format": {
                "type": "json_schema",
                "name": "fact_check_result",
                "schema": {
                    "type": "object",
                    "properties": {
                        "verdict": {
                            "type": "string",
                            "enum": ["true", "false", "mixed", "unverified"],
                        },
                        "confidence": {"type": "number"},
                        "explanation": {"type": "string"},
                    },
                    "required": ["verdict", "confidence", "explanation"],
                    "additionalProperties": False,
                },
            }
        },
        messages=[
            {
                "role": "user",
                "content": f"Claim: {claim}\n\nSearch results:\n{search_context}",
            }
        ],
    )

    text = next((b.text for b in response.content if b.type == "text"), "{}")
    data = json.loads(text)
    verdict: Verdict = data["verdict"]
    confidence: float = float(data["confidence"])
    explanation: str = data["explanation"]
    return verdict, confidence, explanation


def _fallback_verdict(claim: str, results: list[dict]) -> tuple[Verdict, float, str]:
    """Word-count heuristic used when Anthropic key is absent."""
    content_all = " ".join(r.get("content", "") for r in results).lower()
    contradiction_words = ["false", "myth", "incorrect", "not true", "debunked", "misleading"]
    confirmation_words = ["true", "correct", "confirmed", "proven", "accurate", "verified"]
    contra = sum(content_all.count(w) for w in contradiction_words)
    confirm = sum(content_all.count(w) for w in confirmation_words)
    total = contra + confirm
    if total == 0:
        return "unverified", 0.0, "Could not find enough information to assess this claim."
    ratio = confirm / total
    if ratio >= 0.65:
        return "true", round(ratio, 2), "Sources generally support this claim."
    if ratio <= 0.35:
        return "false", round(1 - ratio, 2), "Sources generally contradict this claim."
    return "mixed", 0.5, "Sources give conflicting signals on this claim."


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/check", response_model=CheckResponse)
async def check(req: CheckRequest) -> CheckResponse:
    claim = req.claim.strip()

    if not TAVILY_API_KEY:
        return CheckResponse(
            claim=claim,
            verdict="unverified",
            confidence=0.0,
            explanation="TAVILY_API_KEY is not configured.",
            sources=[],
        )

    client = TavilyClient(api_key=TAVILY_API_KEY)
    response = client.search(
        query=f'fact check: "{claim}"',
        search_depth="advanced",
        max_results=5,
        include_answer=True,
    )

    results = response.get("results", [])
    sources = [
        Source(title=r.get("title", r["url"]), url=r["url"])
        for r in results
        if r.get("url")
    ]

    if ANTHROPIC_API_KEY:
        verdict, confidence, explanation = await _claude_verdict(claim, results)
    else:
        verdict, confidence, explanation = _fallback_verdict(claim, results)
        if answer := response.get("answer"):
            explanation = answer

    return CheckResponse(
        claim=claim,
        verdict=verdict,
        confidence=confidence,
        explanation=explanation,
        sources=sources,
    )


@app.websocket("/api/transcribe")
async def transcribe(ws: WebSocket) -> None:
    await ws.accept()

    if not DEEPGRAM_API_KEY:
        await ws.send_json({"error": "DEEPGRAM_API_KEY not set"})
        await ws.close()
        return

    try:
        async with websockets.connect(
            DEEPGRAM_URL,
            additional_headers={"Authorization": f"Token {DEEPGRAM_API_KEY}"},
        ) as dg:

            async def client_to_deepgram() -> None:
                try:
                    while True:
                        data = await ws.receive_bytes()
                        await dg.send(data)
                except (WebSocketDisconnect, Exception):
                    await dg.send(json.dumps({"type": "CloseStream"}))

            async def deepgram_to_client() -> None:
                async for message in dg:
                    try:
                        await ws.send_text(message)
                    except Exception:
                        break

            await asyncio.gather(client_to_deepgram(), deepgram_to_client())

    except Exception as exc:
        await ws.send_json({"error": str(exc)})
        await ws.close()
