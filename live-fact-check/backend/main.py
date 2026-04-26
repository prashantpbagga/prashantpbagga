import asyncio
import json
import os
from typing import Literal

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

app = FastAPI(title="live-fact-check", version="0.1.0")

origins = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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


def _derive_verdict(claim: str, results: list[dict]) -> tuple[Verdict, float, str]:
    """
    Simple heuristic: look for contradiction/confirmation signals in result
    content. Replace with an LLM call for higher accuracy.
    """
    claim_lower = claim.lower()
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
        verdict: Verdict = "true"
        confidence = round(ratio, 2)
        explanation = "Sources generally support this claim."
    elif ratio <= 0.35:
        verdict = "false"
        confidence = round(1 - ratio, 2)
        explanation = "Sources generally contradict this claim."
    else:
        verdict = "mixed"
        confidence = 0.5
        explanation = "Sources give conflicting signals on this claim."

    return verdict, confidence, explanation


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

    verdict, confidence, explanation = _derive_verdict(claim, results)

    # Prefer Tavily's own answer summary if available
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
