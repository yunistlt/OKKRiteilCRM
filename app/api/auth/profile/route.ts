import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getSession, login } from '@/lib/auth';
import { enrichManagerLinkedIdentity, isManagerBoundAccount } from '@/lib/manager-identity';

export const dynamic = 'force-dynamic';

async function loadProfile(userId: string) {
    const profileResult = await supabase
        .from('profiles')
        .select('id, email, username, role, retail_crm_manager_id, first_name, last_name, avatar_url')
        .eq('id', userId)
        .maybeSingle();

    if (!profileResult.error && profileResult.data) {
        return { source: 'profiles' as const, user: await enrichManagerLinkedIdentity(profileResult.data) };
    }

    const userResult = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

    if (userResult.error || !userResult.data) {
        return null;
    }

    return { source: 'users' as const, user: await enrichManagerLinkedIdentity(userResult.data) };
}

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

        const profile = await loadProfile(session.user.id);

        if (!profile?.user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        return NextResponse.json({ user: profile.user });
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

        const profile = await loadProfile(session.user.id);
        if (!profile) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        if (isManagerBoundAccount(profile.user) && (first_name !== undefined || last_name !== undefined)) {
            return NextResponse.json(
                { error: 'Имя и фамилия менеджера синхронизируются из RetailCRM и не редактируются в ОКК' },
                { status: 400 }
            );
        }

        const { data: updated, error } = await supabase
            .from(profile.source)
            .update(updates)
            .eq('id', session.user.id)
            .select('id, email, username, role, retail_crm_manager_id, first_name, last_name, avatar_url')
            .single();

        if (error) throw error;

        const enrichedUpdated = await enrichManagerLinkedIdentity(updated);

        await login({
            id: updated.id,
            username: updated.username || updated.email,
            role: updated.role,
            retail_crm_manager_id: updated.retail_crm_manager_id,
            first_name: enrichedUpdated?.first_name || updated.first_name || null,
            last_name: enrichedUpdated?.last_name || updated.last_name || null,
            email: updated.email || null,
        });

        return NextResponse.json({ user: enrichedUpdated || updated });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
