/**
 * Чтение заказа из колонок, а не из raw_payload.
 *
 * Зачем: поля заказа RetailCRM лежат у нас колонками (миграции 20260928/20260929),
 * заполняются триггером при каждой записи. Этот модуль — единственный вход к ним,
 * чтобы 222 места в коде перестали разбирать JSON каждое по-своему.
 *
 * raw_payload остаётся полной копией ответа RetailCRM: если нужного поля здесь
 * нет, оно есть там.
 */
import { supabase } from '@/utils/supabase';
import { fieldName, fieldValue, orderFields } from './field-names';

/** Стандартные поля заказа RetailCRM. Имена — их, без перевода. */
export type OwnOrder = {
  /** Наш внутренний номер строки. */
  id: number;
  /** Идентификатор заказа в RetailCRM. */
  order_id: number | null;
  number: string | null;
  status: string | null;
  site: string | null;
  manager_id: number | null;
  phone: string | null;
  totalsumm: number | null;

  orderType: string | null;
  orderMethod: string | null;
  currency: string | null;
  managerComment: string | null;
  statusComment: string | null;
  customerComment: string | null;
  firstName: string | null;
  lastName: string | null;
  patronymic: string | null;
  email: string | null;
  additionalPhone: string | null;
  shipmentStore: string | null;
  externalId: string | null;

  createdAt: string | null;
  statusUpdatedAt: string | null;
  fullPaidAt: string | null;
  shipmentDate: string | null;

  summ: number | null;
  prepaySum: number | null;
  purchaseSumm: number | null;
  weight: number | null;
  width: number | null;
  height: number | null;
  length: number | null;

  expired: boolean | null;
  shipped: boolean | null;

  delivery: Record<string, any> | null;
  contragent: Record<string, any> | null;
  contact: Record<string, any> | null;
  company: Record<string, any> | null;

  /** Свои поля заказа из справочника RetailCRM — те же колонки, их коды. */
  [customField: string]: any;
};

const STANDARD_COLUMNS = [
  'id', 'order_id', 'number', 'status', 'site', 'manager_id', 'phone', 'totalsumm',
  '"orderType"', '"orderMethod"', '"currency"', '"managerComment"', '"statusComment"',
  '"customerComment"', '"firstName"', '"lastName"', '"patronymic"', '"email"',
  '"additionalPhone"', '"shipmentStore"', '"externalId"',
  '"createdAt"', '"statusUpdatedAt"', '"fullPaidAt"', '"shipmentDate"',
  '"summ"', '"prepaySum"', '"purchaseSumm"', '"weight"', '"width"', '"height"', '"length"',
  '"expired"', '"shipped"',
  '"delivery"', '"contragent"', '"contact"', '"company"',
];

let selectCache: { value: string; at: number } | null = null;

/** Список колонок для выборки: стандартные плюс свои поля из справочника. */
async function selectList(): Promise<string> {
  if (selectCache && Date.now() - selectCache.at < 5 * 60 * 1000) {
    return selectCache.value;
  }

  const custom = (await orderFields()).map((f) => `"${f.code.slice(0, 63)}"`);
  const value = Array.from(new Set([...STANDARD_COLUMNS, ...custom])).join(', ');
  selectCache = { value, at: Date.now() };
  return value;
}

/** Заказ по внутреннему номеру строки. */
export async function loadOrder(id: number): Promise<OwnOrder | null> {
  const { data, error } = await supabase
    .from('orders')
    .select(await selectList())
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as OwnOrder) || null;
}

/** Заказ по идентификатору RetailCRM. */
export async function loadOrderByCrmId(orderId: number): Promise<OwnOrder | null> {
  const { data, error } = await supabase
    .from('orders')
    .select(await selectList())
    .eq('order_id', orderId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as OwnOrder) || null;
}

/** Несколько заказов разом. */
export async function loadOrders(ids: number[]): Promise<OwnOrder[]> {
  if (!ids.length) {
    return [];
  }

  const { data, error } = await supabase
    .from('orders')
    .select(await selectList())
    .in('id', ids);

  if (error) {
    throw error;
  }

  return (data || []) as unknown as OwnOrder[];
}

export type OrderFact = { label: string; value: string };

/**
 * Заказ человеческим языком: пары «название — значение», только заполненные.
 * Отсюда берут текст и интерфейс, и агенты — чтобы модель видела «Приоритет: 3»,
 * а не `prioriry_number: 3`.
 */
export async function describeOrder(order: OwnOrder): Promise<OrderFact[]> {
  const facts: OrderFact[] = [];
  const push = async (code: string, raw: unknown) => {
    const value = await fieldValue(code, raw);
    if (value !== null && value !== '') {
      facts.push({ label: await fieldName(code), value });
    }
  };

  for (const field of await orderFields()) {
    await push(field.code, order[field.code.slice(0, 63)]);
  }

  return facts;
}
