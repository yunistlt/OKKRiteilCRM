// api/okk-check-orders.js
import { createClient } from '@supabase/supabase-js';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('No SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const STOP_COMMENTS = [
  '-',
  'ок',
  'ок.',
  'ok',
  '.',
  '...',
  'жду',
  'звонок',
  'созвон',
  'перезвон',
  'перезвонить',
];

function isBadComment(comment) {
  if (!comment) return true;
  const t = comment.trim();
  if (!t) return true;
  if (t.length < 15) return true;
  if (STOP_COMMENTS.includes(t.toLowerCase())) return true;
  return false;
}

function isStatusField(fieldName) {
  if (!fieldName) return false;
  const f = fieldName.toLowerCase();
  return (
    f === 'status' ||
    f === 'status_code' ||
    f === 'order_status' ||
    f === 'statusid' ||
    f === 'statuscode'
  );
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'POST, GET');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    // пока берём последние 90 дней истории
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 90);

    const { data: history, error: historyError } = await supabase
      .from('okk_order_history')
      .select(
        'id, order_id, retailcrm_order_id, changed_at, changer_retailcrm_user_id, changer_id, field_name, comment'
      )
      .gte('changed_at', fromDate.toISOString());

    if (historyError) throw historyError;

    if (!history || !history.length) {
      return res.status(200).json({
        success: true,
        checked: 0,
        inserted: 0,
        note: 'Нет записей истории за период, нарушений не найдено',
      });
    }

    const violationsToInsert = [];

    for (const h of history) {
      if (!isStatusField(h.field_name)) continue;

      if (isBadComment(h.comment)) {
        violationsToInsert.push({
          order_id: h.order_id,
          manager_id: h.changer_id || null,
          violation_type: 'NO_COMMENT_ON_STATUS_CHANGE',
          severity: 1,
          detected_at: new Date().toISOString(),
          details: {
            history_id: h.id,
            retailcrm_order_id: h.retailcrm_order_id,
            changer_retailcrm_user_id: h.changer_retailcrm_user_id,
            changed_at: h.changed_at,
            comment: h.comment,
          },
        });
      }
    }

    // очищаем старые нарушения этого типа, чтобы не плодить дубли
    const { error: deleteError } = await supabase
      .from('okk_violations')
      .delete()
      .eq('violation_type', 'NO_COMMENT_ON_STATUS_CHANGE');

    if (deleteError) throw deleteError;

    let insertedCount = 0;

    if (violationsToInsert.length) {
      const { error: insertError } = await supabase
        .from('okk_violations')
        .insert(violationsToInsert);

      if (insertError) throw insertError;

      insertedCount = violationsToInsert.length;
    }

    return res.status(200).json({
      success: true,
      checked: history.length,
      inserted: insertedCount,
    });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ success: false, error: String(err.message || err) });
  }
}
