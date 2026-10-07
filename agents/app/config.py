"""Runtime settings for the Agent Showcase service.

The service is private (Cloud Run, invoked only by the UI server with a
service-account ID token). It holds no Apigee credentials: the caller's
identity token and persona keys arrive per request, see main.py.
"""

import os

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
  model_config = SettingsConfigDict(env_file=".env", extra="ignore")

  app_name: str = "Agent Showcase (ADK)"
  environment: str = os.getenv("ENVIRONMENT", "development")

  # Prod Apigee host. The governed agent's LLM calls go to {host}/ai/v1/auto,
  # and both agents' tool calls go to the MCP endpoints on this host.
  gateway_host: str = os.getenv(
      "GATEWAY_HOST", "https://api.example.com"
  )

  # The baseline agent calls Vertex AI directly with the service's own ADC.
  # This is the deliberate "without Apigee" arm of the comparison; see
  # .gemini/rules/adk_python_standards.md, which otherwise forbids direct calls.
  gcp_project: str = os.getenv("GCP_PROJECT", "your-gcp-project")
  vertex_location: str = os.getenv("VERTEX_LOCATION", "global")
  baseline_model: str = os.getenv("BASELINE_MODEL", "gemini-3.1-pro-preview")
  # Models the presenter may pick for the baseline agent (UI switch). All are priced in the
  # ai-model-rates KVM and reachable through llm-passthrough-v1 (any gemini* model).
  # Comma-separated (env BASELINE_MODELS); read through `baseline_model_choices`.
  baseline_models: str = "gemini-3.1-pro-preview,gemini-3-flash-preview,gemini-3.1-flash-lite"

  # Upper bound on model calls per agent run. A run that hits it ends with an
  # error event instead of looping.
  max_llm_calls: int = int(os.getenv("MAX_LLM_CALLS", "12"))

  # Per-request timeouts, seconds.
  llm_timeout_s: float = float(os.getenv("LLM_TIMEOUT_S", "90"))
  mcp_timeout_s: float = float(os.getenv("MCP_TIMEOUT_S", "30"))

  # Local preview only: base URL of a local industry-apis service (e.g.
  # http://localhost:8091). When set, industry MCP servers (/banking/mcp, ...) are called
  # there instead of through Apigee, and gateway_sim.py makes the proxy's decisions.
  # Leave unset in Cloud Run.
  industry_apis_local: str = os.getenv("INDUSTRY_APIS_LOCAL", "")

  @property
  def baseline_model_choices(self) -> tuple[str, ...]:
    return tuple(m.strip() for m in self.baseline_models.split(",") if m.strip())


settings = Settings()
