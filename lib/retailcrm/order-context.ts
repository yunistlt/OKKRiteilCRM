import { loadManagerIdentity } from '@/lib/manager-identity';
import { supabase } from '@/utils/supabase';

type StoredOrderRow = {
  id: number;
  order_id: number | null;
  number: string | null;
  status: string | null;
  site: string | null;
  manager_id: number | string | null;
  phone: string | null;
  customer_phones: string[] | null;
  totalsumm: number | null;
  raw_payload: Record<string, any> | null;
  prichiny_otmeny: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function normalizeManagerId(value: number | string | null | undefined) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

function buildManagerName(params: {
  manager?: { first_name?: string | null; last_name?: string | null } | null;
  rawPayload?: Record<string, any> | null;
}) {
  const dbName = [params.manager?.first_name, params.manager?.last_name].filter(Boolean).join(' ').trim();
  if (dbName) {
    return dbName;
  }

  const rawManager = params.rawPayload?.manager;
  const rawName = [
    rawManager?.firstName,
    rawManager?.lastName,
    rawManager?.first_name,
    rawManager?.last_name,
  ].filter(Boolean).join(' ').trim();

  return rawName || null;
}

function buildLightweightOrderContext(params: {
  order: StoredOrderRow;
  managerName: string | null;
}) {
  const rawPayload = params.order.raw_payload || {};
  const retailcrmOrderId = params.order.order_id || params.order.id;

  return {
    order_id: retailcrmOrderId,
    internal_order_id: params.order.id,
    number: params.order.number || String(retailcrmOrderId),
    status: params.order.status,
    current_status: params.order.status,
    status_name: rawPayload?.status?.name || params.order.status || null,
    site: params.order.site || rawPayload?.site || null,
    manager_id: normalizeManagerId(params.order.manager_id),
    manager_name: params.managerName,
    phone: params.order.phone,
    customer_phones: params.order.customer_phones || [],
    totalsumm: params.order.totalsumm,
    order_amount: params.order.totalsumm,
    prichiny_otmeny: params.order.prichiny_otmeny || rawPayload?.customFields?.prichiny_otmeny || null,
    manager_comment: rawPayload?.managerComment || null,
    customer_comment: rawPayload?.customerComment || null,
    email: rawPayload?.email || rawPayload?.customer?.email || rawPayload?.contragent?.email || null,
    delivery_address: rawPayload?.delivery?.address?.text || null,
    customer: rawPayload?.customer || null,
    contragent: rawPayload?.contragent || null,
    createdAt: rawPayload?.createdAt || params.order.created_at,
    updatedAt: rawPayload?.updatedAt || params.order.updated_at,
    raw_payload: rawPayload,
  };
}

export async function fetchStoredOrderForContextRefresh(orderId: number) {
  const { data, error } = await supabase
    .from('orders')
    .select('id, order_id, number, status, site, manager_id, phone, customer_phones, totalsumm, raw_payload, prichiny_otmeny, created_at, updated_at')
    .eq('id', orderId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data || null) as StoredOrderRow | null;
}

export async function refreshRetailCrmOrderContext(params: {
  orderId: number;
  order?: StoredOrderRow | null;
}) {
  const order = params.order ?? await fetchStoredOrderForContextRefresh(params.orderId);
  if (!order) {
    return {
      status: 'skipped_not_found' as const,
      retailcrmOrderId: params.orderId,
      managerId: null,
      managerName: null,
      orderUpdatedAt: null,
      contextRefreshedAt: new Date().toISOString(),
    };
  }

  const retailcrmOrderId = order.order_id || order.id;
  const managerId = normalizeManagerId(order.manager_id);
  const manager = managerId ? await loadManagerIdentity(managerId) : null;
  const managerName = buildManagerName({ manager, rawPayload: order.raw_payload });
  const fullOrderContext = buildLightweightOrderContext({ order, managerName });
  const computedAt = new Date().toISOString();

  const { error } = await supabase
    .from('order_metrics')
    .upsert({
      retailcrm_order_id: retailcrmOrderId,
      current_status: order.status,
      manager_id: managerId,
      order_amount: order.totalsumm,
      full_order_context: fullOrderContext,
      computed_at: computedAt,
    }, { onConflict: 'retailcrm_order_id' });

  if (error) {
    throw error;
  }

  return {
    status: 'updated' as const,
    retailcrmOrderId,
    managerId,
    managerName,
    orderUpdatedAt: order.updated_at,
    contextRefreshedAt: computedAt,
  };
}