// Запись в журнал действий юротдела.
//
// Прямой вызов supabase.insert здесь опасен тем, что молчит: на отсутствующую
// таблицу или отказ по правам supabase-js не бросает исключение, а кладёт ошибку
// в поле error — и запись теряется незаметно. Именно так журнал не работал вовсе,
// пока это не вскрылось прогоном 28.09.2026. Здесь ошибка хотя бы попадает в лог.
import { supabase } from '@/utils/supabase';

export async function writeLegalAudit(entry: {
  action: string;
  entity: string;
  entityId: number | string | null;
  performedBy: string | null;
  details?: Record<string, any> | null;
}) {
  const { error } = await supabase.from('legal_audit_log').insert({
    action: entry.action,
    entity: entry.entity,
    entity_id: entry.entityId === null ? null : Number(entry.entityId),
    performed_by: entry.performedBy,
    details: entry.details ?? null,
  });

  // Журнал не должен ронять действие пользователя, но и молчать не должен.
  if (error) console.error('[legal-audit] запись не удалась:', entry.action, error.message);
}
