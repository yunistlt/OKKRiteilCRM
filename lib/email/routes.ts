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

/** Маршрут является отделом (пересылка), а не заявкой/пропуском. */
export function isDepartmentRoute(route: EmailRoute): boolean {
    return route === 'accounting' || route === 'logistics' || route === 'legal' || route === 'procurement';
}
