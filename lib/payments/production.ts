import { supabase } from '@/utils/supabase';
import { loadStatusPalette } from '@/lib/own-crm/status-code';
import { editOrder } from '@/lib/own-crm/edit-order';
import { queueOrderForProduction } from '@/lib/own-crm/tseh-outbox';

// Перевод заказа в «Передано в производство» после поступления оплаты.
// Код статуса берётся из справочника (slug RetailCRM), с возможностью override через env.
export const PRODUCTION_STATUS = process.env.RETAILCRM_PRODUCTION_STATUS || 'send-assembling';

// Группы статусов, из которых НЕ переводим (заказ уже в производстве/отгрузке/завершён/
// отменён/рекламация/ВТО/другой бизнес «Цех-успех») — «не откатывать назад».
// Матчим по названию ЭТАПА статуса (crm_statuses + crm_status_groups) —
// справочник статусов один на весь проект.
const BLOCKED_GROUP_SUBSTR = ['производств', 'оставк', 'отмен', 'рекламац', 'вто', 'цех-успех', 'выполн'];

let _blockedCache: { set: Set<string>; prodName: string; names: Record<string, string>; at: number } | null = null;

async function loadStatusMeta(): Promise<{ set: Set<string>; prodName: string; names: Record<string, string> }> {
  if (_blockedCache && Date.now() - _blockedCache.at < 600_000) return _blockedCache;
  const set = new Set<string>([PRODUCTION_STATUS, 'complete', 'cancel']);
  const names: Record<string, string> = {};
  let prodName = 'Передано в производство';
  // Ключи палитры — оба кода статуса: заказ может лежать и под старым.
  const palette = await loadStatusPalette();
  palette.forEach((look, code) => {
    const stage = String(look.groupName || '').toLowerCase();
    if (BLOCKED_GROUP_SUBSTR.some((p) => stage.includes(p))) set.add(code);
    if (look.name) names[code] = look.name;
    if (code === PRODUCTION_STATUS && look.name) prodName = look.name;
  });
  const meta = { set, prodName, names };
  if (set.size > 3) _blockedCache = { ...meta, at: Date.now() }; // кэшируем только непустой справочник
  return meta;
}

// Результат перевода: moved — переведён (statusName — имя целевого статуса);
// иначе notMovedReason — человекочитаемая причина (для пометки ❗ в уведомлении).
export interface MoveToProductionResult {
  moved: boolean;
  statusName?: string;
  notMovedReason?: string;
}

/**
 * После оплаты переводит заказ в производство, если он ещё НЕ в производстве/
 * отгрузке/завершён/отменён (не откатываем назад). Статус читаем и пишем в
 * своей базе: с 09.10.2026 заказы ведутся только в ОКК.
 * Не бросает — сбой не должен ломать проброс оплаты.
 */
export async function moveOrderToProductionAfterPayment(
  orderId: number | null | undefined,
): Promise<MoveToProductionResult> {
  if (!orderId) return { moved: false, notMovedReason: 'нет id заказа' };
  try {
    /**
     * Статус заказа живёт в нашей базе — и читаем, и пишем только её.
     *
     * Раньше перевод шёл через RetailCRM: статус читался оттуда и писался
     * туда же. Для заказов нашей базы это не работало — оплата приходила, а
     * заказ оставался на «Счёт на оплате» (заказ 54691, 02.10.2026). С
     * 09.10.2026 RetailCRM архив на чтение, и путь один на все заказы.
     */
    const { data: row } = await supabase
      .from('orders')
      .select('id, status')
      .eq('order_id', orderId)
      .maybeSingle();

    if (!row) return { moved: false, notMovedReason: 'заказ не найден' };

    const current = String((row as any).status || '');
    const { set: blocked, prodName, names } = await loadStatusMeta();
    if (blocked.has(current)) {
      return { moved: false, notMovedReason: `уже в статусе «${names[current] || current}»` };
    }

    /**
     * Статус меняем ОДНОЙ дверью — через `editOrder`.
     *
     * Прямой `update` писал только колонку: без записи в историю и без даты
     * входа в статус. Поэтому расчёт зарплаты не видел такие заказы вовсе —
     * он ищет вход в производство по истории (владелец 12.10.2026: «почему не
     * актуальные данные»). Три заказа октября так и повисли невидимыми.
     */
    const moved = await editOrder(Number((row as any).id), { statusCode: PRODUCTION_STATUS });
    if (!moved.ok) {
      return { moved: false, notMovedReason: `статус не записался: ${moved.reason}` };
    }

    // Заказ встал в очередь, из которой ЦехУспех забирает его сам.
    await queueOrderForProduction(orderId);
    return { moved: true, statusName: prodName };
  } catch (e: any) {
    return { moved: false, notMovedReason: `сбой перевода: ${String(e?.message || e).slice(0, 150)}` };
  }
}
