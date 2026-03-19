import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getSession, login } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/profile
 * Returns current user profile details
 */
export async function GET() {
    try {
        const session = await getSession();
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data: user, error } = await supabase
            .from('users')
            .select('id, username, role, retail_crm_manager_id, first_name, last_name, avatar_url')
            .eq('id', session.user.id)
            .single();

        if (error || !user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        return NextResponse.json({ user });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

/**
 * PATCH /api/auth/profile
 * Updates username, password, first_name, last_name, avatar_url
 */
export async function PATCH(req: Request) {
    try {
        const session = await getSession();
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { username, password, first_name, last_name, avatar_url } = body;

        const updates: Record<string, any> = {};
        if (username) updates.username = username;
        if (first_name !== undefined) updates.first_name = first_name;
        if (last_name !== undefined) updates.last_name = last_name;
        if (avatar_url !== undefined) updates.avatar_url = avatar_url;
        if (password) updates.password_hash = password; // plain text per auth.ts convention

        if (Object.keys(updates).length === 0) {
            return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
        }

        const { data: updated, error } = await supabase
            .from('users')
            .update(updates)
            .eq('id', session.user.id)
            .select('id, username, role, retail_crm_manager_id, first_name, last_name, avatar_url')
            .single();

        if (error) throw error;

        // Refresh session cookie so username/name changes reflect immediately
        await login({
            id: updated.id,
            username: updated.username,
            role: updated.role,
            retail_crm_manager_id: updated.retail_crm_manager_id,
        });

        return NextResponse.json({ user: updated });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
