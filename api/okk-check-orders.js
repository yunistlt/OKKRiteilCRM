// api/okk-check-orders.js
import { createClient } from '@supabase/supabase-js';
import { detectNoCommentViolations } from './rules/noComment.js';
import { detectIllegalCancelFromNewViolations } from './rules/illegalCancelFromNew.js';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/**
 * Общий обработчик:
 * 1) грузим историю
 * 2) прогоняем через все правила
 * 3) чистим старые нарушения этих типов
 * 4) пишем новые в okk_violations
 */
export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'POST, GET');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    // история за последние 90 дней
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 90);

  // временно убери фильтр по дате и проверь
const { data: history, error: historyError } = await supabase
  .from('okk_order_history')
  .select(`
    id,
    order_id,
    retailcrm_order_id,
    changed_at,
    changer_id,
    changer_retailcrm_user_id,
    field_name,
    comment,
    change_type,
    old_value,
    new_value
  `);

    if (historyError) {
      console.error('okk-check-orders: historyError', historyError);
      throw historyError;
    }

    if (!history || !history.length) {
      return res.status(200).json({
        success: true,
        checked: 0,
        inserted: 0,
        note: 'Нет записей истории за период',
      });
    }

    const nowIso = new Date().toISOString();

    // общая конфигурация для правил
    const config = {
      nowIso,
      // КОД статуса "Новый" (подставь свой реальный из status_code)
      NEW_STATUS_CODE: 'novyy', // TODO: заменить на реальный
      // Коды всех отменных статусов (status_code)
      CANCEL_STATUS_CODES: [
        // TODO: сюда подставишь свои коды отмен, сейчас правило работать не будет
        // 'soglasovanie-otmeny',
        // 'ne-proshli-po-cene',
        // ...
      ],
    };

    // 1) правило "нет комментария при смене статуса"
    const noCommentViolations = detectNoCommentViolations(history, config);

    // 2) правило "незаконная отмена из Нового"
    const illegalCancelViolations = detectIllegalCancelFromNewViolations(history, config);

    const allViolations = [
      ...noCommentViolations,
      ...illegalCancelViolations,
    ];

    // Если ни одно правило ничего не нашло
    if (!allViolations.length) {
      return res.status(200).json({
        success: true,
        checked: history.length,
        inserted: 0,
        note: 'Правила не нашли нарушений',
      });
    }

    // Какие типы нарушений мы сейчас пересчитываем
    const violationTypes = Array.from(
      new Set(allViolations.map((v) => v.violation_type)),
    );

    // Сначала чистим старые нарушения этих типов
    const { error: deleteError } = await supabase
      .from('okk_violations')
      .delete()
      .in('violation_type', violationTypes);

    if (deleteError) {
      console.error('okk-check-orders: deleteError', deleteError);
      throw deleteError;
    }

    // Потом вставляем новые
    const { error: insertError } = await supabase
      .from('okk_violations')
      .insert(allViolations);

    if (insertError) {
      console.error('okk-check-orders: insertError', insertError);
      throw insertError;
    }

    return res.status(200).json({
      success: true,
      checked: history.length,
      inserted: allViolations.length,
      types: violationTypes,
    });
  } catch (err) {
    console.error('okk-check-orders: fatal', err);
    return res
      .status(500)
      .json({ success: false, error: String(err.message || err) });
  }
}
