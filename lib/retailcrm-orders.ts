import { supabase } from '@/utils/supabase';

const RETAILCRM_URL = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL;
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;
const RETAILCRM_FETCH_TIMEOUT_MS = 15000;
const RETAILCRM_ALLOWED_LIMITS = [20, 50, 100] as const;
const RETAILCRM_CIRCUIT_FAILURE_THRESHOLD = Math.max(2, Number.parseInt(process.env.RETAILCRM_CIRCUIT_FAILURE_THRESHOLD || '3', 10) || 3);
const RETAILCRM_CIRCUIT_OPEN_SECONDS = Math.max(60, Number.parseInt(process.env.RETAILCRM_CIRCUIT_OPEN_SECONDS || '900', 10) || 900);

type RetailCrmCircuitState = {
  failureCount: number;
  openUntil: string | null;
  lastError: string | null;
};

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

export function getRetailCrmMoscowHour(date: Date = new Date()) {
  return (date.getUTCHours() + 3) % 24;
}

export function isRetailCrmWorkingWindow(date: Date = new Date()) {
  const moscowHour = getRetailCrmMoscowHour(date);
  return moscowHour >= 9 && moscowHour < 21;
}

export function getRetailCrmDeltaCadenceSeconds(date: Date = new Date()) {
  return isRetailCrmWorkingWindow(date) ? 60 : 180;
}

export function getRetailCrmSlowPathMinutes() {
  const parsed = Number.parseInt(process.env.RETAILCRM_SLOW_PATH_MINUTES || '60', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 60;
  }

  return parsed;
}

export function shouldRunRetailCrmSlowPath(params: {
  now?: Date;
  lastSlowPathAt?: string | null;
}) {
  const now = params.now || new Date();
  if (now.getUTCMinutes() % 15 !== 0) {
    return false;
  }

  if (!params.lastSlowPathAt) {
    return true;
  }

  const lastRunMs = new Date(params.lastSlowPathAt).getTime();
  if (Number.isNaN(lastRunMs)) {
    return true;
  }

  return now.getTime() - lastRunMs >= 15 * 60 * 1000;
}

export function buildRetailCrmSlowPathUpdatedAtFrom(now: Date = new Date()) {
  const from = new Date(now.getTime() - getRetailCrmSlowPathMinutes() * 60 * 1000);
  return from.toISOString().slice(0, 19).replace('T', ' ');
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

async function getRetailCrmCircuitState(): Promise<RetailCrmCircuitState> {
  const { data, error } = await supabase
    .from('sync_state')
    .select('key, value')
    .in('key', [
      'retailcrm_api_failure_count',
      'retailcrm_api_circuit_open_until',
      'retailcrm_api_last_error',
    ]);

  if (error) {
    throw error;
  }

  const stateMap = new Map<string, string>((data || []).map((row: any) => [String(row.key), String(row.value || '')]));
  return {
    failureCount: Number.parseInt(stateMap.get('retailcrm_api_failure_count') || '0', 10) || 0,
    openUntil: stateMap.get('retailcrm_api_circuit_open_until') || null,
    lastError: stateMap.get('retailcrm_api_last_error') || null,
  };
}

async function resetRetailCrmCircuitState() {
  const now = new Date().toISOString();
  const { error } = await supabase.from('sync_state').upsert([
    {
      key: 'retailcrm_api_failure_count',
      value: '0',
      updated_at: now,
    },
    {
      key: 'retailcrm_api_circuit_open_until',
      value: '',
      updated_at: now,
    },
    {
      key: 'retailcrm_api_last_error',
      value: '',
      updated_at: now,
    },
  ], { onConflict: 'key' });

  if (error) {
    throw error;
  }
}

async function recordRetailCrmCircuitFailure(params: {
  errorMessage: string;
  opensCircuit: boolean;
}) {
  const current = await getRetailCrmCircuitState();
  const nextCount = params.opensCircuit ? current.failureCount + 1 : 0;
  const now = new Date();
  const shouldOpenCircuit = params.opensCircuit && nextCount >= RETAILCRM_CIRCUIT_FAILURE_THRESHOLD;
  const openUntil = shouldOpenCircuit
    ? new Date(now.getTime() + RETAILCRM_CIRCUIT_OPEN_SECONDS * 1000).toISOString()
    : '';

  const { error } = await supabase.from('sync_state').upsert([
    {
      key: 'retailcrm_api_failure_count',
      value: String(nextCount),
      updated_at: now.toISOString(),
    },
    {
      key: 'retailcrm_api_last_error',
      value: params.errorMessage.slice(0, 1500),
      updated_at: now.toISOString(),
    },
    {
      key: 'retailcrm_api_circuit_open_until',
      value: openUntil,
      updated_at: now.toISOString(),
    },
  ], { onConflict: 'key' });

  if (error) {
    throw error;
  }
}

async function ensureRetailCrmCircuitClosed() {
  const circuit = await getRetailCrmCircuitState();
  if (!circuit.openUntil) {
    return;
  }

  const openUntilMs = new Date(circuit.openUntil).getTime();
  if (Number.isNaN(openUntilMs)) {
    return;
  }

  if (openUntilMs > Date.now()) {
    throw new Error(`RetailCRM circuit breaker open until ${circuit.openUntil}${circuit.lastError ? `: ${circuit.lastError}` : ''}`);
  }

  await resetRetailCrmCircuitState();
}

async function fetchRetailCrm(path: string, params: URLSearchParams) {
  const { baseUrl, apiKey } = ensureRetailCrmConfig();
  await ensureRetailCrmCircuitClosed();
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
    const isRateLimitLike = response.status === 429 || response.status >= 500;
    const errorMessage = response.status >= 500
      ? `RetailCRM upstream 5xx ${response.status}: ${errorBody.substring(0, 200)}`
      : `RetailCRM API Error ${response.status}: ${errorBody.substring(0, 200)}`;
    await recordRetailCrmCircuitFailure({
      errorMessage,
      opensCircuit: isRateLimitLike,
    });
    throw new Error(errorMessage);
  }

  const data = await response.json();
  if (!data.success) {
    const errorMessage = `RetailCRM Success False: ${JSON.stringify(data).substring(0, 400)}`;
    await recordRetailCrmCircuitFailure({
      errorMessage,
      opensCircuit: false,
    });
    throw new Error(errorMessage);
  }

  await resetRetailCrmCircuitState();

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