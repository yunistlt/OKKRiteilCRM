import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';

export async function GET(req: Request) {
    const session = await getSession();
    if (!hasAnyRole(session, ['admin', 'rop'])) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const campaignId = searchParams.get('campaign_id');
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '50');

    let query = supabase
        .from('ai_outreach_logs')
        .select('*', { count: 'exact' });

    // Фильтр по кампании
    if (campaignId) {
        query = query.eq('campaign_id', campaignId);
    }

    // Фильтр по статусу (если не передан, показываем все важные для очереди)
    if (status) {
        query = query.eq('status', status);
    }

    const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) {
        console.error('[LogsAPI] Error:', error.message);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    // Возвращаем в формате, который ожидает фронтенд (data + total)
    return NextResponse.json({ 
        success: true, 
        data: data || [], 
        logs: data || [],
        total: count || 0 
    });
}
