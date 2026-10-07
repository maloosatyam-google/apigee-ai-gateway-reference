"""Per-run event recorder.

Every observable step of an agent run (model call, MCP hop, tool call, final
answer) becomes one event pushed onto an asyncio queue. main.py drains the
queues of both agents into a single SSE stream, so the UI fills the two columns
live.

Event shape (JSON): {"side", "type", "seq", "t_ms", ...type-specific fields}.
Types: run_started, tools_offered, llm_step, gateway_hop, tool_call,
tool_result, governance_event, final, metrics, run_finished.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any


@dataclass
class RunTotals:
  llm_steps: int = 0
  tool_calls: int = 0
  prompt_tokens: int = 0
  output_tokens: int = 0
  thought_tokens: int = 0
  cache_hits: int = 0
  governance_events: int = 0
  gateway_cost_usd: float = 0.0
  # model -> {"prompt": int, "output": int, "steps": int}
  by_model: dict[str, dict[str, int]] = field(default_factory=dict)
  tools_called: list[str] = field(default_factory=list)
  tools_offered: list[str] = field(default_factory=list)


class RunRecorder:
  """Collects events and running totals for one agent (one side) of a run."""

  def __init__(self, side: str, queue: asyncio.Queue | None = None):
    self.side = side
    self.queue: asyncio.Queue = queue if queue is not None else asyncio.Queue()
    self.started = time.monotonic()
    self.totals = RunTotals()
    self._seq = 0
    self._llm_step = 0

  def elapsed_ms(self) -> int:
    return int((time.monotonic() - self.started) * 1000)

  def emit(self, type_: str, **fields: Any) -> dict[str, Any]:
    self._seq += 1
    event = {
        "side": self.side,
        "type": type_,
        "seq": self._seq,
        "t_ms": self.elapsed_ms(),
        **fields,
    }
    self.queue.put_nowait(event)
    return event

  # -- typed helpers -------------------------------------------------------

  def next_llm_step(self) -> int:
    self._llm_step += 1
    return self._llm_step

  @property
  def llm_step_count(self) -> int:
    return self._llm_step

  def tools_offered(self, names: list[str]) -> None:
    if self.totals.tools_offered:
      return  # announced once per run: the list does not change mid-run
    self.totals.tools_offered = list(names)
    self.emit("tools_offered", tools=list(names), count=len(names))

  def llm_step(self, **fields: Any) -> None:
    t = self.totals
    t.llm_steps += 1
    tokens = fields.get("tokens") or {}
    prompt = int(tokens.get("prompt") or 0)
    output = int(tokens.get("output") or 0)
    t.prompt_tokens += prompt
    t.output_tokens += output
    t.thought_tokens += int(tokens.get("thoughts") or 0)
    if fields.get("cache") == "HIT":
      t.cache_hits += 1
    cost = fields.get("gateway_cost_usd")
    if isinstance(cost, (int, float)):
      t.gateway_cost_usd += float(cost)
    model = fields.get("model")
    if model:
      m = t.by_model.setdefault(model, {"prompt": 0, "output": 0, "steps": 0})
      m["prompt"] += prompt
      m["output"] += output
      m["steps"] += 1
    self.emit("llm_step", **fields)

  def tool_call(self, **fields: Any) -> None:
    self.totals.tool_calls += 1
    name = fields.get("name")
    if name:
      self.totals.tools_called.append(name)
    self.emit("tool_call", **fields)

  def governance(self, kind: str, detail: str, **fields: Any) -> None:
    self.totals.governance_events += 1
    self.emit("governance_event", kind=kind, detail=detail, **fields)

  def metrics_payload(self) -> dict[str, Any]:
    t = self.totals
    return {
        "e2e_ms": self.elapsed_ms(),
        "llm_steps": t.llm_steps,
        "tool_calls": t.tool_calls,
        "tokens": {
            "prompt": t.prompt_tokens,
            "output": t.output_tokens,
            "thoughts": t.thought_tokens,
            "total": t.prompt_tokens + t.output_tokens,
        },
        "by_model": t.by_model,
        "tools_offered": t.tools_offered,
        "tools_offered_count": len(t.tools_offered),
        "tools_called": t.tools_called,
        "cache_hits": t.cache_hits,
        "governance_events": t.governance_events,
        # Only the governed side reports this (x-gateway-cost-usd). The UI prices
        # BOTH sides from the ai-model-rates KVM instead, so this is reference only.
        "gateway_cost_usd": round(t.gateway_cost_usd, 6),
    }
