/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ADMIN_USER_EMAIL?: string;
  readonly VITE_SALES_AGENT_EMAIL?: string;
  readonly VITE_LOANS_AGENT_EMAIL?: string;
  readonly VITE_SSO_USER_EMAIL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
