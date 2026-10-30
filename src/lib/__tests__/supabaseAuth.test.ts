import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  signInWithEmailOtp,
  signInWithMagicLink,
  signOutOperator,
  GUEST_OPERATOR_EMAIL,
} from '../supabaseAuth';
import { getReconciliationOperatorEmail, PersistedReconciliation } from '../services/auditService';
import * as clientModule from '../supabase/client';

describe('supabaseAuth Magic Link helpers & operator identity attribution', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns offline warning gracefully when Supabase client is null', async () => {
    vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue(null);

    const res = await signInWithEmailOtp('operator@clearmatch.io');
    expect(res.success).toBe(false);
    expect(res.isOffline).toBe(true);
    expect(res.error).toContain('.env.local');
  });

  it('calls supabase.auth.signInWithOtp with normalized email and emailRedirectTo for Magic Link', async () => {
    const mockSignInWithOtp = vi.fn().mockResolvedValue({ data: {}, error: null });
    vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
      auth: { signInWithOtp: mockSignInWithOtp },
    } as unknown as ReturnType<typeof clientModule.getSupabaseClient>);

    const res = await signInWithMagicLink('  AP.Operator@ClearMatch.io ');
    expect(res.success).toBe(true);
    expect(mockSignInWithOtp).toHaveBeenCalledWith({
      email: 'ap.operator@clearmatch.io',
      options: {
        emailRedirectTo: 'http://localhost:3000',
      },
    });
  });

  it('flags rate-limited errors from Supabase Auth', async () => {
    const mockSignInWithOtp = vi.fn().mockResolvedValue({
      data: null,
      error: {
        message: 'For security purposes, you can only request this after 60 seconds.',
        status: 429,
      },
    });
    vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
      auth: { signInWithOtp: mockSignInWithOtp },
    } as unknown as ReturnType<typeof clientModule.getSupabaseClient>);

    const res = await signInWithEmailOtp('ap.operator@clearmatch.io');
    expect(res.success).toBe(false);
    expect(res.isRateLimited).toBe(true);
  });

  it('signs out operator session cleanly', async () => {
    const mockSignOut = vi.fn().mockResolvedValue({ error: null });
    vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
      auth: { signOut: mockSignOut },
    } as unknown as ReturnType<typeof clientModule.getSupabaseClient>);

    const res = await signOutOperator();
    expect(res.success).toBe(true);
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('extracts operator_email from PersistedReconciliation or falls back to guest sandbox email', () => {
    const recWithAuthEmail = {
      engine_ledger: {
        operator_email: 'controller@vertex.io',
      },
    } as unknown as PersistedReconciliation;
    expect(getReconciliationOperatorEmail(recWithAuthEmail)).toBe('controller@vertex.io');

    const recWithoutEmail = {
      engine_ledger: {},
    } as unknown as PersistedReconciliation;
    expect(getReconciliationOperatorEmail(recWithoutEmail)).toBe(GUEST_OPERATOR_EMAIL);
  });
});
