import { createClient, SupabaseClient } from '@supabase/supabase-js';

let clientInstance: SupabaseClient | null = null;
let warningLogged = false;

/**
 * Returns a singleton instance of the Supabase browser client.
 * Returns null gracefully if environment keys are missing or invalid,
 * preventing local offline runs and unit tests from crashing.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (clientInstance) {
    return clientInstance;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  )?.trim();

  if (!url || !key) {
    if (!warningLogged && process.env.NODE_ENV !== 'test') {
      console.warn(
        '[ClearMatch Supabase] Missing NEXT_PUBLIC_SUPABASE_URL or API key. Running in local/offline mode.'
      );
      warningLogged = true;
    }
    return null;
  }

  try {
    const isWebSocketAvailable =
      typeof WebSocket !== 'undefined' ||
      typeof (globalThis as unknown as { WebSocket?: unknown }).WebSocket !== 'undefined';

    type ClientOptions = NonNullable<Parameters<typeof createClient>[2]>;
    type TransportType = NonNullable<NonNullable<ClientOptions['realtime']>['transport']>;

    const isBrowser =
      typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

    clientInstance = createClient(url, key, {
      auth: {
        persistSession: isBrowser,
        autoRefreshToken: isBrowser,
        detectSessionInUrl: isBrowser,
      },
      ...(!isWebSocketAvailable
        ? {
            realtime: {
              transport: class NodeDummyWebSocket {} as unknown as TransportType,
            },
          }
        : {}),
    });
    return clientInstance;
  } catch (error) {
    if (!warningLogged && process.env.NODE_ENV !== 'test') {
      console.warn(
        '[ClearMatch Supabase] Diagnostic Warning: Failed to initialize Supabase client:',
        error
      );
      warningLogged = true;
    }
    return null;
  }
}

/**
 * Convenience reset helper for unit testing.
 */
export function resetSupabaseClientForTesting(): void {
  clientInstance = null;
  warningLogged = false;
}

export const supabase: SupabaseClient | null = getSupabaseClient();
