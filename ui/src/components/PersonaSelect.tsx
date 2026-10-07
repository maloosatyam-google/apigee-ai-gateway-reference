import React from 'react';
import { UserCircle2, ShieldCheck } from 'lucide-react';
import { PERSONAS } from '../utils/personas';
import { ADMIN_ROLES } from '../utils/adminRoles';
import type { AdminRole, UserPersona } from '../types';
import { OptionPicker } from './OptionPicker';
import { usePersonaVoice } from '../utils/voice';
import { useCustomerTheme } from './CustomerThemeProvider';
import { personaDisplay } from '../utils/customerTheme';

/**
 * Top-right persona picker. The persona decides which API key (and therefore
 * which persona API product) signs AI Gateway and MCP Gateway calls, so the
 * same prompt can be shown behaving differently per persona.
 */
export const PersonaSelect: React.FC<{ value: UserPersona; onChange: (persona: UserPersona) => void }> = ({
  value,
  onChange,
}) => {
  const { sp } = usePersonaVoice('persona');
  // Industry wording from the customer theme; only labels change, never the persona id.
  const { theme } = useCustomerTheme();
  const options = PERSONAS.map((p) => personaDisplay(p, theme.industry));
  return (
  <OptionPicker
    value={value}
    options={options}
    onChange={onChange}
    caption={sp({ technical: 'Persona:', analysts: 'Acting as:', support: 'Acting as:' })}
    icon={<UserCircle2 className="w-3.5 h-3.5 text-purple-600 shrink-0" />}
    footer={sp({
      technical:
        'Each persona is an API product with its own key, models, routing and token quotas. Switch to see the same prompt governed differently.',
      analysts:
        'Each persona has its own AI models, limits and data protections. Switch to see how another team’s question would be handled.',
      support:
        'Each persona has its own AI models, limits and costs. Switch to compare how another team’s assistant would reply.',
    })}
  />
  );
};

/**
 * Admin persona picker (Admin Console). Decides which console controls can be
 * changed: Finance owns cost, the AI CoE owns models, routing, quotas and
 * guardrails, Platform Admin owns everything. Demo role switcher, not auth.
 */
export const AdminRoleSelect: React.FC<{ value: AdminRole; onChange: (role: AdminRole) => void }> = ({
  value,
  onChange,
}) => {
  const { sp } = usePersonaVoice('admin');
  return (
  <OptionPicker
    value={value}
    options={ADMIN_ROLES}
    onChange={onChange}
    caption={sp({ technical: 'Admin persona:', finance: 'Viewing as:', ai_coe: 'Viewing as:' })}
    icon={<ShieldCheck className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
    accent={{ row: 'bg-blue-50', check: 'text-blue-600' }}
    footer={sp({
      technical:
        'Each persona only sees the Admin Console tabs it owns; Platform Admin sees all. Prod stays read-only for everyone and changes ship via PR.',
      finance:
        'You see budgets, prepaid credit, prices and billing plans. Live stays read-only for everyone, so no spend changes without review.',
      ai_coe:
        'You see models per team, routing, usage limits and safety. Live stays read-only for everyone, so teams see no change without review.',
    })}
  />
  );
};
