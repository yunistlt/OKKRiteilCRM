import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Browser-safe client using anon key (NEXT_PUBLIC_)
// Used for Realtime subscriptions on the client side
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lywtzgntmibdpgoijbty.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

let browserClient: SupabaseClient | null = null;

export function getSupabaseBrowser(): SupabaseClient | null {
    if (!supabaseAnonKey) {
        return null;
    }

    if (!browserClient) {
        browserClient = createClient(supabaseUrl, supabaseAnonKey, {
            realtime: {
                params: {
                    eventsPerSecond: 10
                }
            }
        });
    }

    return browserClient;
}

export const supabaseBrowser = {
    channel: (...args: Parameters<SupabaseClient['channel']>) => {
        const client = getSupabaseBrowser();
        if (!client) return null;
        return client.channel(...args);
    },
    removeChannel: (channel: ReturnType<SupabaseClient['channel']> | null | undefined) => {
        const client = getSupabaseBrowser();
        if (!client || !channel) return null;
        return client.removeChannel(channel);
    },
    isConfigured: Boolean(supabaseAnonKey),
};
