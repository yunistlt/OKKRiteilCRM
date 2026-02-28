import { supabase } from '@/utils/supabase';
import { matchCallToOrder } from '@/lib/call-matching';
import { sendTelegramNotification } from '@/lib/telegram';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();

    const {
      call_id,
      from_number,
      to_number,
      timestamp,
      status,
    } = payload;

    // Нормализуем номер телефона
    const normalizedNumber = from_number.replace(/\D/g, '');

    // Ищем совпадающий заказ
    const matchedOrder = await matchCallToOrder(normalizedNumber, new Date(timestamp));

    // Назначаем менеджера (если найден заказ)
    let assignedManagerId = null;
    if (matchedOrder) {
      assignedManagerId = matchedOrder.manager_id;
    }

    // Логируем входящий звонок
    const { data: incomingCall, error } = await supabase
      .from('incoming_calls')
      .insert({
        call_sid: call_id,
        from_number: normalizedNumber,
        to_number: to_number,
        order_id: matchedOrder?.id || null,
        assigned_manager_id: assignedManagerId,
        status: 'ringing',
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('Failed to log incoming call:', error);
    }

    // Уведомляем менеджера в Telegram
    if (assignedManagerId) {
      await sendTelegramNotification({
        type: 'incoming_call',
        callId: call_id,
        fromNumber: normalizedNumber,
        orderId: matchedOrder?.id,
      });
    }

    return NextResponse.json({
      success: true,
      callId: call_id,
      matched: !!matchedOrder,
      orderId: matchedOrder?.id || null,
    });
  } catch (error) {
    console.error('Incoming call webhook error:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}
