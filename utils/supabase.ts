import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lywtzgntmibdpgoijbty.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

let cachedClient: any = null;

export function getSupabase() {
    if (!cachedClient) {
        if (!supabaseKey) {
            throw new Error('Supabase Key is missing! Check your .env.local file.');
        }
        cachedClient = createClient(supabaseUrl, supabaseKey);
    }

    return cachedClient;
}

export const supabase = new Proxy({} as ReturnType<typeof createClient>, {
    get(_target, prop, receiver) {
        const client = getSupabase();
        const value = Reflect.get(client as object, prop, receiver);
        return typeof value === 'function' ? value.bind(client) : value;
    },
}) as any;
