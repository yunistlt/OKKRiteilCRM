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

let _blockedCache: { set: Set<string>; prodName: string; at: number } | null = null;

async function loadStatusMeta(): Promise<{ set: Set<string>; prodName: string }> {
  if (_blockedCache && Date.now() - _blockedCache.at < 600_000) return _blockedCache;
  const set = new Set<string>([PRODUCTION_STATUS, 'complete', 'cancel']);
  let prodName = 'Передано в производство';
  const { data } = await supabase.from('statuses').select('code, group_name, name');
  for (const r of (data as Array<{ code: string; group_name: string | null; name: string | null }>) || []) {
    const g = String(r.group_name || '').toLowerCase();
    if (r.code && BLOCKED_GROUP_SUBSTR.some((p) => g.includes(p))) set.add(r.code);
    if (r.code === PRODUCTION_STATUS && r.name) prodName = r.name;
  }
  const meta = { set, prodName };
  if (set.size > 3) _blockedCache = { ...meta, at: Date.now() }; // кэшируем только непустой справочник
  return meta;
}

/**
 * После оплаты переводит заказ в производство, если он ещё НЕ в производстве/отгрузке/
 * завершён/отменён (не откатываем назад). Текущий статус берём из RetailCRM (авторитетно).
 * Не бросает — сбой не должен ломать проброс оплаты.
 */
export async function moveOrderToProductionAfterPayment(
  orderId: number | null | undefined,
): Promise<{ moved: boolean; reason: string; statusName?: string }> {
  if (!orderId) return { moved: false, reason: 'no orderId' };
  try {
    const order = await fetchRetailCrmOrder(orderId);
    if (!order) return { moved: false, reason: 'order not found' };
    const current = String(order.status || '');
    const { set: blocked, prodName } = await loadStatusMeta();
    if (blocked.has(current)) return { moved: false, reason: `оставлен в '${current}'` };
    await updateExistingOrderInCrm(orderId, { status: PRODUCTION_STATUS });
    return { moved: true, reason: `${current} → ${PRODUCTION_STATUS}`, statusName: prodName };
  } catch (e: any) {
    return { moved: false, reason: `ошибка: ${String(e?.message || e).slice(0, 200)}` };
  }
}
