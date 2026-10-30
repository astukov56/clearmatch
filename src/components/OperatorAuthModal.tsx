'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  OperatorSessionUser,
  signInWithEmailOtp,
  GUEST_OPERATOR_EMAIL,
} from '../lib/supabaseAuth';

interface OperatorAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: OperatorSessionUser | null;
  onSignOut: () => Promise<void>;
}

export default function OperatorAuthModal({
  isOpen,
  onClose,
  user,
  onSignOut,
}: OperatorAuthModalProps) {
  const [step, setStep] = useState<'email' | 'dispatched'>('email');
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorState, setErrorState] = useState<{
    message: string;
    isRateLimited?: boolean;
    isOffline?: boolean;
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setErrorState(null);
      if (user) {
        setStep('email');
      }
    }
  }, [isOpen, user]);

  const handleRequestMagicLink = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!email.trim() || isSubmitting) return;

      setIsSubmitting(true);
      setErrorState(null);

      try {
        const result = await signInWithEmailOtp(email);
        if (!result.success) {
          setErrorState({
            message: result.error || 'Failed to dispatch Magic Link.',
            isRateLimited: result.isRateLimited,
            isOffline: result.isOffline,
          });
          return;
        }

        setStep('dispatched');
      } finally {
        setIsSubmitting(false);
      }
    },
    [email, isSubmitting]
  );

  const handleSignOutClick = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await onSignOut();
      setStep('email');
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  }, [onSignOut, onClose]);

  if (!isOpen) return null;

  const normalizedEmail = email.trim().toLowerCase();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="operator-auth-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-900/60 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="bg-white border border-neutral-300 rounded-lg shadow-xl max-w-md w-full overflow-hidden font-mono"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between bg-neutral-950 text-white px-5 py-3.5 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <span className="bg-emerald-400 text-neutral-950 font-bold px-2 py-0.5 rounded text-[10px] uppercase">
              MAGIC LINK AUTH
            </span>
            <h3
              id="operator-auth-modal-title"
              className="text-xs font-bold uppercase tracking-wider"
            >
              Operator Identity &amp; Audit Attribution
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-white text-xs px-2 py-0.5 rounded border border-neutral-800 hover:border-neutral-600 cursor-pointer"
          >
            [ESC]
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 text-xs">
          {user ? (
            /* Authenticated Operator Session View */
            <div className="space-y-4">
              <div className="bg-emerald-50 border border-emerald-300 rounded-md p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                    🟢 Authenticated Operator Session
                  </span>
                  <span className="text-[10px] bg-emerald-200/70 text-emerald-900 px-1.5 py-0.5 rounded font-bold">
                    VERIFIED
                  </span>
                </div>
                <div className="text-sm font-bold text-neutral-900 break-all">
                  {user.email}
                </div>
                <div className="text-[11px] text-neutral-600">
                  Operator UUID: <span className="text-neutral-800">{user.id}</span>
                </div>
              </div>

              <div className="bg-neutral-50 border border-neutral-200 rounded p-3 text-[11px] text-neutral-600 font-sans leading-relaxed">
                All reconciliation runs, dispute notices, and human overrides executed in this session are permanently attributed to{' '}
                <strong className="font-mono text-neutral-900">{user.email}</strong> in{' '}
                <code className="font-mono text-[10px]">public.reconciliations</code> and{' '}
                <code className="font-mono text-[10px]">public.audit_resolution_events</code>.
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 rounded border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-700 text-xs cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={handleSignOutClick}
                  disabled={isSubmitting}
                  className="px-3.5 py-1.5 rounded bg-rose-700 hover:bg-rose-800 text-white font-semibold text-xs cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Signing Out...' : '[ Sign Out ]'}
                </button>
              </div>
            </div>
          ) : step === 'dispatched' ? (
            /* State 2: Link Dispatched Confirmation */
            <div className="space-y-4">
              <div className="bg-emerald-50 border-2 border-emerald-400 rounded-md p-4 space-y-2 text-emerald-950">
                <div className="flex items-center gap-2">
                  <span className="text-base">✉️</span>
                  <h4 className="font-mono text-sm font-bold uppercase tracking-wide text-emerald-900">
                    Magic Link Dispatched
                  </h4>
                </div>
                <p className="text-xs font-sans text-neutral-800 leading-relaxed">
                  We sent a one-click sign-in link to{' '}
                  <strong className="font-mono text-neutral-950 underline">
                    {normalizedEmail}
                  </strong>
                  . Click the link in your email to authenticate this workbench session.
                </p>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setStep('email');
                    setErrorState(null);
                  }}
                  className="px-3 py-1.5 rounded border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-800 font-semibold text-xs cursor-pointer"
                >
                  [ Use a Different Email ]
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-1.5 rounded bg-neutral-900 hover:bg-neutral-800 text-white font-semibold text-xs cursor-pointer"
                >
                  [ Close ]
                </button>
              </div>
            </div>
          ) : (
            /* State 1: Email Entry */
            <div className="space-y-4">
              {errorState && (
                <div
                  className={`rounded-md p-3 border text-[11px] leading-relaxed ${
                    errorState.isRateLimited || errorState.isOffline
                      ? 'bg-amber-50 border-amber-300 text-amber-900'
                      : 'bg-rose-50 border-rose-300 text-rose-900'
                  }`}
                >
                  <div className="font-bold uppercase text-[10px] mb-0.5">
                    {errorState.isOffline
                      ? '⚠️ Offline / Missing Environment Keys'
                      : errorState.isRateLimited
                      ? '⏱️ Supabase Rate Limit Guard'
                      : '⚠️ Authentication Notice'}
                  </div>
                  <div>{errorState.message}</div>
                </div>
              )}

              <form onSubmit={handleRequestMagicLink} className="space-y-3.5">
                <div>
                  <label
                    htmlFor="operator-auth-email-input"
                    className="block text-[11px] font-bold uppercase text-neutral-700 mb-1"
                  >
                    Accounts Payable Work Email:
                  </label>
                  <input
                    id="operator-auth-email-input"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="ap.operator@company.com"
                    required
                    autoFocus
                    className="w-full px-3 py-2 text-xs bg-white border border-neutral-300 rounded focus:outline-hidden focus:ring-1 focus:ring-neutral-900 focus:border-neutral-900"
                  />
                </div>

                <p className="text-[11px] text-neutral-600 font-sans leading-relaxed">
                  Enter your work email to receive a passwordless Supabase Magic Link. Once clicked, all reconciliations, dispute memos, and audit overrides will be bound to your verified identity.
                </p>

                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-3 py-1.5 rounded border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-700 text-xs cursor-pointer"
                  >
                    Continue in Sandbox
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || !email.trim()}
                    className="px-4 py-2 rounded bg-neutral-900 hover:bg-neutral-800 text-white font-bold text-xs cursor-pointer shadow-xs disabled:opacity-50"
                  >
                    {isSubmitting ? 'Dispatching Link...' : '[ ✉️ Send Magic Link ]'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-neutral-50 border-t border-neutral-200 px-5 py-2.5 flex items-center justify-between text-[10px] text-neutral-500">
          <span>
            Unauthenticated Fallback: <code>{GUEST_OPERATOR_EMAIL}</code>
          </span>
          <span>Passwordless Magic Link</span>
        </div>
      </div>
    </div>
  );
}
