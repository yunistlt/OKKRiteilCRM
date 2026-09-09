import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const limit = parseInt(req.nextUrl.searchParams.get('limit') || '20');
    const offset = parseInt(req.nextUrl.searchParams.get('offset') || '0');

    // Получаем входящие звонки
    const incomingPromise = supabase
      .from('incoming_calls')
      .select('id, from_number, duration_seconds, status, created_at')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Получаем исходящие звонки
    const outgoingPromise = supabase
      .from('outgoing_calls')
      .select('id, phone_number, duration_seconds, status, created_at')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const [incomingResult, outgoingResult] = await Promise.all([
      incomingPromise,
      outgoingPromise,
    ]);

    if (incomingResult.error) throw incomingResult.error;
    if (outgoingResult.error) throw outgoingResult.error;

    // Объединяем и сортируем по времени
    const allCalls = [
      ...(incomingResult.data || []).map((call: any) => ({
        id: call.id,
        direction: 'incoming' as const,
        contactPhone: call.from_number,
        duration: call.duration_seconds,
        status: call.status,
        createdAt: call.created_at,
      })),
      ...(outgoingResult.data || []).map((call: any) => ({
        id: call.id,
        direction: 'outgoing' as const,
        contactPhone: call.phone_number,
        duration: call.duration_seconds,
        status: call.status,
        createdAt: call.created_at,
      })),
    ].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return NextResponse.json({
      success: true,
      calls: allCalls.slice(0, limit),
      total: allCalls.length,
    });
  } catch (error) {
    console.error('Failed to fetch call history:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch history' },
      { status: 500 }
    );
  }
}
