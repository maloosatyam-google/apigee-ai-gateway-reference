import React, { useState, useEffect } from 'react';
import { UserCheck, ShieldCheck, Coins, Key, Loader2, CheckCircle2, X, AlertCircle } from 'lucide-react';
import { usePersonaVoice } from '../utils/voice';

export interface DeveloperOnboardingResult {
  email: string;
  name: string;
  firstName: string;
  lastName: string;
  apiKey: string;
  apiKeys: Record<string, string>;
}

interface DeveloperOnboardingModalProps {
  isOpen: boolean;
  email: string;
  suggestedFirstName: string;
  suggestedLastName: string;
  isEditMode?: boolean;
  onComplete: (result: DeveloperOnboardingResult) => void;
  onCancel?: () => void;
}

export const DeveloperOnboardingModal: React.FC<DeveloperOnboardingModalProps> = ({
  isOpen,
  email,
  suggestedFirstName,
  suggestedLastName,
  isEditMode = false,
  onComplete,
  onCancel,
}) => {
  const [firstName, setFirstName] = useState(suggestedFirstName || '');
  const [lastName, setLastName] = useState(suggestedLastName || '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { sp } = usePersonaVoice('persona');

  useEffect(() => {
    if (isOpen) {
      setFirstName(suggestedFirstName || '');
      setLastName(suggestedLastName || '');
      setError(null);
    }
  }, [isOpen, suggestedFirstName, suggestedLastName]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanFirst = firstName.trim();
    const cleanLast = lastName.trim();

    if (!cleanFirst) {
      setError(sp({ technical: 'First Name is required to create the developer.', analysts: 'Please enter your first name.', support: 'Please enter your first name.' }));
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/me/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          firstName: cleanFirst,
          lastName: cleanLast || cleanFirst,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || sp({ technical: `Developer provisioning failed (HTTP ${res.status}).`, analysts: 'Could not set up your profile. Please try again.', support: 'Could not set up your profile. Please try again.' }));
      }

      onComplete({
        email: data.email || email,
        name: data.name || `${cleanFirst} ${cleanLast}`.trim(),
        firstName: data.firstName || cleanFirst,
        lastName: data.lastName || cleanLast,
        apiKey: data.apiKey || '',
        apiKeys: data.apiKeys || {},
      });
    } catch (err: any) {
      setError(
        err.message || sp({ technical: 'An error occurred while creating your developer profile. Check the /api/me/onboard response.', analysts: 'Something went wrong while setting up your profile.', support: 'Something went wrong while setting up your profile.' })
      );
    } finally {
      setSubmitting(false);
    }
  };

  const previewFullName =
    lastName.trim() && lastName.trim() !== firstName.trim()
      ? `${firstName.trim()} ${lastName.trim()}`
      : firstName.trim() || sp({ technical: 'Developer', analysts: 'You', support: 'You' });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Top Banner */}
        <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 px-6 py-4 flex items-center justify-between text-white">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-white/15 backdrop-blur-xs">
              <UserCheck className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold leading-tight">
                {isEditMode
                  ? sp({ technical: 'Update Developer Profile', analysts: 'Update your profile', support: 'Update your profile' })
                  : sp({ technical: 'First-Time Developer Onboarding', analysts: 'Welcome: set up your research access', support: 'Welcome: set up your AI assistant' })}
              </h2>
              <p className="text-xs text-blue-100">
                {isEditMode
                  ? sp({ technical: 'Validate or update your developer identity', analysts: 'Check or change your name', support: 'Check or change your name' })
                  : sp({ technical: 'Confirm your name to provision your developer and key', analysts: 'Confirm your name to start analysing', support: 'Confirm your name to start drafting replies' })}
              </p>
            </div>
          </div>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/15 transition cursor-pointer"
              title={sp({ technical: 'Close', analysts: 'Close', support: 'Close' })}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Form Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="text-xs text-slate-600 leading-relaxed">
            {isEditMode ? (
              sp<React.ReactNode>({
                technical: (
                  <span>
                    Update the <strong>First Name</strong> and <strong>Last Name</strong> on the Apigee developer for{' '}
                    <code className="font-mono font-semibold text-blue-600">{email}</code>. Your API key and quotas are unchanged.
                  </span>
                ),
                analysts: (
                  <span>
                    Update the name we have for{' '}
                    <code className="font-mono font-semibold text-blue-600">{email}</code>. Your access and saved work stay as they are.
                  </span>
                ),
                support: (
                  <span>
                    Update the name we have for{' '}
                    <code className="font-mono font-semibold text-blue-600">{email}</code>. Your assistant keeps working as before.
                  </span>
                ),
              })
            ) : (
              sp<React.ReactNode>({
                technical: (
                  <span>
                    Welcome! No Apigee developer exists for{' '}
                    <code className="font-mono font-semibold text-blue-600">{email}</code> yet. Confirm your name and we will create
                    the developer, an app and one API key for every gateway endpoint.
                  </span>
                ),
                analysts: (
                  <span>
                    Welcome! There is no profile for{' '}
                    <code className="font-mono font-semibold text-blue-600">{email}</code> yet. Confirm your name and we will set up
                    access to the AI models for your research, with confidential data screened on every question.
                  </span>
                ),
                support: (
                  <span>
                    Welcome! There is no profile for{' '}
                    <code className="font-mono font-semibold text-blue-600">{email}</code> yet. Confirm your name and we will set up
                    your AI assistant for fast, safe customer replies.
                  </span>
                ),
              })
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Email Read-only Field */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              {sp({ technical: 'Authenticated Email (SSO Identity)', analysts: 'Signed-in email', support: 'Signed-in email' })}
            </label>
            <input
              type="email"
              value={email}
              disabled
              className="w-full px-3 py-2 rounded-xl bg-slate-100 border border-slate-200 text-slate-600 font-mono text-xs cursor-not-allowed"
            />
          </div>

          {/* First & Last Name Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 mb-1">
                {sp({ technical: 'First Name', analysts: 'First name', support: 'First name' })} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="e.g. Ankit"
                required
                autoFocus
                disabled={submitting}
                className="w-full px-3 py-2 rounded-xl bg-white border border-slate-300 text-slate-900 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 mb-1">
                {sp({ technical: 'Last Name', analysts: 'Last name', support: 'Last name' })}
              </label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="e.g. Goel"
                disabled={submitting}
                className="w-full px-3 py-2 rounded-xl bg-white border border-slate-300 text-slate-900 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Provisioning Preview Box */}
          {!isEditMode && (
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 space-y-2 text-xs">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                {sp({ technical: 'Automatic Provisioning Summary', analysts: 'What you get', support: 'What you get' })}
              </div>
              <div className="flex items-center justify-between text-slate-700">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  {sp({ technical: 'Developer Identity:', analysts: 'Name:', support: 'Name:' })}
                </span>
                <span className="font-semibold text-slate-900">{previewFullName}</span>
              </div>
              <div className="flex items-center justify-between text-slate-700">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-purple-500" />
                  {sp({ technical: 'Product Subscription:', analysts: 'Starting access:', support: 'Starting access:' })}
                </span>
                <span className="font-semibold text-purple-700">Engineering &amp; IT</span>
              </div>
              <div className="flex items-center justify-between text-slate-700">
                <span className="flex items-center gap-1.5">
                  <Coins className="w-3.5 h-3.5 text-amber-500" />
                  {sp({ technical: 'Prepaid Wallet Credit:', analysts: 'Credit for analyses:', support: 'Credit for replies:' })}
                </span>
                <span className="font-mono font-bold text-emerald-600">$20.00 USD</span>
              </div>
              <div className="flex items-center justify-between text-slate-700">
                <span className="flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-blue-500" />
                  {sp({ technical: 'Unified App Key:', analysts: 'Access key:', support: 'Access key:' })}
                </span>
                <span className="font-mono text-[11px] text-slate-600">{sp({ technical: 'Auto-Provisioned', analysts: 'Created for you', support: 'Created for you' })}</span>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2 pt-2">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                disabled={submitting}
                className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-semibold transition cursor-pointer disabled:opacity-50"
              >
                {sp({ technical: 'Cancel', analysts: 'Cancel', support: 'Cancel' })}
              </button>
            )}
            <button
              type="submit"
              disabled={submitting || !firstName.trim()}
              className="flex items-center justify-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-xs font-bold shadow-md hover:shadow-lg transition cursor-pointer disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{isEditMode
                      ? sp({ technical: 'Saving Profile...', analysts: 'Saving...', support: 'Saving...' })
                      : sp({ technical: 'Creating Developer & Key...', analysts: 'Setting up your access...', support: 'Setting up your assistant...' })}</span>
                </>
              ) : (
                <>
                  <UserCheck className="w-4 h-4" />
                  <span>{isEditMode
                      ? sp({ technical: 'Save Developer Name', analysts: 'Save name', support: 'Save name' })
                      : sp({ technical: 'Confirm & Create Developer', analysts: 'Confirm & get access', support: 'Confirm & get started' })}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
