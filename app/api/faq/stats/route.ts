import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // 1. Fetch all QA items to calculate stats by type
    const { data: qaItems, error: statsError } = await supabase
      .from('knowledge_base_qa')
      .select('type');

    if (statsError) throw statsError;

    // 2. Group and count in JS
    const statsMap: Record<string, number> = {};
    (qaItems || []).forEach((item: { type: string | null }) => {
      const t = item.type || 'unknown';
      statsMap[t] = (statsMap[t] || 0) + 1;
    });

    const stats = Object.entries(statsMap).map(([type, count]) => ({ type, count }));

    // 3. Get total count
    const { count: total, error: totalError } = await supabase
      .from('knowledge_base_qa')
      .select('*', { count: 'exact', head: true });

    if (totalError) throw totalError;

    return NextResponse.json({
      stats: stats,
      total: total || 0,
    });
  } catch (e: any) {
    console.error('[FAQ Stats API] Error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
