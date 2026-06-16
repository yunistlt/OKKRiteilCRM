import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

// Реестр критериев «Контроля качества» для рендера колонок таблицы /okk.
// По умолчанию — только активные, в порядке отображения. scope=all — включая выключенные (для админки).
export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const all = searchParams.get('scope') === 'all';

        let query = supabase
            .from('okk_criteria')
            .select('key, label, category, group_color, cell_bg, type, agent, agent_emoji, eval_method, ai_prompt, params, scoring_basket, how_tip, data_tip, sort_order, is_active');
        if (!all) query = query.eq('is_active', true);

        const { data, error } = await query.order('sort_order', { ascending: true });
        if (error) throw error;
        return NextResponse.json(data || []);
    } catch (e: any) {
        console.error('[OKK Criteria API] Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
