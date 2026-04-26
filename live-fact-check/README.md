# live-fact-check

Python (FastAPI) backend + React (Vite) frontend for checking claims.

## Layout

```
live-fact-check/
  backend/    FastAPI app exposing /api/check
  frontend/   React + Vite UI that calls the backend
```

## Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload --port 8000
```

The `/api/check` endpoint currently returns an `unverified` placeholder. Wire
up a real provider (search API, Anthropic with web-search, etc.) in
`backend/main.py:check`.

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Vite dev server runs on `http://localhost:5173` and proxies `/api/*` to the
backend on port 8000.
