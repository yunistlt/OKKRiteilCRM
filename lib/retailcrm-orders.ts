import { supabase } from '@/utils/supabase';

const RETAILCRM_URL = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL;
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;

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
  const cursorValue = order?.createdAt || order?.updatedAt || null;
  return cursorValue ? new Date(cursorValue) : null;
}

export function getRetailCrmOrderVersion(order: any) {
  return order?.updatedAt || order?.createdAt || new Date().toISOString();
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
  const response = await fetch(url);

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
  createdAtFrom?: string;
}) {
  const searchParams = new URLSearchParams();
  searchParams.set('page', String(params.page));
  searchParams.set('limit', String(params.limit ?? 100));

  if (params.createdAtFrom) {
    searchParams.set('filter[createdAtFrom]', params.createdAtFrom);
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

  const data = await fetchRetailCrm(`orders/${orderId}`, searchParams);
  return data.order || null;
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