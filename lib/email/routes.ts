/**
 * Маршруты пересылки писем по отделам (Катерина). Адреса и имена отделов — в БД
 * (email_intake_routes), без хардкода. Сам факт пересылки гейтится флагом forward_enabled
 * (email_intake_config) — это «аварийный тормоз» / сухой прогон.
 */
import { supabase } from '@/utils/supabase';
import type { EmailRoute } from '@/lib/email/classify';

export interface DepartmentRoute {
    department: string; // accounting | logistics | legal
    label: string;      // человеческое имя (русское)
    email: string | null;
    isActive: boolean;
}

/** Карта отдел → маршрут (для логики и UI). */
export async function getDepartmentRoutes(): Promise<Record<string, DepartmentRoute>> {
    const map: Record<string, DepartmentRoute> = {};
    const { data } = await supabase
        .from('email_intake_routes')
        .select('department, label, email, is_active');
    for (const r of data || []) {
        map[r.department] = {
            department: r.department,
            label: r.label,
            email: r.email || null,
            isActive: r.is_active !== false,
        };
    }
    return map;
}

/** Включена ли реальная пересылка (false = сухой прогон). */
export async function isForwardEnabled(): Promise<boolean> {
    const { data } = await supabase.from('email_intake_config').select('forward_enabled').maybeSingle();
    return Boolean(data?.forward_enabled);
}

/**
 * Список исключений на создание заказов: адреса/домены отправителей, по письмам от которых
 * заказ НЕ заводим (тендерные робо-рассылки и т.п.). Хранится в БД (zero-hardcode).
 */
export async function getOrderBlocklist(): Promise<string[]> {
    const { data } = await supabase.from('email_intake_config').select('order_blocklist').maybeSingle();
    return Array.isArray(data?.order_blocklist) ? (data!.order_blocklist as string[]) : [];
}

/**
 * Отправитель в списке исключений? Запись с «@» — точный адрес; без «@» — домен
 * (совпадает сам домен и его поддомены). Регистр игнорируется.
 */
export function isSenderBlocked(fromEmail: string | null | undefined, blocklist: string[]): boolean {
    if (!fromEmail || !blocklist?.length) return false;
    const email = fromEmail.trim().toLowerCase();
    const domain = email.split('@')[1] || '';
    for (const raw of blocklist) {
        const entry = String(raw).trim().toLowerCase().replace(/^@/, '');
        if (!entry) continue;
        if (entry.includes('@')) {
            if (email === entry) return true;
        } else if (domain && (domain === entry || domain.endsWith('.' + entry))) {
            return true;
        }
    }
    return false;
}

/** Маршрут является отделом (пересылка), а не заявкой/пропуском. */
export function isDepartmentRoute(route: EmailRoute): boolean {
    return route === 'accounting' || route === 'logistics' || route === 'legal' || route === 'procurement';
}
