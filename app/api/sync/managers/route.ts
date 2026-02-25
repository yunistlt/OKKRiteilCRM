import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

const RETAILCRM_URL = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL;
const RETAILCRM_KEY = process.env.RETAILCRM_API_KEY;

export const maxDuration = 300;

export async function GET() {
    if (!RETAILCRM_URL || !RETAILCRM_KEY) {
        return NextResponse.json({ error: 'RetailCRM config missing' }, { status: 500 });
    }

    try {
        // Fetch users from RetailCRM
        const url = `${RETAILCRM_URL}/api/v5/users?apiKey=${RETAILCRM_KEY}&limit=100`;
        const res = await fetch(url);

        if (!res.ok) throw new Error(`RetailCRM Users error: ${res.status}`);

        const data = await res.json();
        if (!data.success) throw new Error('RetailCRM API returned success: false');

        const users = data.users || [];

        // Fetch existing nicknames to preserve them
        const { data: existingManagers } = await supabase
            .from('managers')
            .select('id, raw_data');

        const nicknameMap = new Map();
        existingManagers?.forEach(em => {
            if (em.raw_data?.telegram_username) {
                nicknameMap.set(em.id, em.raw_data.telegram_username);
            }
        });

        const upsertData = users.map((u: any) => {
            const existingNick = nicknameMap.get(u.id);
            return {
                id: u.id,
                first_name: u.firstName,
                last_name: u.lastName,
                email: u.email,
                active: u.active,
                raw_data: existingNick ? { ...u, telegram_username: existingNick } : u
            };
        });

        if (upsertData.length > 0) {
            const { error } = await supabase.rpc('upsert_managers_v2', {
                managers_data: upsertData
            });

            if (error) {
                console.error('RPC Error:', error);
                throw error;
            }
        }

        return NextResponse.json({
            success: true,
            count: upsertData.length,
            message: 'Managers synced. Please manually map telphin_extension if not automatic.'
        });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
