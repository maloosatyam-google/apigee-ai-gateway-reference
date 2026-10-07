import json

import pytest
from fastapi.testclient import TestClient

from app import main
from app.profiles import CUSTOMER_SERVICE, PROFILES

HEADERS = {
    "X-Showcase-Identity-Token": "jwt",
    "X-Showcase-User-Email": "user@example.com",
    "X-Showcase-Governed-Key": "gov",
    "X-Showcase-Baseline-Key": "base",
}


@pytest.fixture
def client():
  return TestClient(main.app)


def _events(text):
  return [json.loads(line[6:]) for line in text.splitlines() if line.startswith("data: ")]


def test_profiles_sides_differ_only_in_route_and_tools():
  base = CUSTOMER_SERVICE.sides["baseline"]
  gov = CUSTOMER_SERVICE.sides["governed"]
  assert base.llm == "passthrough" and gov.llm == "apigee"
  # Both sides connect to the same servers; the key decides what each can use.
  assert [s.path for s in gov.mcp_servers] == ["/mcp", "/bigquery/mcp", "/servicenow/mcp"]
  assert [s.path for s in base.mcp_servers] == ["/mcp", "/bigquery/mcp", "/servicenow/mcp"]
  assert set(PROFILES) == {"customer_service"}


def test_health_and_profiles(client):
  assert client.get("/health").json()["status"] == "healthy"
  body = client.get("/v1/profiles").json()
  assert body["profiles"][0]["sides"]["governed"]["label"] == "With AI & Tools Governance"


@pytest.mark.parametrize(
    "payload,headers,detail",
    [
        ({"prompt": "hi", "profile_id": "nope"}, HEADERS, "Unknown profile"),
        ({"prompt": "hi", "sides": ["other"]}, HEADERS, "at least one side"),
        ({"prompt": "hi"}, {**HEADERS, "X-Showcase-Identity-Token": ""}, "Identity-Token"),
        ({"prompt": "hi", "sides": ["governed"]}, {**HEADERS, "X-Showcase-Governed-Key": ""}, "governed side"),
    ],
)
def test_run_validation(client, payload, headers, detail):
  res = client.post("/v1/showcase/run", json=payload, headers=headers)
  assert res.status_code == 400 and detail in res.json()["detail"]


def test_empty_prompt_rejected(client):
  assert client.post("/v1/showcase/run", json={"prompt": ""}, headers=HEADERS).status_code == 422


def test_run_streams_both_sides(client, monkeypatch):
  seen = []

  async def fake_run_side(*, profile, side, prompt, creds, recorder, token_provider, run_id, use_cache=True, baseline_model=None):
    seen.append((side, creds.key_for(profile.sides[side].key_role)))
    recorder.emit("run_started", label=profile.sides[side].label)
    recorder.emit("final", text=f"{side} answer", error=None)
    recorder.emit("run_finished")

  monkeypatch.setattr(main, "run_side", fake_run_side)
  res = client.post("/v1/showcase/run", json={"prompt": "Where is ORD-1042?"}, headers=HEADERS)
  assert res.status_code == 200
  assert res.headers["content-type"].startswith("text/event-stream")
  events = _events(res.text)
  assert events[0]["type"] == "run" and events[0]["sides"] == ["baseline", "governed"]
  assert events[-1]["type"] == "done"
  finals = {e["side"]: e["text"] for e in events if e["type"] == "final"}
  assert finals == {"baseline": "baseline answer", "governed": "governed answer"}
  # Each side got its own key.
  assert sorted(seen) == [("baseline", "base"), ("governed", "gov")]


def test_run_passes_use_cache_flag(client, monkeypatch):
  seen = []

  async def fake_run_side(*, profile, side, prompt, creds, recorder, token_provider, run_id, use_cache=True, baseline_model=None):
    seen.append((side, use_cache))
    recorder.emit("run_finished")

  monkeypatch.setattr(main, "run_side", fake_run_side)
  res = client.post(
      "/v1/showcase/run", json={"prompt": "Burst", "sides": ["governed"], "use_cache": False}, headers=HEADERS,
  )
  assert res.status_code == 200
  events = _events(res.text)
  assert events[0]["use_cache"] is False
  assert seen == [("governed", False)]


def test_run_passes_baseline_model_and_rejects_unknown(client, monkeypatch):
  seen = []

  async def fake_run_side(*, profile, side, prompt, creds, recorder, token_provider, run_id, use_cache=True, baseline_model=None):
    seen.append((side, baseline_model))
    recorder.emit("run_finished")

  monkeypatch.setattr(main, "run_side", fake_run_side)
  res = client.post(
      "/v1/showcase/run", json={"prompt": "Hi", "sides": ["baseline"], "baseline_model": "gemini-3-flash-preview"}, headers=HEADERS,
  )
  assert res.status_code == 200
  assert _events(res.text)[0]["baseline_model"] == "gemini-3-flash-preview"
  assert seen == [("baseline", "gemini-3-flash-preview")]
  bad = client.post("/v1/showcase/run", json={"prompt": "Hi", "baseline_model": "gpt-4o"}, headers=HEADERS)
  assert bad.status_code == 400
