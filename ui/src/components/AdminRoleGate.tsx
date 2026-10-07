import React from 'react';
import { Lock, ShieldCheck } from 'lucide-react';
import { adminRoleById, ownerLabel, roleCan, ADMIN_ROLES } from '../utils/adminRoles';
import type { AdminCapability, AdminRole } from '../utils/adminRoles';
import { say, speak, usePersonaVoice } from '../utils/voice';
import type { Speaker, Voice } from '../utils/voice';

/** What each capability is called in the console copy. */
export const CAPABILITY_LABEL: Record<AdminCapability, string> = {
  models: 'model entitlements',
  quota: 'token quotas',
  routing: 'auto-routing',
  guardrails: 'guardrails',
  budget: 'budgets',
  wallet: 'developer wallets',
  pricing: 'model pricing',
  rate_plans: 'rate plans and subscriptions',
  custom: 'custom product attributes',
  reset: 'resetting the Dev sandbox',
};

/** Business-voice names for the same capabilities (Finance and AI CoE readers). */
export const CAPABILITY_LABEL_BUSINESS: Record<AdminCapability, string> = {
  models: 'which teams get which AI models',
  quota: 'usage limits',
  routing: 'automatic model choice',
  guardrails: 'safety controls',
  budget: 'monthly budgets',
  wallet: 'prepaid credit',
  pricing: 'model prices',
  rate_plans: 'billing plans',
  custom: 'other persona settings',
  reset: 'resetting the Sandbox',
};

/** AI CoE wording, where it differs from the shared business name. */
const CAPABILITY_LABEL_AI_COE: Partial<Record<AdminCapability, string>> = {
  quota: 'fair-use limits per team',
  budget: 'team budgets',
  wallet: 'team prepaid credit',
};

export function capabilityLabel(voice: Voice, capability: AdminCapability): string {
  return say(voice, CAPABILITY_LABEL, CAPABILITY_LABEL_BUSINESS)[capability];
}

/** Per-speaker capability name: Platform keeps the Apigee term, Finance and AI CoE their own. */
export function capabilityLabelFor(speaker: Speaker, capability: AdminCapability): string {
  return speak(speaker, {
    technical: CAPABILITY_LABEL[capability],
    finance: CAPABILITY_LABEL_BUSINESS[capability],
    ai_coe: CAPABILITY_LABEL_AI_COE[capability] ?? CAPABILITY_LABEL_BUSINESS[capability],
  });
}

/**
 * One line on why the other team's area still matters to the viewer, so a
 * read-only area reads as context rather than a dead end.
 */
function crossTeamHint(role: AdminRole, capability: AdminCapability): string {
  if (role === 'finance' && (capability === 'models' || capability === 'quota' || capability === 'routing')) {
    return ' These choices drive what each persona costs, so they shape your forecast.';
  }
  if (role === 'finance' && capability === 'guardrails') {
    return ' Blocked requests are stopped before the model runs, so they are not billed.';
  }
  if (role === 'ai_coe' && (capability === 'budget' || capability === 'wallet' || capability === 'pricing' || capability === 'rate_plans')) {
    return ' This caps how much each team can use the models you assign.';
  }
  if (role === 'ai_coe' && capability === 'custom') {
    return ' Platform keeps these in step with the models and limits you set.';
  }
  return '';
}

/** The narrowest role that owns a capability, used for the "Switch to …" action. */
export function ownerRole(capability: AdminCapability): AdminRole {
  const owner = ADMIN_ROLES.find((r) => r.id !== 'platform' && r.capabilities.includes(capability));
  return owner ? owner.id : 'platform';
}

interface RoleGateProps {
  role: AdminRole;
  capability: AdminCapability;
  onSwitchRole?: (role: AdminRole) => void;
  /**
   * true: wrap the children in a disabled <fieldset>, so every input and button
   * inside is read-only. Use it for edit forms. false: banner only, for views
   * with search boxes and sorting that must keep working (the handlers guard
   * the writes instead).
   */
  lockInputs?: boolean;
  children: React.ReactNode;
}

/**
 * Shows who owns a console area under the current admin persona and, when the
 * persona does not own it, makes it read-only. Demo role switcher, not auth.
 */
