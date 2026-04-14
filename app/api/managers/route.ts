import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

// Force dynamic to ensure we always get partial updates
export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const { data, error } = await supabase
            .from('managers')
            .select('*')
            .order('last_name', { ascending: true, nullsFirst: false });

        if (error) throw error;

        const managerIds = (data || []).map((manager) => manager.id);
        const { data: users, error: usersError } = managerIds.length
            ? await supabase
                .from('users')
                .select('username, retail_crm_manager_id')
                .in('retail_crm_manager_id', managerIds)
            : { data: [], error: null };

        if (usersError) throw usersError;

        const accessByManagerId = new Map<number, { username: string | null }>();
        for (const user of users || []) {
            if (typeof user.retail_crm_manager_id === 'number') {
                accessByManagerId.set(user.retail_crm_manager_id, {
                    username: user.username || null,
                });
            }
        }

        return NextResponse.json((data || []).map((manager) => ({
            ...manager,
            has_okk_access: accessByManagerId.has(manager.id),
            okk_username: accessByManagerId.get(manager.id)?.username || null,
        })));
    } catch (e: any) {
        console.error('Error fetching managers:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
