import { supabase } from '@/utils/supabase';
import { fetchRetailCrmOrder } from '@/lib/retailcrm/orders';
import { updateExistingOrderInCrm } from '@/lib/retailcrm/leads';

// Перевод заказа в «Передано в производство» после поступления оплаты.
// Код статуса берётся из справочника (slug RetailCRM), с возможностью override через env.
export const PRODUCTION_STATUS = process.env.RETAILCRM_PRODUCTION_STATUS || 'send-assembling';

// Группы статусов, из которых НЕ переводим (заказ уже в производстве/отгрузке/завершён/
// отменён/рекламация/ВТО/другой бизнес «Цех-успех») — «не откатывать назад».
// Матчим по подстроке group_name из таблицы statuses (данные RetailCRM-синка).
const BLOCKED_GROUP_SUBSTR = ['производств', 'оставк', 'отмен', 'рекламац', 'вто', 'цех-успех', 'выполн'];

let _blockedCache: { set: Set<string>; at: number } | null = null;

async function blockedStatusCodes(): Promise<Set<string>> {
  if (_blockedCache && Date.now() - _blockedCache.at < 600_000) return _blockedCache.set;
  const set = new Set<string>([PRODUCTION_STATUS, 'complete', 'cancel']);
  const { data } = await supabase.from('statuses').select('code, group_name');
  for (const r of (data as Array<{ code: string; group_name: string | null }>) || []) {
    const g = String(r.group_name || '').toLowerCase();
    if (r.code && BLOCKED_GROUP_SUBSTR.some((p) => g.includes(p))) set.add(r.code);
  }
  if (set.size > 3) _blockedCache = { set, at: Date.now() }; // кэшируем только непустой справочник
  return set;
}

/**
 * После оплаты переводит заказ в производство, если он ещё НЕ в производстве/отгрузке/
 * завершён/отменён (не откатываем назад). Текущий статус берём из RetailCRM (авторитетно).
 * Не бросает — сбой не должен ломать проброс оплаты.
 */
export async function moveOrderToProductionAfterPayment(
  orderId: number | null | undefined,
): Promise<{ moved: boolean; reason: string }> {
  if (!orderId) return { moved: false, reason: 'no orderId' };
  try {
    const order = await fetchRetailCrmOrder(orderId);
    if (!order) return { moved: false, reason: 'order not found' };
    const current = String(order.status || '');
    const blocked = await blockedStatusCodes();
    if (blocked.has(current)) return { moved: false, reason: `оставлен в '${current}'` };
    await updateExistingOrderInCrm(orderId, { status: PRODUCTION_STATUS });
    return { moved: true, reason: `${current} → ${PRODUCTION_STATUS}` };
  } catch (e: any) {
    return { moved: false, reason: `ошибка: ${String(e?.message || e).slice(0, 200)}` };
  }
}