export const RoleGate: React.FC<RoleGateProps> = ({ role, capability, onSwitchRole, lockInputs = true, children }) => {
  const allowed = roleCan(role, capability);
  const current = adminRoleById(role);
  const owner = ownerLabel(capability);
  const { speaker, sp } = usePersonaVoice('admin');
  const what = capabilityLabelFor(speaker, capability);

  return (
    <div className="space-y-2">
      {!allowed ? (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-xs">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            {sp({
              technical: (
                <>
                  <b>{owner}</b> owns {what}. You are viewing as <b>{current.label}</b>, so inputs are disabled and no
                  writes are sent.
                </>
              ),
              finance: (
                <>
                  <b>{owner}</b> looks after {what}. You are viewing as <b>{current.label}</b>, so you can see it but not
                  change it.
                  {crossTeamHint(role, capability)}
                </>
              ),
              ai_coe: (
                <>
                  <b>{owner}</b> looks after {what}. As <b>{current.label}</b> you can review it for your teams but not
                  change it.
                  {crossTeamHint(role, capability)}
                </>
              ),
            })}
          </span>
          {onSwitchRole && (
            <button
              type="button"
              onClick={() => onSwitchRole(ownerRole(capability))}
              className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold cursor-pointer shrink-0"
            >
              {sp({ technical: 'Switch to', finance: 'Switch to', ai_coe: 'Switch to' })} {owner}
            </button>
          )}
        </div>
      ) : role !== 'platform' ? (
        <div className="flex items-center gap-1.5 text-[11px] text-emerald-700 font-medium px-1">
          <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
          {sp({
            technical: <>{current.label} owns {what}.</>,
            finance: <>You look after {what}. Changes here move real spend once Live.</>,
            ai_coe: <>You look after {what}. Changes here affect what your teams can use.</>,
          })}
        </div>
      ) : null}
      {lockInputs ? (
        <fieldset disabled={!allowed} className={`min-w-0 border-0 p-0 m-0 ${allowed ? '' : 'opacity-75'}`}>
          {children}
        </fieldset>
      ) : (
        children
      )}
    </div>
  );
};

/** Modal shown when a guarded handler is invoked by a persona that does not own the capability. */
export const RoleNoticeModal: React.FC<{
  role: AdminRole;
  capability: AdminCapability;
  onClose: () => void;
  onSwitchRole?: (role: AdminRole) => void;
}> = ({ role, capability, onClose, onSwitchRole }) => {
  const owner = ownerLabel(capability);
  const { speaker, sp } = usePersonaVoice('admin');
  const what = capabilityLabelFor(speaker, capability);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="role-notice-title"
    >
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700 shrink-0">
            <Lock className="w-5 h-5" />
          </div>
          <h3 id="role-notice-title" className="text-sm font-bold text-slate-900">
            {sp({ technical: `${owner} owns ${what}`, finance: `${owner} looks after ${what}`, ai_coe: `${owner} looks after ${what}` })}
          </h3>
        </div>
        <p className="text-xs text-slate-600 leading-relaxed">
          {sp({
            technical: (
              <>
                You are acting as <b>{adminRoleById(role).label}</b>, so the write was not sent and nothing changed. Switch
                the admin persona (top right) to <b>{owner}</b> or <b>Platform Admin</b> to apply it.
              </>
            ),
            finance: (
              <>
                You are acting as <b>{adminRoleById(role).label}</b>, so you can see this but not change it, and no spend
                has moved. To make the change, switch the admin persona (top right) to <b>{owner}</b> or{' '}
                <b>Platform Admin</b>.
              </>
            ),
            ai_coe: (
              <>
                You are acting as <b>{adminRoleById(role).label}</b>, so you can review this but not change it. To make
                the change, switch the admin persona (top right) to <b>{owner}</b> or <b>Platform Admin</b>.
              </>
            ),
          })}
        </p>
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
          >
            OK
          </button>
          {onSwitchRole && (
            <button
              type="button"
              onClick={() => {
                onSwitchRole(ownerRole(capability));
                onClose();
              }}
              className="px-3 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold cursor-pointer"
            >
              {sp({ technical: 'Switch to', finance: 'Switch to', ai_coe: 'Switch to' })} {owner}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
