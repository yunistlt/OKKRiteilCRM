import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export async function GET() {
  // Получить статистику по вопросам, претензиям, замечаниям
  const { data: stats, error: statsError } = await supabase
    .from('knowledge_base_qa')
    .select('type, count:type')
    .group('type');
  const { count: total, error: totalError } = await supabase
    .from('knowledge_base_qa')
    .select('*', { count: 'exact', head: true });
  if (statsError || totalError) {
    return NextResponse.json({ error: statsError?.message || totalError?.message }, { status: 500 });
  }
  return NextResponse.json({
    stats: stats || [],
    total: total || 0,
  });
}
