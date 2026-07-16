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

let _blockedCache: { set: Set<string>; prodName: string; names: Record<string, string>; at: number } | null = null;

async function loadStatusMeta(): Promise<{ set: Set<string>; prodName: string; names: Record<string, string> }> {
  if (_blockedCache && Date.now() - _blockedCache.at < 600_000) return _blockedCache;
  const set = new Set<string>([PRODUCTION_STATUS, 'complete', 'cancel']);
  const names: Record<string, string> = {};
  let prodName = 'Передано в производство';
  const { data } = await supabase.from('statuses').select('code, group_name, name');
  for (const r of (data as Array<{ code: string; group_name: string | null; name: string | null }>) || []) {
    const g = String(r.group_name || '').toLowerCase();
    if (r.code && BLOCKED_GROUP_SUBSTR.some((p) => g.includes(p))) set.add(r.code);
    if (r.code && r.name) names[r.code] = r.name;
    if (r.code === PRODUCTION_STATUS && r.name) prodName = r.name;
  }
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
 * После оплаты переводит заказ в производство, если он ещё НЕ в производстве/отгрузке/
 * завершён/отменён (не откатываем назад). Текущий статус берём из RetailCRM (авторитетно).
 * Не бросает — сбой не должен ломать проброс оплаты.
 */
export async function moveOrderToProductionAfterPayment(
  orderId: number | null | undefined,
  opts: { currentStatus?: string | null; site?: string | null } = {},
): Promise<MoveToProductionResult> {
  if (!orderId) return { moved: false, notMovedReason: 'нет id заказа' };
  try {
    // Текущий статус и site можно передать (если заказ уже фетчили) — иначе тянем сами.
    // site обязателен: orders/edit отклоняет чужой site заказа (см. updateExistingOrderInCrm).
    let current = opts.currentStatus ? String(opts.currentStatus) : '';
    let site = opts.site ? String(opts.site) : '';
    if (!current || !site) {
      const order = await fetchRetailCrmOrder(orderId);
      if (!order) return { moved: false, notMovedReason: 'заказ не найден в RetailCRM' };
      if (!current) current = String(order.status || '');
      if (!site) site = String(order.site || '');
    }
    const { set: blocked, prodName, names } = await loadStatusMeta();
    if (blocked.has(current)) {
      const curName = names[current] || current;
      return { moved: false, notMovedReason: `уже в статусе «${curName}»` };
    }
    const res = await updateExistingOrderInCrm(orderId, { status: PRODUCTION_STATUS }, site || undefined);
    if (!res.success) {
      return { moved: false, notMovedReason: `RetailCRM отклонил перевод: ${res.errorMsg || 'неизвестная ошибка'}` };
    }
    return { moved: true, statusName: prodName };
  } catch (e: any) {
    return { moved: false, notMovedReason: `ошибка RetailCRM: ${String(e?.message || e).slice(0, 150)}` };
  }
}
