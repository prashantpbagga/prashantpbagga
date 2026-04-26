import os
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv()

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


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/check", response_model=CheckResponse)
async def check(req: CheckRequest) -> CheckResponse:
    # Placeholder verdict logic. Wire this up to a search/LLM provider
    # (e.g. Anthropic + a web-search tool) before shipping.
    claim = req.claim.strip()
    return CheckResponse(
        claim=claim,
        verdict="unverified",
        confidence=0.0,
        explanation=(
            "No fact-check provider is configured yet. Add one in "
            "backend/main.py:check to return a real verdict."
        ),
        sources=[],
    )
