import React, { useState, useRef, useEffect } from 'react';
import { PersonaSelect, AdminRoleSelect } from './PersonaSelect';
import { PERSONAS } from '../utils/personas';
import { ADMIN_ROLES } from '../utils/adminRoles';
import {
  Sparkles,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  Check,
  Building2,
  Mail,
  Shield,
  ShieldCheck,
  X,
  Terminal,
  BarChart3,
  Users,
  User,
  RotateCcw,
  Loader2,
  Layers,
  Pencil,
  Bot,
} from 'lucide-react';
import { GatewaySettings, UserPersona, AppTab, AdminRole } from '../types';
import { USERS, AVAILABLE_MODELS, DEFAULT_SSO_USER } from '../services/defaultSettings';
import { BrandLogo } from './BrandLogo';
import { useCustomerTheme } from './CustomerThemeProvider';
import { brandHeader, personaDisplay } from '../utils/customerTheme';
import { usePersonaVoice } from '../utils/voice';

export interface AnalyticsNavControls {
  viewMode: 'admin' | 'user';
  setViewMode: (mode: 'admin' | 'user') => void;
  timeRange: '24h' | '7d' | '30d';
  setTimeRange: (range: '24h' | '7d' | '30d') => void;
  env: 'prod' | 'dev';
  setEnv: (env: 'prod' | 'dev') => void;
  loading: boolean;
  onRefresh: () => void;
  userFilter?: string;
  setUserFilter?: (user: string) => void;
  userList?: { email: string; name?: string }[];
}

interface NavbarProps {
  settings: GatewaySettings;
  setSettings: React.Dispatch<React.SetStateAction<GatewaySettings>>;
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  onOpenSettings?: () => void;
  onOpenArchitecture?: () => void;
  onResetChat?: () => void;
  onEditProfileName?: (email: string, currentName: string) => void;
  analyticsControls?: AnalyticsNavControls;
}

