"""Agent Showcase service: two ADK agents, one prompt, streamed side by side.

Private Cloud Run service. The only caller is the UI server, which
authenticates to Cloud Run with a service-account ID token and forwards, per
request, the signed-in user's identity token and the persona keys:

  X-Showcase-Identity-Token  user JWT (email claim) for both gateways
  X-Showcase-User-Email      for session/user attribution
  X-Showcase-Governed-Key    Support & Sales key (governed side)
  X-Showcase-Baseline-Key    Engineering & IT key (baseline side's MCP calls)

POST /v1/showcase/run streams Server-Sent Events; see recorder.py for events.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Optional

import google.auth
import google.auth.transport.requests
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .agent import Credentials, new_run_id, run_side
from .config import settings
from .profiles import INDUSTRY_PACKS, PROFILES, profile_for
from .recorder import RunRecorder

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title=settings.app_name, version="2.0.0")

HEARTBEAT_S = 10.0
SIDES = ("baseline", "governed")


# -- Vertex token for the baseline (service ADC) -----------------------------

_adc = None
_adc_lock = asyncio.Lock()


async def vertex_token() -> str:
  global _adc
  async with _adc_lock:
    if _adc is None:
      _adc, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    if not _adc.valid:
      await asyncio.to_thread(_adc.refresh, google.auth.transport.requests.Request())
    return _adc.token


# -- API ---------------------------------------------------------------------


class RunRequest(BaseModel):
  profile_id: str = "customer_service"
  prompt: str = Field(min_length=1, max_length=4000)
  sides: list[str] = Field(default_factory=lambda: list(SIDES))
  # False for the quota burst: the governed agent skips the semantic cache.
  use_cache: bool = True
  # Baseline agent's model (UI switch); must be one of settings.baseline_model_choices.
  baseline_model: Optional[str] = None
  # Theme industry (e.g. "banking"). With a pack, both agents use the industry's
  # instruction and MCP server; unknown or empty -> the generic profile.
  industry: Optional[str] = Field(default=None, max_length=40, pattern=r"^[a-z][a-z0-9-]*$")


def validate_run(req: RunRequest, creds: Credentials) -> list[str]:
  if req.profile_id not in PROFILES:
    raise HTTPException(400, f"Unknown profile '{req.profile_id}'.")
  sides = [s for s in req.sides if s in SIDES]
  if not sides:
    raise HTTPException(400, "Choose at least one side: baseline, governed.")
  if not creds.identity_token:
    raise HTTPException(400, "Missing X-Showcase-Identity-Token.")
  if req.baseline_model and req.baseline_model not in settings.baseline_model_choices:
    raise HTTPException(400, f"Baseline model must be one of: {', '.join(settings.baseline_model_choices)}.")
  profile = PROFILES[req.profile_id]
  for side in sides:
    if not creds.key_for(profile.sides[side].key_role):
      raise HTTPException(400, f"Missing API key for the {side} side.")
  return sides


def sse(event: dict[str, Any]) -> bytes:
  return f"data: {json.dumps(event, default=str)}\n\n".encode()


@app.get("/health")
def health() -> dict[str, Any]:
  return {
      "status": "healthy", "service": settings.app_name,
      "baseline_model": settings.baseline_model, "baseline_models": list(settings.baseline_model_choices),
  }


@app.get("/v1/profiles")
def profiles() -> dict[str, Any]:
  return {
      "profiles": [
          {
              "id": p.id,
              "name": p.name,
              "sides": {
                  name: {"label": s.label, "llm": s.llm, "mcp_servers": [m.label for m in s.mcp_servers]}
                  for name, s in p.sides.items()
              },
          }
          for p in PROFILES.values()
      ],
      # Industries with a pack: the showcase follows these when the theme picks them.
      "industries": sorted(INDUSTRY_PACKS),
  }


@app.post("/v1/showcase/run")
async def run(
    req: RunRequest,
    request: Request,
    x_showcase_identity_token: Optional[str] = Header(None),
    x_showcase_user_email: Optional[str] = Header(None),
    x_showcase_governed_key: Optional[str] = Header(None),
    x_showcase_baseline_key: Optional[str] = Header(None),
):
  creds = Credentials(
      identity_token=x_showcase_identity_token or "",
      user_email=x_showcase_user_email or "",
      governed_key=x_showcase_governed_key or "",
      baseline_key=x_showcase_baseline_key or "",
  )
  sides = validate_run(req, creds)
  profile = profile_for(req.profile_id, req.industry)
  run_id = new_run_id()
  queue: asyncio.Queue = asyncio.Queue()

  async def stream():
    yield sse({"type": "run", "run_id": run_id, "profile": profile.id, "sides": sides, "prompt": req.prompt, "use_cache": req.use_cache,
               "industry": profile.industry or None,
               "baseline_model": req.baseline_model or settings.baseline_model})
    tasks = [
        asyncio.create_task(
            run_side(
                profile=profile, side=side, prompt=req.prompt, creds=creds,
                recorder=RunRecorder(side, queue), token_provider=vertex_token, run_id=run_id,
                use_cache=req.use_cache, baseline_model=req.baseline_model,
            ),
            name=f"{run_id}-{side}",
        )
        for side in sides
    ]
    try:
      while True:
        if all(t.done() for t in tasks) and queue.empty():
          break
        try:
          event = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_S)
          yield sse(event)
        except asyncio.TimeoutError:
          if await request.is_disconnected():
            break
          yield b": keep-alive\n\n"
      yield sse({"type": "done", "run_id": run_id})
    finally:
      for t in tasks:
        if not t.done():
          t.cancel()

  return StreamingResponse(
      stream(),
      media_type="text/event-stream",
      headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
  )
