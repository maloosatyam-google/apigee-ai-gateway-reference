import React, { useState } from 'react';
import { GatewaySettings, UserPersona } from '../types';
import { DEFAULT_SETTINGS, USERS, DEFAULT_SSO_USER } from '../services/defaultSettings';
import { personaById } from '../utils/personas';
import { X, Save, RotateCcw, ShieldCheck, Server, User, AlertTriangle, Zap } from 'lucide-react';
import { usePersonaVoice } from '../utils/voice';
import { useCustomerTheme } from './CustomerThemeProvider';
import { personaDisplay } from '../utils/customerTheme';
import { APIGEE_BASE_PROD } from '../config/deployment.js';

interface GatewaySettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: GatewaySettings;
  onSave: (newSettings: GatewaySettings) => void;
}

export const GatewaySettingsModal: React.FC<GatewaySettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSave,
}) => {
  const [form, setForm] = useState<GatewaySettings>({ ...settings });
  const { sp } = usePersonaVoice('persona');
  const { theme } = useCustomerTheme();
  /** Persona copy in the customer theme's industry wording. */
  const pd = (id: UserPersona) => personaDisplay(personaById(id), theme.industry);

  if (!isOpen) return null;

  const handleUserSelect = (userPersona: UserPersona) => {
    const user = USERS[userPersona];
    setForm((prev) => ({
      ...prev,
      activeUser: userPersona,
      apiKey: user.apiKey,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
    onClose();
  };

  const handleReset = () => {
    setForm({ ...DEFAULT_SETTINGS });
  };

  const ssoEmail = form.ssoUser?.email || form.userEmail || DEFAULT_SSO_USER.email;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-blue-600" />
            <h2 className="text-base font-bold text-slate-900">
              {sp({ technical: 'Gateway Configuration', analysts: 'Connection settings', support: 'Connection settings' })}
            </h2>
          </div>
          <button
            onClick={onClose}
            title={sp({ technical: 'Close', analysts: 'Close', support: 'Close' })}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200/60 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 text-xs">
          {/* Environment Status (Production Only) */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-slate-700 font-semibold flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-emerald-600" />
                <span>{sp({ technical: 'Target Gateway Environment', analysts: 'Where your questions go', support: 'Where your replies are drafted' })}</span>
              </label>
              <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-300 text-[10px] font-mono font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {sp({ technical: 'Production (Global)', analysts: 'Live', support: 'Live' })}
              </span>
            </div>
            <div className="text-[11px] text-slate-500 font-mono">
              {sp({ technical: 'Base URL:', analysts: 'Address:', support: 'Address:' })} <span className="text-slate-900 font-semibold">{APIGEE_BASE_PROD}</span>
            </div>
          </div>

          {/* Persona selection (which persona's API key signs the calls) */}
          <div className="space-y-2">
            <label className="text-slate-700 font-semibold flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-amber-600" />
              <span>
                {sp<React.ReactNode>({
                  technical: (
                    <>
                      Persona credential (<code className="font-mono text-amber-700 text-[11px]">x-apikey</code>)
                    </>
                  ),
                  analysts: 'Whose access to use',
                  support: 'Whose access to use',
                })}
              </span>
            </label>
            <div className="grid grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => handleUserSelect('admin')}
                className={`p-3 rounded-xl border text-left transition cursor-pointer shadow-2xs ${form.activeUser === 'admin'
                    ? 'bg-purple-50 border-purple-300 text-purple-900 ring-2 ring-purple-500/20'
                    : 'bg-slate-50 hover:bg-slate-100/80 border-slate-200 text-slate-700'
                }`}
              >
                <div className={`font-bold text-xs ${form.activeUser === 'admin' ? 'text-purple-700' : 'text-slate-800'}`}>{pd('admin').short}</div>
                <div className={`text-[10px] mt-0.5 ${form.activeUser === 'admin' ? 'text-purple-700/80' : 'text-slate-500'}`}>{pd('admin').summary}</div>
                <div className="text-[9px] font-mono text-slate-400 mt-1 truncate">Key: {USERS.admin.apiKey ? `${USERS.admin.apiKey.slice(0, 8)}...` : 'Not Set'}</div>
              </button>

              <button
                type="button"
                onClick={() => handleUserSelect('sales_agent')}
                className={`p-3 rounded-xl border text-left transition cursor-pointer shadow-2xs ${form.activeUser === 'sales_agent'
                    ? 'bg-blue-50 border-blue-300 text-blue-900 ring-2 ring-blue-500/20'
                    : 'bg-slate-50 hover:bg-slate-100/80 border-slate-200 text-slate-700'
                }`}
              >
                <div className={`font-bold text-xs ${form.activeUser === 'sales_agent' ? 'text-blue-700' : 'text-slate-800'}`}>{pd('sales_agent').short}</div>
                <div className={`text-[10px] mt-0.5 ${form.activeUser === 'sales_agent' ? 'text-blue-700/80' : 'text-slate-500'}`}>{pd('sales_agent').summary}</div>
                <div className="text-[9px] font-mono text-slate-400 mt-1 truncate">Key: {USERS.sales_agent.apiKey ? `${USERS.sales_agent.apiKey.slice(0, 8)}...` : 'Not Set'}</div>
              </button>

              <button
                type="button"
                onClick={() => handleUserSelect('loans_agent')}
                className={`p-3 rounded-xl border text-left transition cursor-pointer shadow-2xs ${form.activeUser === 'loans_agent'
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-900 ring-2 ring-emerald-500/20'
                    : 'bg-slate-50 hover:bg-slate-100/80 border-slate-200 text-slate-700'
                }`}
              >
                <div className={`font-bold text-xs ${form.activeUser === 'loans_agent' ? 'text-emerald-700' : 'text-slate-800'}`}>{pd('loans_agent').short}</div>
                <div className={`text-[10px] mt-0.5 ${form.activeUser === 'loans_agent' ? 'text-emerald-700/80' : 'text-slate-500'}`}>{pd('loans_agent').summary}</div>
                <div className="text-[9px] font-mono text-slate-400 mt-1 truncate">Key: {USERS.loans_agent.apiKey ? `${USERS.loans_agent.apiKey.slice(0, 8)}...` : 'Not Set'}</div>
              </button>
            </div>

            {/* Injected Headers Preview */}
            <div className="mt-3 p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5 font-mono text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Authorization:</span>
                <span className={form.omitEmailHeader ? 'text-rose-600 line-through font-semibold' : 'text-emerald-700 font-semibold'}>
                  {form.omitEmailHeader
                    ? sp({
                        technical: '(Bearer omitted: expect 401)',
                        analysts: '(Sign-in left off for this test)',
                        support: '(Sign-in left off for this test)',
                      })
                    : `Bearer ya29... (${ssoEmail})`}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">x-apikey:</span>
                <span className="text-amber-700 font-semibold">{(() => {
                  // Mirror sendPromptToApigee: a named persona always sends its own runtime
                  // key (populated from /api/me); form.apiKey is only the fallback.
                  const key = USERS[form.activeUser as keyof typeof USERS]?.apiKey || form.apiKey || '';
                  return key ? `${key.slice(0, 10)}...${key.slice(-6)}` : '—';
                })()}</span>
              </div>
            </div>

            {/* Semantic Cache Toggle */}
            <label className="flex items-center justify-between p-2.5 mt-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 cursor-pointer hover:bg-slate-100/70 transition">
              <div className="flex items-center gap-2">
                <Zap className={`w-4 h-4 ${form.useCache ? 'text-emerald-600' : 'text-slate-400'}`} />
                <div>
                  <div className="text-xs font-semibold text-slate-900">
                    {sp({ technical: 'Semantic Vector Cache', analysts: 'Reuse earlier answers', support: 'Reuse earlier replies' })}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {sp<React.ReactNode>({
                      technical: (
                        <>
                          Sends <code className="text-emerald-700 font-mono">use-cache: true</code>; hits skip the model and cost $0
                        </>
                      ),
                      analysts: 'Similar questions come back instantly at no cost',
                      support: 'Common customer questions answered instantly, free',
                    })}
                  </div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={form.useCache}
                onChange={(e) => setForm({ ...form, useCache: e.target.checked })}
                className="w-4 h-4 rounded bg-white border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
              />
            </label>

            {/* Simulate Missing Authorization */}
            <label className="flex items-center gap-2.5 p-2.5 mt-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 cursor-pointer hover:bg-amber-100/60 transition">
              <input
                type="checkbox"
                checked={form.omitEmailHeader}
                onChange={(e) => setForm({ ...form, omitEmailHeader: e.target.checked })}
                className="w-4 h-4 rounded bg-white border-amber-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
              />
              <span className="text-[11px] font-medium flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>
                  {sp({
                    technical: 'Simulate Missing Authorization (Tests 401 Unauthorized rejection)',
                    analysts: 'Test without sign-in (shows the request being refused)',
                    support: 'Test without sign-in (shows the request being refused)',
                  })}
                </span>
              </span>
            </label>
          </div>

          {/* Project & Location */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-slate-600 text-[11px] block mb-1 font-medium">{sp({ technical: 'GCP Project ID:', analysts: 'Cloud project:', support: 'Cloud project:' })}</label>
              <input
                type="text"
                value={form.projectId}
                onChange={(e) => setForm({ ...form, projectId: e.target.value })}
                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-2xs"
              />
            </div>
            <div>
              <label className="text-slate-600 text-[11px] block mb-1 font-medium">{sp({ technical: 'Vertex AI Location:', analysts: 'AI region:', support: 'AI region:' })}</label>
              <input
                type="text"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-2xs"
              />
            </div>
          </div>

          {/* Footer Actions */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-between">
            <button
              type="button"
              onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 transition font-medium cursor-pointer shadow-2xs"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{sp({ technical: 'Reset Defaults', analysts: 'Reset', support: 'Reset' })}</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-600 hover:text-slate-900 transition font-medium cursor-pointer"
              >
                {sp({ technical: 'Cancel', analysts: 'Cancel', support: 'Cancel' })}
              </button>
              <button
                type="submit"
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow-md shadow-blue-600/20 transition cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{sp({ technical: 'Save Settings', analysts: 'Save', support: 'Save' })}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
