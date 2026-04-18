import { supabase } from '@/utils/supabase';

const RETAILCRM_URL = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL;
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;
const RETAILCRM_FETCH_TIMEOUT_MS = 15000;
const RETAILCRM_ALLOWED_LIMITS = [20, 50, 100] as const;

export function cleanRetailCrmPhone(val: any): string {
  if (!val) return '';
  return String(val).replace(/[^\d+]/g, '');
}

export function mapRetailCrmOrderToUpsertRow(order: any) {
  const phones = new Set<string>();
  const primaryPhone = cleanRetailCrmPhone(order.phone);
  const additionalPhone = cleanRetailCrmPhone(order.additionalPhone);

  if (primaryPhone) phones.add(primaryPhone);
  if (additionalPhone) phones.add(additionalPhone);

  if (Array.isArray(order.customer?.phones)) {
    order.customer.phones.forEach((phone: any) => {
      const normalized = cleanRetailCrmPhone(phone?.number);
      if (normalized) phones.add(normalized);
    });
  }

  if (Array.isArray(order.contact?.phones)) {
    order.contact.phones.forEach((phone: any) => {
      const normalized = cleanRetailCrmPhone(phone?.number);
      if (normalized) phones.add(normalized);
    });
  }

  return {
    id: order.id,
    order_id: order.id,
    created_at: order.createdAt,
    updated_at: new Date().toISOString(),
    number: order.number || String(order.id),
    status: order.status,
    site: order.site || null,
    event_type: 'snapshot',
    manager_id: order.managerId ? String(order.managerId) : null,
    phone: primaryPhone || null,
    customer_phones: Array.from(phones),
    totalsumm: order.totalSumm || 0,
    raw_payload: order,
    prichiny_otmeny: order.customFields?.prichiny_otmeny || null,
  };
}

export function getRetailCrmOrderCursor(order: any) {
  const cursorValue = order?.updatedAt || order?.createdAt || null;
  return cursorValue ? new Date(cursorValue) : null;
}

export function getRetailCrmOrderVersion(order: any) {
  return order?.updatedAt || order?.createdAt || new Date().toISOString();
}

export function normalizeRetailCrmLimit(limit?: number, fallback: 20 | 50 | 100 = 50): 20 | 50 | 100 {
  const normalized = RETAILCRM_ALLOWED_LIMITS.find((allowed) => allowed === limit);
  return normalized || fallback;
}

export function getRetailCrmOverlapMinutes(): number {
  const parsed = Number.parseInt(process.env.RETAILCRM_OVERLAP_MINUTES || '5', 10);
  if (!Number.isFinite(parsed)) {
    return 5;
  }

  return Math.min(5, Math.max(2, parsed));
}

export function getRetailCrmCatchUpLagMinutes(): number {
  const parsed = Number.parseInt(process.env.RETAILCRM_CATCH_UP_LAG_MINUTES || '120', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 120;
  }

  return parsed;
}

export function isRetailCrmCatchUpMode(cursorValue: string | null | undefined): boolean {
  if (!cursorValue) {
    return false;
  }

  const cursorMs = new Date(cursorValue).getTime();
  if (Number.isNaN(cursorMs)) {
    return false;
  }

  const lagMinutes = (Date.now() - cursorMs) / 60000;
  return lagMinutes >= getRetailCrmCatchUpLagMinutes();
}

export function buildRetailCrmUpdatedAtFrom(params: {
  cursorValue?: string | null;
  fallbackDays?: number;
}) {
  if (params.cursorValue) {
    const lastSync = new Date(params.cursorValue);
    if (!Number.isNaN(lastSync.getTime())) {
      lastSync.setMinutes(lastSync.getMinutes() - getRetailCrmOverlapMinutes());
      return lastSync.toISOString().slice(0, 19).replace('T', ' ');
    }
  }

  const fallbackDate = new Date();
  fallbackDate.setDate(fallbackDate.getDate() - (params.fallbackDays ?? 2));
  return fallbackDate.toISOString().slice(0, 19).replace('T', ' ');
}

export function getRetailCrmPageWindow(catchUpMode: boolean) {
  return {
    limit: normalizeRetailCrmLimit(catchUpMode ? 100 : 50),
    maxPagesPerRun: catchUpMode ? 10 : 2,
  };
}

function ensureRetailCrmConfig() {
  if (!RETAILCRM_URL || !RETAILCRM_API_KEY) {
    throw new Error('RetailCRM config missing');
  }

  return {
    baseUrl: RETAILCRM_URL.replace(/\/+$/, ''),
    apiKey: RETAILCRM_API_KEY,
  };
}

async function fetchRetailCrm(path: string, params: URLSearchParams) {
  const { baseUrl, apiKey } = ensureRetailCrmConfig();
  params.set('apiKey', apiKey);

  const url = `${baseUrl}/api/v5/${path}?${params.toString()}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RETAILCRM_FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error(`RetailCRM request timeout after ${RETAILCRM_FETCH_TIMEOUT_MS}ms`);
    }
    throw new Error(`RetailCRM network error: ${error?.message || 'Unknown fetch error'}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`RetailCRM API Error ${response.status}: ${errorBody.substring(0, 200)}`);
  }

  const data = await response.json();
  if (!data.success) {
    throw new Error(`RetailCRM Success False: ${JSON.stringify(data).substring(0, 400)}`);
  }

  return data;
}

export async function fetchRetailCrmOrdersPage(params: {
  page: number;
  limit?: 20 | 50 | 100;
  updatedAtFrom?: string;
}) {
  const searchParams = new URLSearchParams();
  searchParams.set('page', String(params.page));
  searchParams.set('limit', String(normalizeRetailCrmLimit(params.limit, 50)));

  if (params.updatedAtFrom) {
    searchParams.set('filter[updatedAtFrom]', params.updatedAtFrom);
  }

  const data = await fetchRetailCrm('orders', searchParams);
  return {
    orders: data.orders || [],
    pagination: data.pagination || null,
  };
}

export async function fetchRetailCrmOrder(orderId: number) {
  const searchParams = new URLSearchParams();
  searchParams.set('by', 'id');

  try {
    const data = await fetchRetailCrm(`orders/${orderId}`, searchParams);
    return data.order || null;
  } catch (error: any) {
    if (String(error?.message || '').includes('RetailCRM API Error 404')) {
      return null;
    }
    throw error;
  }
}

export async function fetchRetailCrmHistoryPage(params: {
  page: number;
  limit?: 20 | 50 | 100;
  startDate: string;
}) {
  const searchParams = new URLSearchParams();
  searchParams.set('page', String(params.page));
  searchParams.set('limit', String(params.limit ?? 100));
  searchParams.set('filter[startDate]', params.startDate);

  const data = await fetchRetailCrm('orders/history', searchParams);
  return {
    history: data.history || [],
    pagination: data.pagination || null,
  };
}

export async function upsertRetailCrmOrders(orders: any[]) {
  if (!orders.length) {
    return [];
  }

  const rows = orders.map(mapRetailCrmOrderToUpsertRow);
  const { error } = await supabase.rpc('upsert_orders_v2', {
    orders_data: rows,
  });

  if (error) {
    throw error;
  }

  return rows;
}