import { useState, useEffect, useRef } from 'react';
import { Settings2, Compass, Palette, Sparkles } from 'lucide-react';
import { Navbar } from './components/Navbar';
import { ChatPlayground } from './components/ChatPlayground';
import { McpPlayground } from './components/McpPlayground';
import { MonetizationManager } from './components/MonetizationManager';
import { AdminAgentPanel, ASSISTANT_NAME } from './components/AdminAgentPanel';
import { AgentShowcase } from './components/AgentShowcase';
import { AnalyticsDashboard } from './components/AnalyticsDashboard';
import { ToolsAnalytics } from './components/ToolsAnalytics';
import { GatewaySettingsModal } from './components/GatewaySettingsModal';
import { ThemeStudioModal } from './components/ThemeStudioModal';
import { useCustomerTheme } from './components/CustomerThemeProvider';
import { ArchitectureBlueprintModal } from './components/ArchitectureBlueprintModal';
import { DeveloperOnboardingModal, DeveloperOnboardingResult } from './components/DeveloperOnboardingModal';
import { GuidedTour } from './components/GuidedTour';
import { TourActionId } from './services/tourSteps';
import { resetDemoData } from './services/demoData';
import { GatewaySettings, ChatMessage, GatewayTelemetry, McpTelemetry, UserPersona, AppTab, AppTheme, AVAILABLE_THEMES } from './types';
import { DEFAULT_SETTINGS, USERS, createSsoUserFromEmail } from './services/defaultSettings';
import { isSessionExpiredResponse, recoverExpiredSession, markSessionHealthy } from './services/session';
import { isAdminRole, DEFAULT_ADMIN_ROLE } from './utils/adminRoles';
import { PersonaVoiceContext, voiceForAdminRole, voiceForPersona, speakerForAdminRole, speakerForPersona } from './utils/voice';
import { APIGEE_BASE_PROD } from './config/deployment.js';

