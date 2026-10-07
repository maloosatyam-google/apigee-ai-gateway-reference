"""Agent profiles for the showcase.

A profile is one agent pair: the same instruction, run twice, where the ONLY
differences are where the model calls go and which tools the key can reach.
Adding an Analyst pair later means adding one entry here.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class McpServer:
  label: str  # shown in the timeline
  path: str  # appended to settings.gateway_host
  # Set for an industry pack's MCP server (its Apigee proxy, e.g. /banking/mcp).
  industry: str = ""


@dataclass(frozen=True)
class SideSpec:
  # "apigee" -> /ai/v1/auto; "passthrough" -> /passthrough/v1 (pinned model, no governance);
  # "vertex" -> Vertex AI directly (pinned model, not recorded by Apigee).
  llm: str
  # Which forwarded key this side uses: "governed" or "baseline".
  key_role: str
  mcp_servers: tuple[McpServer, ...]
  label: str


@dataclass(frozen=True)
class AgentProfile:
  id: str
  name: str
  instruction: str
  sides: dict[str, SideSpec] = field(default_factory=dict)
  # Industry pack id when the profile follows an industry; "" for the generic demo.
  industry: str = ""


MAIN_MCP = McpServer(label="Business tools MCP", path="/mcp")
BIGQUERY_MCP = McpServer(label="BigQuery MCP", path="/bigquery/mcp")
SERVICENOW_MCP = McpServer(label="ServiceNow MCP", path="/servicenow/mcp")

# Industry packs, copied here from industries/ by `node industries/sync.js`.
INDUSTRY_DIR = Path(__file__).parent / "industries"
# Persona product each side's key holds for an industry MCP (see the pack's personas):
# governed = the Support & Sales key (ops product), baseline = the admin key (Admin product).
INDUSTRY_PERSONA_BY_KEY_ROLE = {"governed": "ops", "baseline": "admin"}


def load_industry_packs(directory: Path = INDUSTRY_DIR) -> dict[str, dict[str, Any]]:
  packs: dict[str, dict[str, Any]] = {}
  for path in sorted(directory.glob("*.json")):
    try:
      pack = json.loads(path.read_text())
    except ValueError:
      logger.exception("industry pack %s is not valid JSON", path.name)
      continue
    if pack.get("showcase", {}).get("instruction") and pack.get("basePath"):
      packs[pack["id"]] = pack
  return packs


INDUSTRY_PACKS = load_industry_packs()

# Identical for both sides, so any difference in behaviour comes from the
# gateway, not the prompt. Kept generic: no company name.
CUSTOMER_SERVICE_INSTRUCTION = """\
You are a customer service agent for an online electronics store.
Help the customer with their request using the tools available to you.

Rules:
- Look things up with tools before answering; never guess order or customer data.
- Take the fewest tool calls needed to answer well.
- If a tool returns an error, do not retry the same call. Tell the customer in
  plain words what happened and what the next step is.
- Never say an action happened unless a tool confirmed it; if a tool refused, say so plainly.
- If a refund, credit or waiver is refused because it needs approval, say plainly that it was not applied, then raise a
  ServiceNow incident with createIncident so an approver can decide it (short_description naming the customer, the record
  id and the amount; category "Approval Request"; priority "3 - Moderate"). Give the customer the incident number the tool
  returns. If you cannot create the incident, say so; never claim a request was submitted, routed or escalated unless a
  tool confirmed it.
- Answer in a short, friendly reply the customer could read directly.
"""

CUSTOMER_SERVICE = AgentProfile(
    id="customer_service",
    name="Customer Service agent",
    instruction=CUSTOMER_SERVICE_INSTRUCTION,
    sides={
        "baseline": SideSpec(
            # Through Apigee, but only the bare llm-passthrough-v1 proxy: recorded in
            # analytics and logs, with no Model Armor, cache, routing or quota.
            llm="passthrough",
            key_role="baseline",
            # Every tool the org has, uncurated (the Enterprise Tools MCP product).
            mcp_servers=(MAIN_MCP, BIGQUERY_MCP, SERVICENOW_MCP),
            label="Regular Gateway (Without AI governance)",
        ),
        "governed": SideSpec(
            llm="apigee",
            key_role="governed",
            # Same three servers as the baseline, so only the key differs: Apigee lists
            # just the 7 Customer Service tools on /mcp, only createIncident on ServiceNow
            # (for approval requests) and refuses BigQuery (401); ADK carries on without it.
            mcp_servers=(MAIN_MCP, BIGQUERY_MCP, SERVICENOW_MCP),
            label="With AI & Tools Governance",
        ),
    },
)

PROFILES: dict[str, AgentProfile] = {CUSTOMER_SERVICE.id: CUSTOMER_SERVICE}


def profile_for(profile_id: str, industry: Optional[str] = None, packs: Optional[dict[str, dict[str, Any]]] = None) -> AgentProfile:
  """The profile for a run, following the theme's industry when it has a pack.

  With a pack, both sides get the pack's instruction and its MCP server (the industry
  Apigee proxy) in place of the generic business-tools MCP. BigQuery and ServiceNow stay,
  and the key still decides what each side can use: the governed key holds only the
  industry's Support & Sales product, the baseline key the industry Admin product.
  Without a pack (or an unknown industry) the generic profile is returned unchanged.
  """
  base = PROFILES[profile_id]
  pack = (INDUSTRY_PACKS if packs is None else packs).get(industry or "")
  if not pack:
    return base
  server = McpServer(label=f"{pack['label']} tools MCP", path=pack["basePath"], industry=pack["id"])
  sides = {
      name: replace(spec, mcp_servers=tuple(server if s is MAIN_MCP else s for s in spec.mcp_servers))
      for name, spec in base.sides.items()
  }
  return replace(base, instruction=pack["showcase"]["instruction"], sides=sides, industry=pack["id"])
