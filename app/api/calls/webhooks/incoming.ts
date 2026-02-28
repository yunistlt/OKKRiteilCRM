import { supabase } from '@/utils/supabase';
import { matchCallToOrders, RawCall } from '@/lib/call-matching';
import { sendTelegramNotification } from '@/lib/telegram';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();

    const { call_id, from_number, to_number, timestamp, status } = payload;

    // Нормализуем номер телефона
    const normalizedNumber = from_number.replace(/\D/g, '');
    const toNumberNormalized = to_number.replace(/\D/g, '');

    const rawCall: RawCall = {
      telphin_call_id: call_id,
      from_number,
      to_number,
      from_number_normalized: normalizedNumber,
      to_number_normalized: toNumberNormalized,
      started_at: new Date(timestamp).toISOString(),
      direction: 'incoming',
      raw_payload: payload,
    };

    // Ищем совпадающий заказ
    const matches = await matchCallToOrders(rawCall);
    const bestMatch = matches[0];

    // Назначаем менеджера (если найден заказ)
    let assignedManagerId: number | null = null;
    let matchedOrderId: number | null = null;

    if (bestMatch) {
      matchedOrderId = bestMatch.retailcrm_order_id;
      const { data: orderRecords } = await supabase
        .from('orders')
        .select('id, manager_id')
        .eq('id', matchedOrderId)
        .limit(1);

      const orderRecord = orderRecords?.[0];
      if (orderRecord?.manager_id) {
        assignedManagerId = orderRecord.manager_id;
      }
    }

    // Логируем входящий звонок
    const { data: incomingCall, error } = await supabase
      .from('incoming_calls')
      .insert({
        call_sid: call_id,
        from_number: normalizedNumber,
        to_number: to_number,
        order_id: matchedOrderId,
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
      const message = [
        '📞 Входящий звонок',
        `Call SID: ${call_id}`,
        `От: ${normalizedNumber}`,
        `Заказ: ${matchedOrderId ?? 'не найден'}`,
      ].join('\n');

      await sendTelegramNotification(message);
    }

    return NextResponse.json({
      success: true,
      callId: call_id,
      matched: !!matchedOrderId,
      orderId: matchedOrderId,
    });
  } catch (error) {
    console.error('Incoming call webhook error:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}
