// api/okk-check-orders.js
import { createClient } from '@supabase/supabase-js';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// --- вспомогательная функция ---
async function logViolation(orderId, managerId, code, details) {
  await supabase
    .from('okk_violations')
    .insert({
      order_id: orderId,
      manager_id: managerId || null,
      violation_code: code,
      details,
      created_at: new Date().toISOString(),
    });
}

export default async function handler(req, res) {
  try {
    // 1. Грузим все заказы
    const { data: orders } = await supabase
      .from('okk_orders')
      .select('*');

    if (!orders || orders.length === 0) {
      return res.status(200).json({ ok: true, msg: 'Нет заказов для проверки' });
    }

    // 2. Грузим историю статусов всех заказов
    const { data: histories } = await supabase
      .from('okk_order_history')
      .select('*');

    // Группируем историю по заказам
    const historyByOrder = {};
    histories.forEach(h => {
      if (!historyByOrder[h.order_id]) historyByOrder[h.order_id] = [];
      historyByOrder[h.order_id].push(h);
    });

    let violationsCount = 0;

    // 3. Прогоняем каждый заказ через правила
    for (const order of orders) {
      const orderHistory = historyByOrder[order.id] || [];
      const managerId = order.manager_id || null;

      // --- RULE 1 ---
      // Проверка комментариев на переходах
      for (const h of orderHistory) {
        if (h.action_type === 'status_change') {
          const hasComment = h.comment && h.comment.trim().length >= 15;
          const notStop = !['-', 'ок', '.', '...', 'жду', 'звонок'].includes(
            (h.comment || '').toLowerCase().trim()
          );

          if (!hasComment || !notStop) {
            await logViolation(
              order.id,
              managerId,
              'NO_COMMENT_ON_STATUS_CHANGE',
              `Нет валидного комментария при переходе ${h.from_status} → ${h.to_status}`
            );
            violationsCount++;
          }
        }
      }

      // --- RULE 2 ---
      // Переход Новый → Квалифицирован (FAKE_QUALIFICATION)
      const qualChange = orderHistory.find(
        h =>
          h.from_status === 'Новый' &&
          h.to_status === 'Заявка квалифицирована'
      );

      if (qualChange) {
        const comment = qualChange.comment || '';
        const isRealContact =
          comment.toLowerCase().includes('разговор') ||
          comment.toLowerCase().includes('созвон') ||
          comment.toLowerCase().includes('контакт') ||
          comment.toLowerCase().length > 20;

        if (!isRealContact) {
          await logViolation(
            order.id,
            managerId,
            'FAKE_QUALIFICATION',
            'Квалификация без реального контакта'
          );
          violationsCount++;
        }
      }

      // --- RULE 3 ---
      // Незаконная отмена из Нового
      const cancelHistory = orderHistory.find(h => h.to_status?.includes('отмена'));

      if (cancelHistory && cancelHistory.from_status === 'Новый') {
        const conditions = {
          enoughCalls: order.calls_made >= 5,
          enoughEmails: order.emails_sent >= 2,
          enoughDays: order.days_in_status >= 3,
          hasComment: cancelHistory.comment && cancelHistory.comment.trim().length >= 10,
        };

        const legal =
          conditions.enoughCalls &&
          conditions.enoughEmails &&
          conditions.enoughDays &&
          conditions.hasComment;

        if (!legal) {
          await logViolation(
            order.id,
            managerId,
            'ILLEGAL_CANCEL_FROM_NEW',
            'Отмена из статуса Новый без выполнения условий'
          );
          violationsCount++;
        }
      }
    }

    return res.status(200).json({
      ok: true,
      violations: violationsCount,
    });
  } catch (e) {
    console.error('OKK CHECK ERROR:', e);
    return res.status(500).json({ ok: false, error: e.toString() });
  }
}
