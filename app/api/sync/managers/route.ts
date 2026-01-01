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

        const upsertData = users.map((u: any) => ({
            id: u.id, // RetailCRM ID matches DB ID
            first_name: u.firstName,
            last_name: u.lastName,
            email: u.email,
            active: u.active,
            // Try to guess extension or look for it in common fields?
            // Usually internal number is not standard. Storing raw data for inspection.
            raw_data: u
        }));

        if (upsertData.length > 0) {
            // Use RPC to bypass potential schema cache/permission issues
            const { error } = await supabase.rpc('upsert_managers', {
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
