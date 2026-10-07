"""Runs one side (baseline or governed) of a showcase run with Google ADK.

Both sides use the same LlmAgent definition: same name, same instruction, same
loop, same MCP servers and the same request headers. Only the model URL
(Apigee /auto vs the llm-passthrough-v1 proxy) and the API key differ, so the
comparison isolates the gateway.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Optional

from google.adk.agents import LlmAgent
from google.adk.agents.run_config import RunConfig
from google.adk.runners import InMemoryRunner
from google.adk.tools.mcp_tool.mcp_session_manager import StreamableHTTPConnectionParams
from google.adk.tools.mcp_tool.mcp_toolset import McpToolset
from google.genai import types

from .config import settings
from .gateway_llm import GatewayLlm
from .gateway_sim import SimulatedGatewayTransport
from .mcp_transport import recording_client_factory
from .profiles import INDUSTRY_PACKS, INDUSTRY_PERSONA_BY_KEY_ROLE, AgentProfile, McpServer
from .recorder import RunRecorder

logger = logging.getLogger(__name__)

APP_NAME = "agent_showcase"
# One name for both sides: ADK puts the agent name in the system instruction,
# and the two prompts must be byte-identical.
AGENT_NAME = "customer_service_agent"


@dataclass(frozen=True)
class Credentials:
  identity_token: str
  user_email: str
  governed_key: str
  baseline_key: str

  def key_for(self, role: str) -> str:
    return self.governed_key if role == "governed" else self.baseline_key


def final_text(content: types.Content | None) -> str:
  if not content or not content.parts:
    return ""
  return "".join(p.text for p in content.parts if p.text and not p.thought)


def _is_local_industry(server: McpServer) -> bool:
  return bool(server.industry and settings.industry_apis_local and server.industry in INDUSTRY_PACKS)


def _mcp_base(server: McpServer) -> str:
  """Apigee host, or the local industry-apis for industry servers in local preview."""
  if _is_local_industry(server):
    return settings.industry_apis_local.rstrip("/")
  return settings.gateway_host.rstrip("/")


def _local_gateway(server: McpServer, key_role: str) -> Optional[Callable[[], Any]]:
  """Local preview: a transport factory that makes the industry proxy's decisions."""
  if not _is_local_industry(server):
    return None
  pack = INDUSTRY_PACKS[server.industry]
  persona = INDUSTRY_PERSONA_BY_KEY_ROLE[key_role]
  return lambda: SimulatedGatewayTransport(pack, persona)


async def run_side(
    *,
    profile: AgentProfile,
    side: str,
    prompt: str,
    creds: Credentials,
    recorder: RunRecorder,
    token_provider: Callable[[], Awaitable[str]],
    run_id: str,
    use_cache: bool = True,
    baseline_model: str | None = None,
) -> None:
  spec = profile.sides[side]
  api_key = creds.key_for(spec.key_role)
  agent_id = f"{profile.id}-{side}"
  model = baseline_model or settings.baseline_model

  recorder.emit(
      "run_started",
      label=spec.label,
      llm={
          "apigee": "Apigee AI Gateway /auto",
          "passthrough": f"Apigee pass-through ({model})",
      }.get(spec.llm, f"Vertex AI direct ({model})"),
      mcp_servers=[s.label for s in spec.mcp_servers],
      industry=profile.industry or None,
  )

  mcp_headers = {
      "x-apikey": api_key,
      "Authorization": f"Bearer {creds.identity_token}",
      "x-session-id": run_id,
      "x-agent-id": agent_id,
  }
  toolsets = [
      McpToolset(
          connection_params=StreamableHTTPConnectionParams(
              url=f"{_mcp_base(server)}{server.path}",
              headers=dict(mcp_headers),
              timeout=settings.mcp_timeout_s,
              httpx_client_factory=recording_client_factory(recorder, server.label, _local_gateway(server, spec.key_role)),
          ),
      )
      for server in spec.mcp_servers
  ]

  if spec.llm == "apigee":
    llm = GatewayLlm.for_apigee(
        recorder=recorder, api_key=api_key, identity_token=creds.identity_token,
        run_id=run_id, agent_id=agent_id, use_cache=use_cache,
    )
  elif spec.llm == "passthrough":
    llm = GatewayLlm.for_passthrough(
        recorder=recorder, api_key=api_key, identity_token=creds.identity_token,
        run_id=run_id, agent_id=agent_id, model=model, use_cache=use_cache,
    )
  else:
    llm = GatewayLlm.for_vertex(recorder=recorder, token_provider=token_provider, model=model)

  agent = LlmAgent(name=AGENT_NAME, model=llm, instruction=profile.instruction, tools=toolsets)
  runner = InMemoryRunner(agent=agent, app_name=APP_NAME)

  answer = ""
  error: str | None = None
  try:
    user_id = creds.user_email or "showcase-user"
    session = await runner.session_service.create_session(app_name=APP_NAME, user_id=user_id)
    message = types.Content(role="user", parts=[types.Part(text=prompt)])
    async for event in runner.run_async(
        user_id=user_id,
        session_id=session.id,
        new_message=message,
        run_config=RunConfig(max_llm_calls=settings.max_llm_calls),
    ):
      if event.error_code:
        error = event.error_message or event.error_code
      if event.is_final_response():
        text = final_text(event.content)
        if text:
          answer = text
  except Exception as exc:  # pylint: disable=broad-except
    logger.exception("[%s] run failed", side)
    error = f"{type(exc).__name__}: {exc}"
  finally:
    for ts in toolsets:
      try:
        await ts.close()
      except Exception:  # pylint: disable=broad-except
        logger.warning("[%s] toolset close failed", side, exc_info=True)
    try:
      await runner.close()
    except Exception:  # pylint: disable=broad-except
      pass

  recorder.emit("final", text=answer, error=error)
  recorder.emit("metrics", **recorder.metrics_payload())
  recorder.emit("run_finished")


def new_run_id() -> str:
  return f"run-{uuid.uuid4().hex[:12]}"