export const Navbar: React.FC<NavbarProps> = ({
  settings,
  setSettings,
  activeTab,
  onTabChange,
  onOpenArchitecture,
  onEditProfileName,
  analyticsControls,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [ssoPopoverOpen, setSsoPopoverOpen] = useState(false);
  const { sp } = usePersonaVoice('active');
  const { theme: customerTheme, isDefault: isDefaultTheme } = useCustomerTheme();
  // Admin (amber) and Agent (emerald) pills use status-colour families, which
  // never follow the brand; under a customer theme they switch to brand-following
  // families so every tab feels branded. The default theme is unchanged.
  const adminTabActive = isDefaultTheme ? 'bg-amber-600' : 'bg-purple-600';
  const agentTabActive = isDefaultTheme ? 'bg-emerald-600' : 'bg-teal-600';
  const ssoPopoverRef = useRef<HTMLDivElement>(null);

  const ssoUser = settings.ssoUser || DEFAULT_SSO_USER;
  const activeUser = USERS[settings.activeUser] || USERS.admin;
  const effectiveEmail = ssoUser.email || settings.userEmail || DEFAULT_SSO_USER.email;

  // Close SSO popover on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ssoPopoverRef.current && !ssoPopoverRef.current.contains(e.target as Node)) {
        setSsoPopoverOpen(false);
      }
    };
    if (ssoPopoverOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [ssoPopoverOpen]);

  const handleUserChange = (userPersona: UserPersona) => {
    const user = USERS[userPersona];
    setSettings((prev) => ({
      ...prev,
      activeUser: userPersona,
      apiKey: user.apiKey,
    }));
  };

  const handleModelChange = (modelId: string) => {
    setSettings((prev) => ({ ...prev, model: modelId }));
  };

  const handleAdminRoleChange = (adminRole: AdminRole) => {
    setSettings((prev) => ({ ...prev, adminRole }));
  };

  // Top-right picker: consumer persona on the gateway tabs, admin persona in the Admin Console.
  const isGatewayTab = activeTab === 'ai-gateway' || activeTab === 'mcp-gateway';
  // Analytics speaks in the admin persona's voice too, so it gets the same picker.
  const isAdminConsoleTab = activeTab === 'monetization' || activeTab === 'kvm-pricing' || activeTab === 'rate-cards' || activeTab === 'analytics';
  const showTopRightPicker = isGatewayTab || isAdminConsoleTab;

  // The persona picked top-right signs both AI Gateway and MCP Gateway calls,
  // so the same prompt can be shown behaving differently per persona. It is no
  // longer pinned back to Engineering & IT when leaving the MCP tab.

  // Identity is fixed for the session: it comes from the SSO login and is
  // resolved once by App.tsx via /api/me (which also drives first-time
  // developer onboarding). There is deliberately no in-app way to change it.

  // Monetization tab is strictly visible only in Admin view
  // Persona is who the demo *acts as*, not who is signed in, so it no longer
  // hides the Admin Console. Analytics keeps its own Admin/User view switch.
  const isAdminView = activeTab === 'analytics'
    ? analyticsControls?.viewMode === 'admin'
    : true;

  // Clicking the brand mark returns to the default view, as on most sites.
  // The `?tab=` param is also cleared so a subsequent reload stays on home
  // rather than restoring the tab the user just navigated away from.
  const handleLogoHome = () => {
    onTabChange('ai-gateway');
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (url.searchParams.has('tab')) {
        url.searchParams.delete('tab');
        window.history.replaceState({}, '', url.toString());
      }
    }
  };

  // Customer themes can colour the top row like the customer's own site
  // (e.g. ICICI orange) and add a brand stripe under it (e.g. HPCL blue).
  // The tab, persona and SSO chips keep their light fill, so they stay readable on any colour.
  const header = brandHeader(customerTheme);

  return (
    <header
      data-brand-header={header.bg ? 'colored' : header.stripe ? 'striped' : undefined}
      className={`${header.bg ? '' : 'bg-white/95 backdrop-blur'} ${header.stripe ? 'border-b-0' : `border-b ${header.dark ? 'border-black/10' : 'border-slate-200'}`} sticky top-0 z-40 w-full`}
      style={header.bg ? { backgroundColor: header.bg } : undefined}
    >
      {header.stripe && <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px] pointer-events-none" style={{ background: header.stripe }} />}
      {/* Primary Bar - Full viewport width */}
      <div className="w-full px-3 sm:px-6 py-2 flex items-center justify-between gap-2 sm:gap-3">
        {/* Left: Official Apigee Brand & Gateway Tabs */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <button
            type="button"
            onClick={handleLogoHome}
            data-tour-id="brand-logo"
            className="flex items-center rounded-lg cursor-pointer transition hover:opacity-75 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
            aria-label="Go to home"
            title={sp({
              technical: 'Go to home (AI Gateway)',
              platform: 'Go to home (AI Gateway)',
              finance: 'Go to home',
              ai_coe: 'Go to home',
              eng: 'Go to home (AI Gateway)',
              analysts: 'Go to home',
              support: 'Go to home',
            })}
          >
            <BrandLogo />
          </button>

          {/* Primary Gateway Tabs Switcher - Analytics is 3rd Tab */}
          <div className="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200 text-xs">
            <button
              type="button"
              onClick={() => onTabChange('ai-gateway')}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-lg font-semibold transition cursor-pointer text-xs ${
                activeTab === 'ai-gateway'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
              title={sp({
                technical: 'AI Gateway: one endpoint for every model; send prompts and inspect status codes, headers and latency',
                platform: 'AI Gateway: access control, Model Armor, semantic cache, smart routing and token quotas on ai-gateway-v1',
                finance: 'AI Gateway: try prompts and see what each request costs, and how cache and routing save money',
                ai_coe: 'AI Gateway: see which models each team gets, how routing picks one, and the safety checks',
                eng: 'AI Gateway: one endpoint for every model; send prompts and inspect status codes, headers and latency',
                analysts: 'AI Gateway: ask research questions and see which model answered, what it cost and what was protected',
                support: 'AI Gateway: draft customer replies and check they are fast, safe to send and cheap',
              })}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span className="hidden min-[1400px]:inline">AI Gateway</span>
            </button>
            <button
              type="button"
              data-tour-id="tab-mcp-gateway"
              onClick={() => onTabChange('mcp-gateway')}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-lg font-semibold transition cursor-pointer text-xs ${
                activeTab === 'mcp-gateway'
                  ? 'bg-cyan-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
              title={sp({
                technical: 'MCP Gateway: call tools over JSON-RPC at /mcp with your key; REST services exposed as MCP tools',
                platform: 'MCP Gateway: native MCP tools server (/mcp) with key checks, rate limits, tool RBAC and audit logs',
                finance: 'MCP Gateway: AI assistants using business tools, with every call counted and logged',
                ai_coe: 'MCP Gateway: which business tools each team’s assistants can see and use',
                eng: 'MCP Gateway: call tools over JSON-RPC at /mcp with your key; REST services exposed as MCP tools',
                analysts: 'MCP Gateway: let the assistant look up data in business systems, only the tools your role allows',
                support: 'MCP Gateway: let the assistant check orders and stock for a customer, safely',
              })}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span className="hidden min-[1400px]:inline">MCP Gateway</span>
            </button>
            {/* 3rd Tab: Analytics & Cost */}
            <button
              type="button"
              data-tour-id="tab-analytics"
              onClick={() => onTabChange('analytics')}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-lg font-semibold transition cursor-pointer text-xs ${
                activeTab === 'analytics'
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
              title={sp({
                technical: 'Analytics & Cost: your calls, tokens, latency and errors',
                platform: 'Analytics & Cost: traffic, tokens, latency, cache hits and cost by product, model and developer',
                finance: 'Analytics & Cost: spend by team, model and user, savings and budget runway',
                ai_coe: 'Analytics & Cost: model adoption and usage by team, and how routing spreads the load',
                eng: 'Analytics & Cost: your calls, tokens, latency and errors',
                analysts: 'Analytics & Cost: what your analyses used and what they cost',
                support: 'Analytics & Cost: how many replies you drafted and what they cost',
              })}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span className="hidden min-[1400px]:inline">Analytics & Cost</span>
            </button>
            {/* 4th Tab: Admin Console - Strictly visible ONLY in Admin view */}
            {isAdminView && (
              <button
                type="button"
                data-tour-id="tab-monetization"
                onClick={() => onTabChange('monetization')}
                className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-lg font-semibold transition cursor-pointer text-xs ${
                  activeTab === 'monetization' || activeTab === 'kvm-pricing' || activeTab === 'rate-cards'
                    ? `${adminTabActive} text-white shadow-xs`
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
                title={sp({
                  technical: 'Admin Console: the products, quotas and models behind your API key',
                  platform: 'Admin Console: API products, model entitlements, token quotas, KVM rate card, rate plans and guardrails',
                  finance: 'Admin Console: budgets, prepaid credit, model prices and billing plans',
                  ai_coe: 'Admin Console: which team gets which model, automatic routing, usage limits and safety',
                  eng: 'Admin Console: the products, quotas and models behind your API key',
                  analysts: 'Admin Console: how access, limits and costs are set for each team',
                  support: 'Admin Console: how access, limits and costs are set for each team',
                })}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span className="hidden min-[1400px]:inline">Admin Console</span>
              </button>
            )}
            {/* 5th Tab: Agent Showcase - the same prompt to an agent with and without Apigee */}
            <button
              type="button"
              data-tour-id="tab-agent-showcase"
              onClick={() => onTabChange('agent-showcase')}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-lg font-semibold transition cursor-pointer text-xs ${
                activeTab === 'agent-showcase'
                  ? `${agentTabActive} text-white shadow-xs`
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
              title="Agent Showcase: the same customer question to two agents at once, one with no AI governance and one governed by Apigee; compare cost, speed and the tools each could use"
            >
              <Bot className="w-3.5 h-3.5" />
              <span className="hidden min-[1400px]:inline">Agent Showcase</span>
            </button>
          </div>

          {/* Architecture Blueprint Button */}
          {onOpenArchitecture && (
            <button
              type="button"
              onClick={onOpenArchitecture}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 font-semibold text-xs transition cursor-pointer shadow-2xs shrink-0"
              title={sp({
                technical: 'Architecture: the path of your request through the gateway, policy by policy',
                platform: 'Architecture: request flow and every policy in the AI and MCP gateway proxies',
                finance: 'Architecture: where cost is counted and where money is saved on each request',
                ai_coe: 'Architecture: where routing, limits and safety checks sit on each request',
                eng: 'Architecture: the path of your request through the gateway, policy by policy',
                analysts: 'Architecture: what happens to your question on its way to the model and back',
                support: 'Architecture: what happens to a reply request on its way to the model and back',
              })}
            >
              <Layers className="w-3.5 h-3.5 text-blue-600" />
              <span className="hidden sm:inline">Architecture</span>
            </button>
          )}
        </div>

        {/* Mobile Quick Config Toggle (< lg); the Agent Showcase has no navbar controls */}
        <button
          type="button"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className={`${activeTab === 'agent-showcase' ? 'hidden' : 'flex'} lg:hidden items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 text-xs font-medium cursor-pointer hover:bg-slate-200 shrink-0`}
          title={sp({
            technical: 'Toggle gateway controls',
            platform: 'Toggle gateway controls',
            finance: 'Show controls',
            ai_coe: 'Show controls',
            eng: 'Toggle gateway controls',
            analysts: 'Show controls',
            support: 'Show controls',
          })}
        >
          <SlidersHorizontal className="w-3.5 h-3.5 text-blue-500" />
          <span className="font-mono text-[11px] text-slate-700">
            {activeTab === 'analytics'
              ? analyticsControls?.viewMode === 'admin'
                ? sp({ technical: 'Admin View', finance: 'All spend', ai_coe: 'All usage' })
                : sp({ technical: 'User View', finance: 'My spend', ai_coe: 'My usage' })
              : activeUser.badge}
          </span>
          {mobileMenuOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>

        {/* Middle Desktop Controls (lg: and above) */}
        <div className="hidden lg:flex items-center gap-2 text-xs min-w-0">
          {activeTab === 'analytics' && analyticsControls ? (
            <>
              {/* Analytics View Mode Toggle (Admin Fleet vs My User View) */}
              <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-300 shrink-0 shadow-xs">
                <button
                  type="button"
                  onClick={() => analyticsControls.setViewMode('admin')}
                  className={`px-2.5 py-1 rounded text-[11px] font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                    analyticsControls.viewMode === 'admin'
                      ? 'bg-purple-600 text-white shadow-xs'
                      : 'text-slate-700 hover:text-slate-900 hover:bg-slate-200/60'
                  }`}
                  title={sp({
                    technical: 'Fleet view: traffic across every product, model and developer',
                    finance: 'All spend: every team, model and user',
                    ai_coe: 'All usage: every team, model and user',
                  })}
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>Admin</span>
                </button>
                <button
                  type="button"
                  onClick={() => analyticsControls.setViewMode('user')}
                  className={`px-2.5 py-1 rounded text-[11px] font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                    analyticsControls.viewMode === 'user'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-700 hover:text-slate-900 hover:bg-slate-200/60'
                  }`}
                  title={sp({
                    technical: 'My view: only calls signed with your SSO email',
                    finance: 'My view: only your own spend',
                    ai_coe: 'My view: only your own usage',
                  })}
                >
                  <User className="w-3.5 h-3.5" />
                  <span>User</span>
                </button>
              </div>

              {/* Environment Selector (Prod / Dev) - which Apigee env's analytics to show */}
              <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-300 shrink-0 shadow-xs" title={sp({
                technical: 'Apigee environment: prod or dev analytics',
                finance: 'Live (prod) or Sandbox (dev) figures',
                ai_coe: 'Live (prod) or Sandbox (dev) figures',
              })}>
                {(['prod', 'dev'] as const).map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => analyticsControls.setEnv(e)}
                    className={`px-2.5 py-1 rounded transition cursor-pointer uppercase text-[11px] font-bold ${
                      analyticsControls.env === e
                        ? e === 'dev' ? 'bg-amber-500 text-white shadow-xs' : 'bg-emerald-600 text-white shadow-xs'
                        : 'text-slate-700 hover:text-slate-950 hover:bg-slate-200/70'
                    }`}
                  >
                    {e}
                  </button>
                ))}
              </div>

              {/* Time Range Selector (24H, 7D, 30D) - Ultra crisp contrast in light & dark */}
              <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-300 shrink-0 shadow-xs">
                {(['24h', '7d', '30d'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => analyticsControls.setTimeRange(r)}
                    className={`px-2.5 py-1 rounded transition cursor-pointer uppercase text-[11px] font-bold ${
                      analyticsControls.timeRange === r
                        ? 'bg-purple-600 text-white shadow-xs'
                        : 'text-slate-700 hover:text-slate-950 hover:bg-slate-200/70'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>

              {/* Refresh Button */}
              <button
                type="button"
                onClick={analyticsControls.onRefresh}
                disabled={analyticsControls.loading}
                className="p-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 hover:text-purple-600 transition cursor-pointer shadow-xs disabled:opacity-50 shrink-0"
                title={sp({
                  technical: 'Refresh live metrics from the Management API',
                  finance: 'Refresh the latest spend',
                  ai_coe: 'Refresh the latest usage',
                })}
              >
                {analyticsControls.loading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-600" />
                ) : (
                  <RotateCcw className="w-3.5 h-3.5" />
                )}
              </button>
            </>
          ) : activeTab === 'monetization' || activeTab === 'kvm-pricing' || activeTab === 'rate-cards' ? (
            /* Admin Console owns its own in-page controls; the nav tab already
               marks this as the admin-only area, so no extra badge here. */
            null
          ) : (
            <>
              {/* Model Selector */}
              {activeTab === 'ai-gateway' && (
                <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 min-w-0">
                  <div className="flex items-center gap-1.5 pl-2.5 pr-1.5 text-slate-600 text-xs font-medium shrink-0">
                    <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                    <span className="font-semibold hidden min-[1800px]:inline">{sp({ technical: 'Model:', eng: 'Model:', analysts: 'Model:', support: 'Model:' })}</span>
                  </div>
                  <select
                    value={settings.model}
                    onChange={(e) => handleModelChange(e.target.value)}
                    className="bg-white text-slate-900 text-xs font-semibold rounded-lg px-2.5 py-1 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 cursor-pointer shadow-xs min-w-[160px] w-[215px] min-[1800px]:w-[250px]"
                  >
                    {AVAILABLE_MODELS.map((m) => (
                      <option key={m.id} value={m.id} className="bg-white text-slate-900">
                        {m.id === 'auto'
                          ? sp({
                              technical: 'Auto (Intelligent Routing)',
                              eng: 'Auto (Intelligent Routing)',
                              analysts: 'Auto (best model per question)',
                              support: 'Auto (best model per reply)',
                            })
                          : `${m.name} (${m.tag})`}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}
        </div>

        {/* Top-right picker: consumer persona signs AI/MCP Gateway calls; admin
            persona decides which Admin Console controls may be changed. */}
        {showTopRightPicker && (
          <div className="hidden lg:flex items-center ml-auto mr-2 min-w-0">
            {isAdminConsoleTab ? (
              <AdminRoleSelect value={settings.adminRole || 'platform'} onChange={handleAdminRoleChange} />
            ) : (
              <PersonaSelect value={settings.activeUser} onChange={handleUserChange} />
            )}
          </div>
        )}

        {/* Right: Top-Right SSO User Profile */}
        {/* `relative` anchors the absolutely-positioned SSO popover below the
            button; without it the popover resolves against a distant ancestor
            and renders detached, clipped off the top of the viewport. */}
        <div className={`relative flex items-center shrink-0 ${showTopRightPicker ? 'ml-auto lg:ml-0' : 'ml-auto'}`} ref={ssoPopoverRef}>
          <button
            type="button"
            onClick={() => setSsoPopoverOpen(!ssoPopoverOpen)}
            className="flex items-center gap-2 pl-2 pr-3 py-1 rounded-xl bg-slate-100 hover:bg-slate-200/80 border border-slate-200 hover:border-slate-300 transition cursor-pointer text-left group shadow-xs shrink-0"
            title={sp({
              technical: `Logged in via Google Cloud Identity SSO: ${effectiveEmail}`,
              platform: `Logged in via Google Cloud Identity SSO: ${effectiveEmail}`,
              finance: `Signed in as ${effectiveEmail}; your requests are charged to your team`,
              ai_coe: `Signed in as ${effectiveEmail}; your usage is tracked per team`,
              eng: `SSO identity sent as the Authorization bearer: ${effectiveEmail}`,
              analysts: `Signed in as ${effectiveEmail}`,
              support: `Signed in as ${effectiveEmail}`,
            })}
          >
            {/* Avatar Circle with Status Indicator */}
            <div className="relative shrink-0">
              <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white font-bold text-xs shadow-xs">
                {ssoUser.avatarText || 'SSO'}
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-emerald-500 border-2 border-white rounded-full animate-pulse" />
            </div>

            {/* Initials only (room for the 5th tab); the name and email are in the tooltip and the popover. */}
            <span className="sr-only">{ssoUser.name || 'SSO User'}</span>

            <ChevronDown className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 transition shrink-0" />
          </button>

            {/* SSO Profile Popover.
                `top-full` is required: with `top:auto` an absolutely-positioned
                child uses its static position, which inside an `items-center`
                flex row is vertically centred -- pushing this 220px panel above
                the navbar and off the top of the viewport. */}
            {ssoPopoverOpen && (
              <div className="absolute top-full right-0 mt-2 w-80 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-4 text-xs z-50 animate-in fade-in zoom-in-95 duration-150">
                <div className="flex items-start justify-between pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white font-bold text-sm ring-2 ring-emerald-400/50">
                      {ssoUser.avatarText || 'SSO'}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-slate-100 text-sm">{ssoUser.name}</span>
                        {onEditProfileName && (
                          <button
                            type="button"
                            onClick={() => {
                              setSsoPopoverOpen(false);
                              onEditProfileName(ssoUser.email || DEFAULT_SSO_USER.email, ssoUser.name || '');
                            }}
                            className="p-1 text-slate-400 hover:text-blue-400 rounded-md hover:bg-slate-800 transition cursor-pointer"
                            title={sp({
                              technical: 'Edit the first and last name on your developer record',
                              platform: 'Edit the first and last name on your developer record',
                              finance: 'Edit your name',
                              ai_coe: 'Edit your name',
                              eng: 'Edit the first and last name on your developer record',
                              analysts: 'Edit your name',
                              support: 'Edit your name',
                            })}
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono flex items-center gap-1">
                        <Mail className="w-3 h-3 text-slate-500 shrink-0" />
                        <span className="truncate">{ssoUser.email}</span>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSsoPopoverOpen(false)}
                    className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="py-3 space-y-2 border-b border-slate-800 text-[11px]">
                  <div className="flex items-center justify-between text-slate-400">
                    <span className="flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5 text-blue-400" />
                      {sp({ technical: 'SSO Provider:', business: 'Signed in with:' })}
                    </span>
                    <span className="text-slate-200 font-medium">{ssoUser.provider}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-400">
                    <span className="flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5 text-purple-400" />
                      {sp({ technical: 'Domain:', business: 'Organization:' })}
                    </span>
                    <span className="text-slate-200 font-mono">{ssoUser.organization}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-400">
                    <span>{sp({ technical: 'Session Status:', business: 'Status:' })}</span>
                    <span className="text-emerald-400 font-semibold flex items-center gap-1">
                      <Check className="w-3 h-3" /> {sp({ technical: 'Active / Authenticated', business: 'Signed in' })}
                    </span>
                  </div>
                </div>

                <div className="pt-3">
                  {/*
                    Identity is derived from the SSO session and is deliberately
                    not editable here -- the gateway authorises on this value.
                    The signed-in address is shown in the header above.
                  */}
                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    {sp({
                      technical: ssoUser.idToken
                        ? 'Your Google SSO bearer token is sent as Authorization on every call, and the gateway validates it alongside your x-apikey.'
                        : 'Identity comes from the SSO session and is sent with every call. Without it the gateway returns 401.',
                      platform: ssoUser.idToken
                        ? 'Google SSO bearer token attached. The gateway decodes it (DJWT-ExtractUserIdentity) on every request for per-user attribution and zero-trust checks.'
                        : 'Identity comes from the active SSO session and is attached to every gateway request for attribution. It cannot be changed here.',
                      finance:
                        'You are signed in with Google. Every request is tied to your name, so spend can be charged back to the right team.',
                      ai_coe:
                        'You are signed in with Google. Every request is tied to your name, so usage and safety events can be traced to a team.',
                      eng: ssoUser.idToken
                        ? 'Your Google SSO bearer token is sent as Authorization on every call, and the gateway validates it alongside your x-apikey.'
                        : 'Identity comes from the SSO session and is sent with every call. Without it the gateway returns 401.',
                      analysts:
                        'You are signed in with Google. Your questions are tied to you, so usage is tracked per person and your data stays protected.',
                      support:
                        'You are signed in with Google. Replies you draft are tied to you, so usage is tracked per person.',
                    })}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

      {/* Collapsible Mobile Controls Drawer.
          `lg:hidden` must match the toggle button above (`flex lg:hidden`);
          it was `md:hidden`, so between 768px and 1023px the toggle opened
          a drawer that was still display:none. */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-t border-slate-800/80 bg-slate-900/95 px-4 py-3 space-y-3 animate-in slide-in-from-top-2 duration-150">
          {/* Production Status */}
          <div className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-emerald-950/60 border border-emerald-500/30 text-emerald-400 text-xs">
            <span className="flex items-center gap-2 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              {sp({ technical: 'Gateway Environment', business: 'Environment' })}
            </span>
            <span className="font-mono font-semibold">{sp({ technical: 'Production (Global)', business: 'Live' })}</span>
          </div>

          {/* Controls based on active tab */}
          {activeTab === 'analytics' && analyticsControls ? (
            <>
              <div>
                <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">{sp({ technical: 'Analytics View', finance: 'Show', ai_coe: 'Show' })}</div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      analyticsControls.setViewMode('admin');
                      setMobileMenuOpen(false);
                    }}
                    className={`py-1.5 px-3 rounded-lg text-xs font-semibold transition ${
                      analyticsControls.viewMode === 'admin'
                        ? 'bg-purple-600 text-white shadow-xs'
                        : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {sp({ technical: 'Admin Fleet View', finance: 'All spend', ai_coe: 'All usage' })}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      analyticsControls.setViewMode('user');
                      setMobileMenuOpen(false);
                    }}
                    className={`py-1.5 px-3 rounded-lg text-xs font-semibold transition ${
                      analyticsControls.viewMode === 'user'
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {sp({ technical: 'My User View', finance: 'My spend', ai_coe: 'My usage' })}
                  </button>
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">{sp({ technical: 'Environment', finance: 'Live or Sandbox', ai_coe: 'Live or Sandbox' })}</div>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {(['prod', 'dev'] as const).map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => {
                        analyticsControls.setEnv(e);
                        setMobileMenuOpen(false);
                      }}
                      className={`py-1.5 px-2 rounded-lg text-xs font-bold uppercase transition ${
                        analyticsControls.env === e
                          ? e === 'dev' ? 'bg-amber-500 text-white shadow-xs' : 'bg-emerald-600 text-white shadow-xs'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {e}
                    </button>
                  ))}
                </div>
                <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">{sp({ technical: 'Time Range', finance: 'Period', ai_coe: 'Period' })}</div>
                <div className="grid grid-cols-3 gap-2">
                  {(['24h', '7d', '30d'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => {
                        analyticsControls.setTimeRange(r);
                        setMobileMenuOpen(false);
                      }}
                      className={`py-1.5 px-2 rounded-lg text-xs font-bold uppercase transition ${
                        analyticsControls.timeRange === r
                          ? 'bg-purple-600 text-white shadow-xs'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Persona - mirrors the desktop top-right picker */}
              {(activeTab === 'ai-gateway' || activeTab === 'mcp-gateway') && (
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">{sp({ technical: 'Persona (API key)', eng: 'Persona (API key)', analysts: 'Acting as', support: 'Acting as' })}</div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {PERSONAS.map((persona) => personaDisplay(persona, customerTheme.industry)).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          handleUserChange(p.id);
                          setMobileMenuOpen(false);
                        }}
                        className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold transition truncate ${
                          settings.activeUser === p.id
                            ? 'bg-purple-600 text-white shadow-sm'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                        title={`${p.label}: ${p.summary}`}
                      >
                        {p.short}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Admin persona - mirrors the desktop top-right picker in the Admin Console */}
              {isAdminConsoleTab && (
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">{sp({ technical: 'Admin persona', finance: 'You are', ai_coe: 'You are' })}</div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {ADMIN_ROLES.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => {
                          handleAdminRoleChange(r.id);
                          setMobileMenuOpen(false);
                        }}
                        className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold transition truncate ${
                          (settings.adminRole || 'platform') === r.id
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                        title={`${r.label}: ${r.summary}`}
                      >
                        {r.short}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Model Selection */}
              {activeTab === 'ai-gateway' && (
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">{sp({ technical: 'Vertex AI Model', eng: 'Vertex AI Model', analysts: 'AI model', support: 'AI model' })}</div>
                  <select
                    value={settings.model}
                    onChange={(e) => {
                      handleModelChange(e.target.value);
                      setMobileMenuOpen(false);
                    }}
                    className="w-full bg-slate-800 text-slate-100 text-xs font-medium rounded-lg px-3 py-2 border border-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    {AVAILABLE_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.id === 'auto'
                          ? sp({
                              technical: 'Auto (Intelligent Routing)',
                              eng: 'Auto (Intelligent Routing)',
                              analysts: 'Auto (best model per question)',
                              support: 'Auto (best model per reply)',
                            })
                          : `${m.name} (${m.tag})`}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </header>
  );
};
