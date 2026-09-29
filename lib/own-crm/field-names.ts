/**
 * Человеческие названия полей и значений заказа — из справочников RetailCRM.
 *
 * Закон проекта: названия не выдумываем и не хардкодим. Имя поля берём из
 * retailcrm_custom_fields.name, расшифровку значения — из
 * retailcrm_dictionaries.item_name. Сюда же сложены названия стандартных полей
 * заказа, которых в справочнике RetailCRM нет (их имена задаёт сам RetailCRM в
 * своём интерфейсе, у нас они в комментариях колонок базы).
 */
import { supabase } from '@/utils/supabase';

export type OrderFieldMeta = {
  code: string;
  name: string;
  type: string;
  dictionary: string | null;
};

type Cache = {
  fields: Map<string, OrderFieldMeta>;
  values: Map<string, Map<string, string>>;
  loadedAt: number;
};

const TTL_MS = 5 * 60 * 1000;
let cache: Cache | null = null;

async function load(): Promise<Cache> {
  if (cache && Date.now() - cache.loadedAt < TTL_MS) {
    return cache;
  }

  const [fieldsRes, dictRes] = await Promise.all([
    supabase.from('retailcrm_custom_fields').select('code, name, type, dictionary').eq('entity', 'order'),
    supabase.from('retailcrm_dictionaries').select('dictionary_code, item_code, item_name').not('dictionary_code', 'is', null),
  ]);

  const fields = new Map<string, OrderFieldMeta>();
  for (const row of (fieldsRes.data || []) as any[]) {
    fields.set(row.code, { code: row.code, name: row.name, type: row.type, dictionary: row.dictionary });
  }

  const values = new Map<string, Map<string, string>>();
  for (const row of (dictRes.data || []) as any[]) {
    if (!values.has(row.dictionary_code)) {
      values.set(row.dictionary_code, new Map());
    }
    values.get(row.dictionary_code)!.set(String(row.item_code), row.item_name);
  }

  cache = { fields, values, loadedAt: Date.now() };
  return cache;
}

/** Сбросить кэш — после синхронизации справочников. */
export function resetFieldNamesCache() {
  cache = null;
}

/** Название поля по-русски. Нет в справочнике — вернём сам код, чтобы было видно пробел. */
export async function fieldName(code: string): Promise<string> {
  const { fields } = await load();
  return fields.get(code)?.name || code;
}

/** Значение поля по-русски: код справочника разворачиваем в название. */
export async function fieldValue(code: string, value: unknown): Promise<string | null> {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const { fields, values } = await load();
  const meta = fields.get(code);

  if (meta?.type === 'boolean' || typeof value === 'boolean') {
    return value === true || value === 'true' ? 'да' : 'нет';
  }

  if (meta?.dictionary) {
    const label = values.get(meta.dictionary)?.get(String(value));
    if (label) {
      return label;
    }
  }

  if (value instanceof Date) {
    return value.toLocaleDateString('ru-RU');
  }

  return String(value);
}

/** Все известные поля заказа. */
export async function orderFields(): Promise<OrderFieldMeta[]> {
  const { fields } = await load();
  return Array.from(fields.values());
}
