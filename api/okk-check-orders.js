// /api/okk-check-orders.js
import { createClient } from '@supabase/supabase-js';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Простая утилита, чтобы лог не падал, а фронт получал ответ
function safeLogError(prefix, error) {
  console.error(prefix, error?.message || error);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 1. Опционально чистим старые нарушения от этого правила
    // Если в схеме нет поля source — просто закомментируй этот блок.
    try {
      const { error: delErr } = await supabase
        .from('okk_violations')
        .delete()
        .eq('source', 'RULE_CHECK_NO_COMMENT');

      if (delErr) {
        safeLogError('okk-check-orders: delete old RULE_CHECK_NO_COMMENT failed', delErr);
      }
    } catch (e) {
      safeLogError('okk-check-orders: delete block threw', e);
    }

    // 2. Берём историю с пустыми / плохими комментариями
    // ⚠️ Список полей подгони под свою фактическую схему okk_order_history
    const { data: historyRows, error: historyErr } = await supabase
      .from('okk_order_history')
      .select(
        `
        id,
        order_id,
        manager_id,
        retailcrm_order_id,
        retailcrm_order_number,
        comment,
        changed_at,
        history_id
      `,
      )
      .is('comment', null)
      .limit(2000); // пока ограничимся разумным количеством

    if (historyErr) {
      safeLogError('okk-check-orders: load history error', historyErr);
      return res.status(500).json({ error: 'Failed to load order history' });
    }

    if (!historyRows || !historyRows.length) {
      return res.status(200).json({
        success: true,
        checked: 0,
        inserted: 0,
        message: 'Подходящих записей истории без комментария не найдено',
      });
    }

    // 3. Готовим нарушения
    const violations = historyRows.map((row) => {
      const orderId =
        row.order_id ||
        row.retailcrm_order_id ||
        null;

      const managerId = row.manager_id || null;

      const humanMessage =
        'Смена статуса или перенос следующего контакта без осмысленного комментария оператора. ' +
        'Требуется комментарий в течение 5 минут после изменения.';

      return {
        order_id: orderId,
        manager_id: managerId,
        violation_code: 'NO_COMMENT_ON_STATUS_CHANGE', // для фильтров и аналитики
        type: 'NO_COMMENT_ON_STATUS_CHANGE', // на всякий случай — если на фронте читается type
        source: 'RULE_CHECK_NO_COMMENT',
        details: {
          message: humanMessage,
          comment: row.comment,
          changed_at: row.changed_at,
          history_id: row.history_id,
          retailcrm_order_id: row.retailcrm_order_id,
          retailcrm_order_number: row.retailcrm_order_number,
        },
      };
    });

    // 4. Пишем в okk_violations
    const { error: insErr } = await supabase
      .from('okk_violations')
      .insert(violations);

    if (insErr) {
      safeLogError('okk-check-orders: insert violations error', insErr);
      return res.status(500).json({ error: 'Failed to insert violations' });
    }

    return res.status(200).json({
      success: true,
      checked: historyRows.length,
      inserted: violations.length,
    });
  } catch (e) {
    safeLogError('okk-check-orders: fatal', e);
    return res.status(500).json({ error: 'Unexpected error' });
  }
}
