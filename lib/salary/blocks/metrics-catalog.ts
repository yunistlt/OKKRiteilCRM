// ============================================================================
// Манифест РЕАЛЬНО доступных в БД показателей. Блок не может требовать метрику,
// которой здесь нет → структурно невозможно «запросить несуществующий показатель».
// availability: 'full' — заполнено почти всегда; 'partial' — заполнено не у всех
// (UI предупреждает); 'none' — данных нет (блок недоступен в конструкторе).
// ============================================================================

export type MetricAvailability = 'full' | 'partial' | 'none';

export interface MetricDef {
    code: string;
    label: string; // русское описание
    source: string; // откуда берётся
    availability: MetricAvailability;
}

export const METRICS_CATALOG: Record<string, MetricDef> = {
    counted_orders: { code: 'counted_orders', label: 'Засчитанные заказы (передано в производство)', source: 'order_history_log + orders', availability: 'full' },
    order_type: { code: 'order_type', label: 'Тип заявки (новый/постоянный/печь-ВТО)', source: 'orders.customFields.typ_castomer + история сделок клиента', availability: 'full' },
    order_total: { code: 'order_total', label: 'Сумма заказа', source: 'orders.totalsumm', availability: 'full' },
    revenue_no_vat: { code: 'revenue_no_vat', label: 'Выручка без НДС', source: 'orders.items + нормализация НДС', availability: 'full' },
    discount_pct: { code: 'discount_pct', label: '% скидки по заказу', source: 'orders.items.discountTotal', availability: 'full' },
    margin: { code: 'margin', label: 'Маржа (price − purchasePrice)', source: 'orders.items.purchasePrice', availability: 'partial' },
    okk_total_score: { code: 'okk_total_score', label: 'Скоринг качества ОКК', source: 'okk_order_scores.total_score', availability: 'full' },
    okk_script_score: { code: 'okk_script_score', label: '% соблюдения скрипта', source: 'okk_order_scores.script_score_pct', availability: 'full' },
    okk_first_contact: { code: 'okk_first_contact', label: 'Скорость первого контакта', source: 'okk_order_scores.lead_in_work_lt_1_day', availability: 'full' },
    okk_fields_filled: { code: 'okk_fields_filled', label: 'Заполнение ТЗ/обязательных полей', source: 'okk_order_scores.field_*/tz_received', availability: 'full' },
    conversion_incoming: { code: 'conversion_incoming', label: 'Входящие лиды (знаменатель конверсии)', source: 'salary_incoming_counts', availability: 'full' },
    duty_shifts: { code: 'duty_shifts', label: 'Дежурства', source: 'salary_duty', availability: 'full' },
    worked_days: { code: 'worked_days', label: 'Отработанные дни', source: 'salary_duty (worked_day)', availability: 'full' },
    team_revenue: { code: 'team_revenue', label: 'Выручка отдела', source: 'Σ revenue_no_vat по реестру', availability: 'full' },
    plan_personal: { code: 'plan_personal', label: 'Личный план (выручка без НДС)', source: 'salary_plan', availability: 'full' },
    plan_department: { code: 'plan_department', label: 'Общий план отдела', source: 'salary_plan', availability: 'full' },
    order_created_date: { code: 'order_created_date', label: 'Дата обращения (создания заказа)', source: 'orders.created_at', availability: 'full' },
    order_cancel: { code: 'order_cancel', label: 'Отмена заказа', source: 'orders.customFields.prichiny_otmeny', availability: 'full' },
};

export function isMetricAvailable(code: string): boolean {
    return (METRICS_CATALOG[code]?.availability ?? 'none') !== 'none';
}
