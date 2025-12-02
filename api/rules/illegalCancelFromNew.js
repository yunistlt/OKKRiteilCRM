// api/rules/illegalCancelFromNew.js

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

function extractStatusCodeFromValue(raw) {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);

    if (typeof parsed === 'string') {
      return parsed;
    }

    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.code === 'string') return parsed.code;
      if (typeof parsed.status === 'string') return parsed.status;
      if (typeof parsed.id === 'string') return parsed.id;
    }
  } catch {
    // не JSON – ок, идём дальше
  }

  if (typeof raw === 'string') {
    return raw.replace(/^"+|"+$/g, '');
  }

  return null;
}

/**
 * Правило: ILLEGAL_CANCEL_FROM_NEW
 * Логика MVP:
 *   если по заказу есть переход "Новый" → [отменный статус]
 *   без промежуточного статуса между ними → фиксируем нарушение
 */
export function detectIllegalCancelFromNewViolations(history, config) {
  const { NEW_STATUS_CODE, CANCEL_STATUS_CODES = [], nowIso } = config;

  // если коды отмен не заданы — правило молчит
  if (!NEW_STATUS_CODE || !CANCEL_STATUS_CODES.length) return [];

  const statusHistory = history.filter((h) => isStatusField(h.field_name));
  const byOrder = new Map();

  for (const h of statusHistory) {
    const key = h.order_id || h.retailcrm_order_id;
    if (!key) continue;
    if (!byOrder.has(key)) byOrder.set(key, []);
    byOrder.get(key).push(h);
  }

  const violations = [];
  const detectedAt = nowIso || new Date().toISOString();

  for (const [orderKey, rows] of byOrder.entries()) {
    const sorted = [...rows].sort(
      (a, b) =>
        new Date(a.changed_at || a.created_at || 0) -
        new Date(b.changed_at || b.created_at || 0),
    );

    let prevStatusCode = null;
    let prevRow = null;

    for (const row of sorted) {
      const newCode =
        extractStatusCodeFromValue(row.new_value) ||
        extractStatusCodeFromValue(row.old_value);

      if (!newCode) {
        prevRow = row;
        continue;
      }

      // первый раз увидели "Новый"
      if (!prevStatusCode && newCode === NEW_STATUS_CODE) {
        prevStatusCode = newCode;
        prevRow = row;
        continue;
      }

      // если предыдущий статус был "Новый", а текущий — отменный
      if (
        prevStatusCode === NEW_STATUS_CODE &&
        CANCEL_STATUS_CODES.includes(newCode)
      ) {
        violations.push({
          order_id: row.order_id ?? null,
          manager_id: row.changer_id ?? null, // финально будет перезаписан через changer_retailcrm_user_id
          violation_type: 'ILLEGAL_CANCEL_FROM_NEW',
          severity: 2,
          detected_at: detectedAt,
          details: {
            message:
              'Заказ отменён из статуса «Новый» без прохождения регламента (3 дня, 5 звонков, 2 письма, комментарий).',
            prev_status_code: prevStatusCode,
            new_status_code: newCode,
            prev_changed_at: prevRow?.changed_at ?? null,
            cancel_changed_at: row.changed_at ?? null,
            retailcrm_order_id: row.retailcrm_order_id ?? null,
            history_id: row.id,
            changer_retailcrm_user_id: row.changer_retailcrm_user_id ?? null,
          },
        });
      }

      prevStatusCode = newCode;
      prevRow = row;
    }
  }

  return violations;
}