export function App() {
  // Subscribing re-renders the whole tree on a theme switch, so every tab (AI, MCP,
  // Analytics, Admin, Agent) picks up the industry wording without a remount.
  useCustomerTheme();
  const [onboardingModal, setOnboardingModal] = useState<{
    isOpen: boolean;
    email: string;
    suggestedFirstName: string;
    suggestedLastName: string;
    isEditMode?: boolean;
  } | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('settings') === 'open';
    }
    return false;
  });
  /**
   * The guided tour. `?tour=open` exists so a presenter can put the tour on a bookmark
   * or a slide link and land straight in it, the same way `?settings=open` works.
   */
  const [isTourOpen, setIsTourOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('tour') === 'open';
    }
    return false;
  });
  /** Customer theme panel (logo, colours, font, industry). `?customize=open` deep-links to it. */
  // Ask Apigee drawer (every tab except the Admin Console, which docks its own).
  const [isAssistantOpen, setIsAssistantOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('askApigee') === '1';
  });
  const [isThemeOpen, setIsThemeOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('customize') === 'open';
    }
    return false;
  });
  /** A scenario the current tour step wants run, consumed once by ChatPlayground. */
  const [tourAction, setTourAction] = useState<TourActionId | null>(null);
  // Each guided demo starts from the seed data (refunds / cases from earlier runs are undone).
  // Fire-and-forget: a failed reset must not block the tour.
  useEffect(() => {
    if (isTourOpen) resetDemoData().catch(() => undefined);
  }, [isTourOpen]);
  const [isArchitectureOpen, setIsArchitectureOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('arch') === 'open';
    }
    return false;
  });
  const [archInitialTab, setArchInitialTab] = useState<'ai-gateway' | 'mcp-gateway' | 'overview'>(() => {
    if (typeof window !== 'undefined') {
      const flow = new URLSearchParams(window.location.search).get('flow');
      if (flow === 'mcp-gateway' || flow === 'overview') return flow;
      // Legacy deep link from earlier demo builds
      if (flow === 'dual-pattern') return 'overview';
    }
    return 'overview';
  });
  const [archInitialMode, setArchInitialMode] = useState<'request-flow' | 'full-blueprint'>(() => {
    if (typeof window !== 'undefined') {
      const mode = new URLSearchParams(window.location.search).get('mode');
      if (mode === 'request-flow' || mode === 'full-blueprint') return mode;
    }
    return 'full-blueprint';
  });
  // Theme is resolved once from the URL and never changes at runtime, so it is
  // deliberately not state. `light` is the only stylesheet that exists today.
  // Customer branding (logo, colours, font, industry wording) does not use this
  // attribute: it is applied at runtime by CustomerThemeProvider through CSS
  // variables (see src/utils/customerTheme.js), on top of the light stylesheet.
  //
  // The `dark` class is never applied. Tailwind's `dark:` variants have been
  // stripped from the components; the light theme is an override layer over
  // dark-toned base classes, so toggling `dark` would not produce a dark UI.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('theme');
    const theme: AppTheme = (AVAILABLE_THEMES as readonly string[]).includes(requested ?? '')
      ? (requested as AppTheme)
      : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.classList.remove('dark');
  }, []);

  // Initialize settings with localStorage persistence and sanitization
  const [settings, setSettings] = useState<GatewaySettings>(() => {
    const base: GatewaySettings = {
      ...DEFAULT_SETTINGS,
      activeUser: 'admin',
      keyTier: 'admin',
      apiKey: USERS.admin.apiKey,
      model: 'auto',
      environment: 'prod',
      omitEmailHeader: false,
    };

    try {
      const saved = localStorage.getItem('apigee_ai_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        parsed.environment = 'prod';
        
        // On reload, respect explicit URL query parameters if present, otherwise default to Admin persona & Auto model
        const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
        const queryUser = urlParams?.get('user') as UserPersona;
        const activeUser: UserPersona = (queryUser && ['admin', 'sales_agent', 'loans_agent'].includes(queryUser))
          ? queryUser
          : 'admin';

        const userInfo = USERS[activeUser] || USERS.admin;

        // Sanitize any invalid or stale session/key from localStorage
        delete parsed.apiKey;
        if (!parsed.ssoUser?.isAuthenticated || !parsed.userEmail) {
          delete parsed.ssoUser;
          delete parsed.userEmail;
        } else if (parsed.ssoUser && parsed.userEmail) {
          // Ensure any stale single-word handle name in localStorage is refreshed
          const refreshedSso = createSsoUserFromEmail(
            parsed.userEmail,
            parsed.ssoUser.provider,
            parsed.ssoUser.idToken,
            parsed.ssoUser.name
          );
          parsed.ssoUser = refreshedSso;
        }

        // Admin persona: ?role= wins (demo links), then the saved choice, else Platform Admin.
        const queryRole = urlParams?.get('role');
        const adminRole = isAdminRole(queryRole)
          ? queryRole
          : isAdminRole(parsed.adminRole) ? parsed.adminRole : DEFAULT_ADMIN_ROLE;

        return {
          ...base,
          ...parsed,
          activeUser,
          adminRole,
          keyTier: activeUser,
          apiKey: userInfo.apiKey || base.apiKey,
          model: parsed.model || 'auto',
          environment: 'prod',
          omitEmailHeader: false,
        };
      }
    } catch (e) {
      console.error('Failed to load settings from localStorage', e);
    }
    const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const queryRole = urlParams?.get('role');
    if (isAdminRole(queryRole)) base.adminRole = queryRole;
    const queryUser = urlParams?.get('user') as UserPersona;
    if (queryUser && ['admin', 'sales_agent', 'loans_agent'].includes(queryUser)) {
      return {
        ...base,
        activeUser: queryUser,
        keyTier: queryUser,
        apiKey: USERS[queryUser]?.apiKey || base.apiKey,
      };
    }
    return base;
  });

  // Synchronize authenticated user identity & provisioned credentials from backend (/api/me)
  useEffect(() => {
    async function syncAuthenticatedUser() {
      try {
        const res = await fetch('/api/me');

        // An expired IAP session does not arrive as an error -- it arrives as a
        // 200 HTML sign-in page. Detect that explicitly and reload, otherwise
        // the app renders signed-in-looking but with no key and every call
        // fails silently.
        if (isSessionExpiredResponse(res)) {
          if (recoverExpiredSession(`GET /api/me -> ${res.status} ${res.headers.get('content-type') || 'no content-type'}`)) {
            return;
          }
          return;
        }

        markSessionHealthy();

        const data = await res.json();
        let email = (data.email || '').trim();
        const idToken = (data.token || '').trim();
        const apiKey = (data.apiKey || '').trim();
        const fullName = (data.name || '').trim();

        if (email.startsWith('accounts.google.com:')) {
          email = email.replace(/^accounts\.google\.com:/, '').trim();
        }
        if (email) {
          const provider = data.provider || (idToken ? 'Google Cloud Identity SSO (gcloud)' : 'Google Cloud Identity SSO (IAP)');
          const authUser = createSsoUserFromEmail(email, provider, idToken, fullName);

          if (data.needsOnboarding) {
            setOnboardingModal({
              isOpen: true,
              email,
              suggestedFirstName: data.suggestedFirstName || '',
              suggestedLastName: data.suggestedLastName || '',
              isEditMode: false,
            });
            setSettings((prev) => ({
              ...prev,
              userEmail: email,
              ssoUser: authUser,
              idToken: idToken || undefined,
            }));
            return;
          }

          const apiKeys = data.apiKeys || {};

          if (apiKeys.admin || apiKey) {
            USERS.admin.apiKey = apiKeys.admin || apiKey;
          }
          if (apiKeys.sales_agent) {
            USERS.sales_agent.apiKey = apiKeys.sales_agent;
          }
          if (apiKeys.loans_agent) {
            USERS.loans_agent.apiKey = apiKeys.loans_agent;
          }

          setSettings((prev) => ({
            ...prev,
            userEmail: email,
            ssoUser: authUser,
            idToken: idToken || undefined,
            // Resolve within the active persona only. Falling back to
            // apiKeys.admin here would store Engineering & IT credentials on
            // state for a non-admin persona.
            apiKey: apiKeys[prev.activeUser] || USERS[prev.activeUser]?.apiKey || '',
          }));
        }
      } catch (err) {
        // A cross-origin block on the IdP redirect also lands here.
        console.debug('No active session detected on /api/me, using runtime defaults.', err);
      }
    }

    syncAuthenticatedUser();

    // The IAP session outlives most sittings but not an overnight one. Re-check
    // whenever the tab is brought back to the foreground -- that is exactly the
    // moment a demo machine resumes from sleep with a dead cookie. Throttled so
    // ordinary tab switching does not hammer /api/me, which does provisioning
    // work server-side.
    let lastCheck = Date.now();
    const onVisible = async () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastCheck < 60_000) return;
      lastCheck = Date.now();
      try {
        const res = await fetch('/api/me');
        if (isSessionExpiredResponse(res)) {
          recoverExpiredSession('tab refocus');
        } else {
          markSessionHealthy();
        }
      } catch {
        recoverExpiredSession('tab refocus (network/CORS block)');
      }
    };

    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // Save settings changes to localStorage (excluding temporary simulation flags and dynamic API keys)
  useEffect(() => {
    try {
      const toSave = { ...settings, environment: 'prod', omitEmailHeader: false };
      delete (toSave as any).apiKey;
      localStorage.setItem('apigee_ai_settings', JSON.stringify(toSave));
    } catch (e) {
      console.error('Failed to save settings to localStorage', e);
    }
  }, [settings]);

  // Ensure persistent state never holds omitEmailHeader as true
  useEffect(() => {
    if (settings.omitEmailHeader) {
      setSettings((prev) => ({ ...prev, omitEmailHeader: false }));
    }
  }, [settings.omitEmailHeader]);

  const [activeTab, setActiveTab] = useState<AppTab>(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search).get('tab') as AppTab;
      if (p && ['ai-gateway', 'mcp-gateway', 'monetization', 'kvm-pricing', 'analytics', 'agent-showcase'].includes(p)) {
        return p;
      }
    }
    return 'ai-gateway';
  });
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('sample') === 'true') {
      return [
        {
          id: 'sample-user-1',
          sender: 'user',
          text: 'What does the acronym API stand for?',
          timestamp: '21:50',
        },
        {
          id: 'sample-agent-1',
          sender: 'agent',
          text: 'API stands for Application Programming Interface — a defined contract that lets one piece of software request services or data from another.',
          timestamp: '21:50',
          targetUrl: `${APIGEE_BASE_PROD}/ai/v1/auto`,
          telemetry: {
            status: 200,
            statusText: 'OK',
            // A real cache hit: the lookup keys on the prompt alone and the router
            // is skipped, so the gateway attributes no model, no category and no
            // cost. Measured on prod rev 44: 873 ms median, n=6.
            latencyMs: 873,
            endpointUrl: `${APIGEE_BASE_PROD}/ai/v1/auto`,
            environment: 'prod',
            costUsd: '0.000000',
            promptTokens: 9,
            candidatesTokens: 28,
            totalTokens: 37,
            autoRouted: false,
            cacheStatus: 'HIT',
            guardrailStatus: 'PASSED',
            headersSent: {},
            headersReceived: {
              'x-gateway-cache-status': 'HIT',
              'x-gateway-prepaid-balance': '109.988770',
              'x-gateway-balance-remaining': '109.988770',
            },
            rawRequest: {},
            rawResponse: { candidates: [{ content: { parts: [{ text: '1. Centralized Governance...' }] } }] },
          },
        },
      ];
    }
    return [];
  });

  const [activeTelemetry, setActiveTelemetry] = useState<GatewayTelemetry | null>((): GatewayTelemetry | null => {
    const sampleParam = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('sample') : null;
    if (sampleParam === 'armor') {
      return {
        status: 400,
        statusText: 'Bad Request',
        latencyMs: 92,
        endpointUrl: `${APIGEE_BASE_PROD}/ai/v1/auto`,
        environment: 'prod',
        model: 'auto',
        provider: 'Google',
        costTier: 'low',
        costUsd: '0.000000',
        promptTokens: 0,
        candidatesTokens: 0,
        totalTokens: 0,
        autoRouted: false,
        intent: 'Blocked at Perimeter',
        cacheStatus: 'DISABLED',
        guardrailStatus: 'BLOCKED',
        guardrailMessage: 'Prompt Sanitization Violation (SUP-UserPrompt): Destructive system command & prompt injection attempt blocked at perimeter.',
        headersSent: {},
        headersReceived: {},
        rawRequest: {},
        rawResponse: { error: { code: 400, message: 'Blocked by Model Armor' } },
      };
    }
    if (sampleParam === 'true') {
      return {
        status: 200,
        statusText: 'OK',
        // See the sample chat message above: a genuine cache hit carries no model,
        // no category, no cost tier and no auto-routing claim, because the router
        // is skipped and the cache keys on the prompt alone.
        latencyMs: 873,
        endpointUrl: `${APIGEE_BASE_PROD}/ai/v1/auto`,
        environment: 'prod',
        costUsd: '0.000000',
        promptTokens: 9,
        candidatesTokens: 28,
        totalTokens: 37,
        autoRouted: false,
        cacheStatus: 'HIT',
        guardrailStatus: 'PASSED',
        headersSent: {},
        headersReceived: {
          'x-gateway-cache-status': 'HIT',
          'x-gateway-prepaid-balance': '109.988770',
          'x-gateway-balance-remaining': '109.988770',
        },
        rawRequest: {},
        rawResponse: { candidates: [{ content: { parts: [{ text: '1. Centralized Governance...' }] } }] },
      };
    }
    return null;
  });
  const [activeMcpTelemetry, setActiveMcpTelemetry] = useState<McpTelemetry | null>(null);

  // Analytics Dashboard Controls State (hoisted to Navbar)
  const [analyticsViewMode, setAnalyticsViewMode] = useState<'admin' | 'user'>(() => {
    if (typeof window !== 'undefined') {
      const v = new URLSearchParams(window.location.search).get('view');
      if (v === 'admin' || v === 'user') return v;
    }
    return 'user';
  });
  const [analyticsTimeRange, setAnalyticsTimeRange] = useState<'24h' | '7d' | '30d'>('24h');
  const [analyticsEnv, setAnalyticsEnv] = useState<'prod' | 'dev'>('prod');
  const [analyticsSection, setAnalyticsSection] = useState<'ai' | 'tools'>('ai');
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsUserFilter, setAnalyticsUserFilter] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const u = new URLSearchParams(window.location.search).get('userFilter');
      if (u) return u;
    }
    return 'all';
  });
  const [analyticsUserList, setAnalyticsUserList] = useState<{ email: string; name?: string }[]>([]);
  const analyticsRefreshRef = useRef<() => void>(() => {});

  const handleResetChat = () => {
    setMessages([]);
    setActiveTelemetry(null);
    setActiveTab('ai-gateway');
    setSettings((prev) => ({
      ...prev,
      activeUser: 'admin',
      keyTier: 'admin',
      apiKey: USERS.admin.apiKey || prev.apiKey,
      model: 'auto',
      omitEmailHeader: false,
    }));
  };

  // Monetization tab is strictly accessible only in Admin view
  useEffect(() => {
    // The persona (top-right picker) is who the demo acts as, not who is signed
    // in, so it does not gate the Admin Console. Analytics has its own view mode.
    const isAdmin = activeTab === 'analytics' ? analyticsViewMode === 'admin' : true;
    if (!isAdmin && (activeTab === 'monetization' || activeTab === 'kvm-pricing' || activeTab === 'rate-cards')) {
      setActiveTab('ai-gateway');
    }
  }, [activeTab, analyticsViewMode, settings.activeUser]);

  // Persona voice (utils/voice.ts): the UI speaks the acting persona's language.
  const adminRole = settings.adminRole || 'platform';
  const adminVoice = voiceForAdminRole(adminRole);
  const personaVoice = voiceForPersona(settings.activeUser);
  const onAdminSideTab =
    activeTab === 'monetization' || activeTab === 'kvm-pricing' || activeTab === 'rate-cards' || activeTab === 'analytics';
  const voiceState = {
    adminRole,
    persona: settings.activeUser,
    adminVoice,
    personaVoice,
    activeVoice: onAdminSideTab ? adminVoice : personaVoice,
    adminSpeaker: speakerForAdminRole(adminRole),
    personaSpeaker: speakerForPersona(settings.activeUser),
    activeSpeaker: onAdminSideTab ? speakerForAdminRole(adminRole) : speakerForPersona(settings.activeUser),
  };

  const onConsoleTab = activeTab === 'monetization' || activeTab === 'kvm-pricing' || activeTab === 'rate-cards';
  // Analytics in Admin view gets the admin assistant (fleet-wide answers); everywhere
  // else is the user view, where the server pins every answer to the caller.
  const assistantScope: 'admin' | 'user' =
    activeTab === 'analytics' && analyticsViewMode === 'admin' ? 'admin' : 'user';
  const assistantVisible = isAssistantOpen && !onConsoleTab;

  useEffect(() => {
    if (!assistantVisible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsAssistantOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [assistantVisible]);

  return (
    <PersonaVoiceContext.Provider value={voiceState}>
    <div className="h-screen bg-slate-950 flex flex-col text-slate-100 font-sans selection:bg-blue-600 selection:text-white overflow-hidden">
      {/* Sleek Top Navbar */}
      <Navbar
        settings={settings}
        setSettings={setSettings}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenArchitecture={() => {
          setArchInitialTab('overview');
          setArchInitialMode('full-blueprint');
          setIsArchitectureOpen(true);
        }}
        onResetChat={handleResetChat}
        onEditProfileName={(email, currentFullName) => {
          const parts = (currentFullName || '').split(/\s+/).filter(Boolean);
          const firstName = parts[0] || '';
          const lastName = parts.slice(1).join(' ');
          setOnboardingModal({
            isOpen: true,
            email,
            suggestedFirstName: firstName,
            suggestedLastName: lastName,
            isEditMode: true,
          });
        }}
        analyticsControls={{
          viewMode: analyticsViewMode,
          setViewMode: (mode) => {
            setAnalyticsViewMode(mode);
            if (mode === 'user') {
              setAnalyticsUserFilter('all');
            }
          },
          timeRange: analyticsTimeRange,
          setTimeRange: setAnalyticsTimeRange,
          env: analyticsEnv,
          setEnv: setAnalyticsEnv,
          loading: analyticsLoading,
          onRefresh: () => {
            if (analyticsRefreshRef.current) {
              analyticsRefreshRef.current();
            }
          },
          userFilter: analyticsUserFilter,
          setUserFilter: setAnalyticsUserFilter,
          userList: analyticsUserList,
        }}
      />

      {/* Main Dual-Pane Studio Body */}
      {/*
        The page and the Ask Apigee drawer share one row, like the Admin Console and its
        docked panel: opening the drawer narrows the page instead of covering it.
      */}
      <main className="flex-1 overflow-hidden flex min-h-0">
        <div className="flex-1 min-w-0 h-full relative">
        {activeTab === 'ai-gateway' ? (
          <ChatPlayground
            settings={settings}
            setSettings={setSettings}
            messages={messages}
            setMessages={setMessages}
            activeTelemetry={activeTelemetry}
            setActiveTelemetry={setActiveTelemetry}
            onResetChat={handleResetChat}
            tourAction={tourAction}
            onTourActionHandled={() => setTourAction(null)}
            onOpenRequestFlow={(telemetry) => {
              setActiveTelemetry(telemetry);
              setArchInitialTab('ai-gateway');
              setArchInitialMode('request-flow');
              setIsArchitectureOpen(true);
            }}
          />
        ) : activeTab === 'mcp-gateway' ? (
          <McpPlayground
            settings={settings}
            onTelemetryChange={setActiveMcpTelemetry}
            onOpenRequestFlow={(telemetry) => {
              setActiveMcpTelemetry(telemetry);
              setArchInitialTab('mcp-gateway');
              setArchInitialMode('request-flow');
              setIsArchitectureOpen(true);
            }}
          />
        ) : activeTab === 'agent-showcase' ? (
          <AgentShowcase />
        ) : activeTab === 'monetization' || activeTab === 'kvm-pricing' || activeTab === 'rate-cards' ? (
          /*
            The Admin Console and its agent share the row. MonetizationManager owns its
            own `h-full ... overflow-y-auto` scroller, so it goes in a `min-w-0` flex child
            rather than being given a width - otherwise its wide tables would push the
            dock off-screen instead of scrolling.
          */
          <div className="h-full flex min-h-0">
            <div className="flex-1 min-w-0 h-full">
              <MonetizationManager
                currentEnv="prod"
                settings={settings}
                adminRole={settings.adminRole || 'platform'}
                onAdminRoleChange={(adminRole) => setSettings((prev) => ({ ...prev, adminRole }))}
                onInspectArchitecture={(flow) => {
                  setArchInitialTab(flow);
                  setArchInitialMode('full-blueprint');
                  setIsArchitectureOpen(true);
                }}
              />
            </div>
            <AdminAgentPanel adminRole={settings.adminRole || 'platform'} />
          </div>
        ) : (
          <div className="h-full flex flex-col bg-slate-50">
            {/* Analytics sections: model (AI Gateway) traffic vs. tool (MCP) traffic */}
            <div className="shrink-0 px-4 sm:px-6 pt-4">
              <div className="max-w-7xl mx-auto flex items-center gap-1 p-1 rounded-xl bg-white border border-slate-200 w-fit shadow-xs">
                {([
                  { id: 'ai', label: 'AI Gateway' },
                  { id: 'tools', label: 'Tools Gateway' },
                ] as const).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setAnalyticsSection(t.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                      analyticsSection === t.id
                        ? t.id === 'ai' ? 'bg-purple-600 text-white shadow-xs' : 'bg-cyan-600 text-white shadow-xs'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 min-h-0">
              {analyticsSection === 'ai' ? (
                <AnalyticsDashboard
                  settings={settings}
                  viewMode={analyticsViewMode}
                  timeRange={analyticsTimeRange}
                  env={analyticsEnv}
                  setLoading={setAnalyticsLoading}
                  registerRefresh={(fn) => {
                    analyticsRefreshRef.current = fn;
                  }}
                  userFilter={analyticsUserFilter}
                  onUserFilterChange={setAnalyticsUserFilter}
                  onUserListChange={setAnalyticsUserList}
                />
              ) : (
                <ToolsAnalytics
                  env={analyticsEnv}
                  timeRange={analyticsTimeRange}
                  viewMode={analyticsViewMode}
                  currentUserEmail={settings.ssoUser?.email || settings.userEmail || ''}
                  setLoading={setAnalyticsLoading}
                  registerRefresh={(fn) => {
                    analyticsRefreshRef.current = fn;
                  }}
                  userFilter={analyticsUserFilter}
                  onUserFilterChange={setAnalyticsUserFilter}
                />
              )}
            </div>
          </div>
        )}
        </div>

        {assistantVisible && (
          <div
            data-assistant-drawer
            data-assistant-scope={assistantScope}
            className="h-full shrink-0 flex"
          >
            <AdminAgentPanel
              key={assistantScope}
              scope={assistantScope}
              adminRole={settings.adminRole || 'platform'}
              onClose={() => setIsAssistantOpen(false)}
            />
          </div>
        )}
      </main>

      {/* Floating Bottom-Right Corner Control: Guided Tour + Gateway Settings */}
      <div className="fixed bottom-3 right-4 z-40 flex items-center gap-1.5 bg-white/95 backdrop-blur-md p-1.5 rounded-xl border border-slate-200 shadow-xl">
        {/*
          Labelled, not icon-only, unlike its neighbour. Whoever needs this button has
          never seen the app before, so a bare compass glyph would be a riddle - and the
          settings cog next to it is only decipherable because everyone already knows it.
        */}
        {!onConsoleTab && (
          <button
            type="button"
            data-tour-id="ask-apigee-launcher"
            onClick={() => setIsAssistantOpen((open) => !open)}
            aria-pressed={isAssistantOpen}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition cursor-pointer shadow-xs text-xs font-semibold ${
              isAssistantOpen
                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                : 'bg-blue-600 hover:bg-blue-500 text-white'
            }`}
            title={
              assistantScope === 'admin'
                ? `${ASSISTANT_NAME}: ask about fleet-wide usage, spend and failures`
                : `${ASSISTANT_NAME}: ask about your own usage, costs and failed calls`
            }
          >
            <Sparkles className="w-4 h-4" />
            <span>{isAssistantOpen ? 'Hide Ask Apigee' : 'Ask Apigee'}</span>
          </button>
        )}
        <button
          type="button"
          data-tour-id="guide-me"
          onClick={() => setIsTourOpen(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition cursor-pointer shadow-xs text-xs font-semibold"
          title="Take a guided walkthrough of the demo"
        >
          <Compass className="w-4 h-4" />
          <span>Guide me</span>
        </button>
        <button
          type="button"
          data-tour-id="customer-theme"
          onClick={() => setIsThemeOpen(true)}
          className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200/80 text-slate-600 hover:text-blue-600 transition cursor-pointer shadow-xs"
          title="Customer theme: logo, colours, font and industry"
          aria-label="Customer theme"
        >
          <Palette className="w-4 h-4" />
        </button>
        <button
          type="button"
          data-tour-id="gateway-settings"
          onClick={() => setIsSettingsOpen(true)}
          className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200/80 text-slate-600 hover:text-blue-600 transition cursor-pointer shadow-xs"
          title="Gateway Configuration Settings"
        >
          <Settings2 className="w-4 h-4" />
        </button>
      </div>

      {/* Interactive Guided Demo */}
      <GuidedTour
        open={isTourOpen}
        onClose={() => setIsTourOpen(false)}
        isAdmin
        onRequestTab={setActiveTab}
        onRunAction={setTourAction}
      />

      {/* Gateway Configuration Drawer / Modal */}
      <GatewaySettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSave={(newSettings) => setSettings(newSettings)}
      />

      {/* Customer theme panel */}
      <ThemeStudioModal isOpen={isThemeOpen} onClose={() => setIsThemeOpen(false)} />

      {/* Interactive Architecture Blueprint Modal */}
      <ArchitectureBlueprintModal
        isOpen={isArchitectureOpen}
        onClose={() => setIsArchitectureOpen(false)}
        initialTab={archInitialTab}
        initialMode={archInitialMode}
        aiTelemetry={activeTelemetry}
        mcpTelemetry={activeMcpTelemetry}
      />

      {/* First-Time Developer Onboarding / Name Validation Modal */}
      {onboardingModal && (
        <DeveloperOnboardingModal
          isOpen={onboardingModal.isOpen}
          email={onboardingModal.email}
          suggestedFirstName={onboardingModal.suggestedFirstName}
          suggestedLastName={onboardingModal.suggestedLastName}
          isEditMode={onboardingModal.isEditMode}
          onCancel={() => setOnboardingModal(null)}
          onComplete={(result: DeveloperOnboardingResult) => {
            const apiKeys = result.apiKeys || {};
            if (apiKeys.admin || result.apiKey) {
              USERS.admin.apiKey = apiKeys.admin || result.apiKey;
            }
            if (apiKeys.sales_agent) {
              USERS.sales_agent.apiKey = apiKeys.sales_agent;
            }
            if (apiKeys.loans_agent) {
              USERS.loans_agent.apiKey = apiKeys.loans_agent;
            }
            const updatedSso = createSsoUserFromEmail(
              result.email,
              settings.ssoUser?.provider || 'Google Cloud Identity SSO (IAP)',
              settings.idToken,
              result.name
            );
            setSettings((prev) => ({
              ...prev,
              userEmail: result.email,
              ssoUser: updatedSso,
              apiKey: apiKeys[prev.activeUser] || USERS[prev.activeUser]?.apiKey || prev.apiKey,
            }));
            setOnboardingModal(null);
            if (analyticsRefreshRef.current) {
              analyticsRefreshRef.current();
            }
          }}
        />
      )}
    </div>
    </PersonaVoiceContext.Provider>
  );
}

export default App;
