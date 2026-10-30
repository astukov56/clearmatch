import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getSupabaseClient, resetSupabaseClientForTesting } from './client';

describe('Supabase Browser Client', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    resetSupabaseClientForTesting();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    resetSupabaseClientForTesting();
    process.env = originalEnv;
  });

  it('returns null gracefully when NEXT_PUBLIC_SUPABASE_URL is missing', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-key';

    const client = getSupabaseClient();
    expect(client).toBeNull();
  });

  it('returns null gracefully when neither ANON_KEY nor PUBLISHABLE_KEY is present', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    const client = getSupabaseClient();
    expect(client).toBeNull();
  });

  it('initializes and returns singleton client when valid URL and PUBLISHABLE_KEY are present', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';

    const client1 = getSupabaseClient();
    expect(client1).not.toBeNull();

    const client2 = getSupabaseClient();
    expect(client1).toBe(client2);
  });

  it('initializes using NEXT_PUBLIC_SUPABASE_ANON_KEY fallback', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

    const client = getSupabaseClient();
    expect(client).not.toBeNull();
  });
});
