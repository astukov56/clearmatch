import { useState, useEffect, useCallback } from 'react';
import { getSupabaseClient } from './supabase/client';

export interface OperatorSessionUser {
  id: string;
  email: string;
}

export interface AuthActionResult {
  success: boolean;
  user?: OperatorSessionUser | null;
  error?: string;
  isRateLimited?: boolean;
  isOffline?: boolean;
}

export const GUEST_OPERATOR_EMAIL = 'guest-sandbox@clearmatch.local';

function mapSessionUser(
  rawUser: { id?: string; email?: string | null } | null | undefined,
  fallbackEmail?: string
): OperatorSessionUser | null {
  if (!rawUser || !rawUser.id) {
    return null;
  }
  const email = (rawUser.email || fallbackEmail || '').trim();
  if (!email) {
    return null;
  }
  return {
    id: rawUser.id,
    email,
  };
}

function classifyAuthError(error: { message?: string; status?: number }): {
  message: string;
  isRateLimited: boolean;
} {
  const rawMessage = error.message || 'Authentication request failed.';
  const lower = rawMessage.toLowerCase();
  const isRateLimited =
    error.status === 429 ||
    lower.includes('rate limit') ||
    lower.includes('security purposes') ||
    lower.includes('too many requests');

  if (isRateLimited) {
    return {
      message:
        'Supabase Auth rate limit reached. Please wait 60 seconds before requesting another Magic Link, or click the sign-in link already sent to your inbox.',
      isRateLimited: true,
    };
  }

  return {
    message: rawMessage,
    isRateLimited: false,
  };
}

/**
 * Initiates passwordless email sign-in exclusively via Supabase Magic Link (`signInWithOtp` + `emailRedirectTo`).
 */
export async function signInWithEmailOtp(email: string): Promise<AuthActionResult> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    return {
      success: false,
      error: 'Please enter a valid work email address.',
    };
  }

  const client = getSupabaseClient();
  if (!client) {
    return {
      success: false,
      isOffline: true,
      error:
        'Supabase environment keys (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY) are missing in .env.local. Running in Guest Sandbox mode.',
    };
  }

  try {
    const redirectOrigin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'http://localhost:3000';

    const { error } = await client.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        emailRedirectTo: redirectOrigin,
      },
    });

    if (error) {
      const classified = classifyAuthError(error);
      return {
        success: false,
        error: classified.message,
        isRateLimited: classified.isRateLimited,
      };
    }

    return {
      success: true,
    };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : 'Unexpected network error while requesting Magic Link.',
    };
  }
}

export const signInWithMagicLink = signInWithEmailOtp;

/**
 * Signs out the currently authenticated operator and reverts to Guest Sandbox mode.
 */
export async function signOutOperator(): Promise<AuthActionResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: true, user: null };
  }

  try {
    const { error } = await client.auth.signOut();
    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }
    return {
      success: true,
      user: null,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to sign out operator.',
    };
  }
}

/**
 * Subscribes to Supabase auth state changes and hydrates initial session.
 */
export function subscribeToOperatorAuth(
  onUserChange: (user: OperatorSessionUser | null) => void
): () => void {
  const client = getSupabaseClient();
  if (!client || !client.auth) {
    onUserChange(null);
    return () => {};
  }

  let isMounted = true;

  client.auth
    .getSession()
    .then(({ data }) => {
      if (!isMounted) return;
      const user = mapSessionUser(data?.session?.user);
      onUserChange(user);
    })
    .catch(() => {
      if (isMounted) onUserChange(null);
    });

  const { data: subscriptionData } = client.auth.onAuthStateChange((_event, session) => {
    if (!isMounted) return;
    const user = mapSessionUser(session?.user);
    onUserChange(user);
  });

  return () => {
    isMounted = false;
    subscriptionData?.subscription?.unsubscribe();
  };
}

/**
 * React hook tracking the active authenticated operator session (`id` and `email`).
 */
export function useOperatorSession() {
  const [user, setUser] = useState<OperatorSessionUser | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToOperatorAuth((nextUser) => {
      setUser(nextUser);
    });
    return unsubscribe;
  }, []);

  const handleSignOut = useCallback(async () => {
    const res = await signOutOperator();
    if (res.success) {
      setUser(null);
    }
    return res;
  }, []);

  return {
    user,
    setUser,
    signOut: handleSignOut,
    operatorEmail: user?.email ?? GUEST_OPERATOR_EMAIL,
    isAuthenticated: Boolean(user?.email),
  };
}
