// /api/ai/analyzeOrderHistory.js

import { createClient } from '@supabase/supabase-js';
import { askAI } from '../utils/aiClient.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// Рабочая воронка (12 статусов)
const WORKING_STATUSES = [
  'Новый',
  'Заявка квалифицирована',
  'Ожидание ТЗ',
  'В просчёте',
  'Согласование параметров заказа',
  'Договор на согласовании',
  'Отложено',
  'Тендер',
  'Ожидание выхода тендера',
  'Дубль на тендер',
  'Договор СОГЛАСОВАН',
  'Счет на оплате',
];

export default async function handler(req, res) {
  try {
    // 1. Берём историю ТОЛЬКО по рабочим статусам
    const { data: historyRows, error } = await supabase
      .from('okk_order_history')
      .select('*')
      .in('status', WORKING_STATUSES)      // ← вот главный фильтр
      .order('order_id', { ascending: true })
      .order('changed_at', { ascending: true })
      .limit(500);

    if (error) {
      console.error('DB error (okk_order_history):', error);
      return res.status(500).json({ error: 'DB error' });
    }

    if (!historyRows || historyRows.length === 0) {
      return res.status(200).json({ processedOrders: 0, message: 'No history rows' });
    }

    const byOrder = new Map();

    for (const row of historyRows) {
      if (!byOrder.has(row.order_id)) {
        byOrder.set(row.order_id, []);
      }
      byOrder.get(row.order_id).push(row);
    }

    const ordersToProcess = Array.from(byOrder.keys()).slice(0, 10);
    const results = [];

    for (const orderId of ordersToProcess) {
      const history = byOrder.get(orderId) || [];
      if (history.length < 2) continue;

      const historyText = history
        .map(h =>
          `${h.changed_at || h.created_at || ''} | ${h.status || ''} | ${h.status_group || ''}`
        )
        .join('\n');

      const prompt = `
Ты — система контроля качества продаж.

У тебя есть хронологическая история изменения СТАТУСОВ ТОЛЬКО ВНУТРИ РАБОЧЕЙ ВОРОНКИ
(производство, доставка и отмена уже отфильтрованы).

Твоя задача — найти нарушения логики работы с воронкой и вернуть СТРОГО JSON.

Возможные типы нарушений:
- "TIMER_RESET_ATTEMPT" — попытка сбросить таймер (туда-сюда между статусами за короткое время)
- "FAKE_QUALIFICATION" — ложная квалификация из статуса "Новый" без реальных оснований
- "ILLEGAL_CANCEL_FROM_NEW" — (для будущего, если увидим отмену из "Новый")
- "WEIRD_STATUS_LOOP" — нелогичные петли по статусам

История статусов внутри рабочей воронки:
${historyText}

Верни JSON строго в формате:

{
  "violations": [
    {
      "type": "TIMER_RESET_ATTEMPT" | "FAKE_QUALIFICATION" | "ILLEGAL_CANCEL_FROM_NEW" | "WEIRD_STATUS_LOOP",
      "severity": 1,
      "comment": "Краткое объяснение на русском"
    }
  ]
}

Если нарушений нет, верни:
{ "violations": [] }
`;

      let aiJson;
      try {
        const aiRaw = await askAI({
          prompt,
          model: 'gpt-4.1-mini',
          responseFormat: 'json_object',
        });

        aiJson = JSON.parse(aiRaw);
      } catch (e) {
        console.error('AI parse error for order', orderId, e);
        continue;
      }

      const violations = Array.isArray(aiJson?.violations) ? aiJson.violations : [];

      if (!violations.length) {
        results.push({ orderId, violations: 0 });
        continue;
      }

      const rowsToInsert = violations.map(v => ({
        order_id: orderId,
        violation_type: v.type || null,
        severity: v.severity ?? 1,
        comment: v.comment || null,
        source: 'AI_ORDER_HISTORY',
      }));

      const { error: insertError } = await supabase
        .from('okk_violations')
        .insert(rowsToInsert);

      if (insertError) {
        console.error('DB error (okk_violations insert):', insertError);
      } else {
        results.push({ orderId, violations: rowsToInsert.length });
      }
    }

    return res.status(200).json({
      processedOrders: results.length,
      details: results,
    });
  } catch (e) {
    console.error('Unexpected error in analyzeOrderHistory:', e);
    return res.status(500).json({ error: 'Unexpected error' });
  }
}