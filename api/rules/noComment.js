// api/rules/noComment.js

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

/**
 * Правило: NO_COMMENT_ON_STATUS_CHANGE
 * На вход: полная history (как из okk_order_history_working)
 * На выход: массив нарушений для вставки в okk_violations
 */
export function detectNoCommentViolations(history, config) {
  const nowIso = config.nowIso || new Date().toISOString();
  const violations = [];

  for (const h of history) {
    if (!isStatusField(h.field_name)) continue;

    if (isBadComment(h.comment)) {
      violations.push({
        order_id: h.order_id ?? null,
        // временно можем оставить, но основной manager_id потом проставится в окк-check-orders по changer_retailcrm_user_id
        manager_id: h.changer_id ?? null,
        violation_type: 'NO_COMMENT_ON_STATUS_CHANGE',
        severity: 1,
        detected_at: nowIso,
        details: {
          message:
            'Смена статуса или перенос следующего контакта без осмысленного комментария оператора.',
          history_id: h.id,
          retailcrm_order_id: h.retailcrm_order_id ?? null,
          changer_retailcrm_user_id: h.changer_retailcrm_user_id ?? null,
          changed_at: h.changed_at ?? null,
          comment: h.comment ?? null,
        },
      });
    }
  }

  return violations;
}
