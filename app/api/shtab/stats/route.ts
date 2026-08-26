import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { NON_INCOME_STATUSES, monthlyIncome, monthsAgo } from '@/lib/shtab/income';
import type { IncomeRow } from '@/lib/shtab/income';

export const dynamic = 'force-dynamic';

// GET /api/shtab/stats — ряды статистик, у которых есть живой источник.
//
// Сейчас такая ровно одна: приход группы по месяцам из point_payments. Остальные
// метрики Пульта остаются заглушками — см. app/shtab/stats.ts, там у каждой
// подписан будущий источник.
//
// Маршрут не падает целиком из-за одной метрики: если запрос по ряду не удался,
// метрика уезжает в errors, а карточка честно показывает «источник не отвечает».

/** Сколько месяцев тянем: XmR нужно не меньше двенадцати точек, берём с запасом. */
const MONTHS_BACK = 24;

export async function GET(req: NextRequest) {
    const session = await getSession(req);
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const series: Record<string, number[]> = {};
    const errors: Record<string, string> = {};

    try {
        const since = monthsAgo(MONTHS_BACK, new Date());
        const { data, error } = await supabase
            .from('point_payments')
            .select('payment_date, amount_kopecks')
            .not('status', 'in', `(${NON_INCOME_STATUSES.join(',')})`)
            .gte('payment_date', since)
            .order('payment_date');
        if (error) throw new Error(error.message);

        const points = monthlyIncome((data ?? []) as IncomeRow[]);
        // Текущий месяц ещё не закончился — его точка сравнивалась бы с полными
        // месяцами и выглядела бы провалом. Отбрасываем.
        const currentMonth = new Date().toISOString().slice(0, 7);
        series.income = points.filter((p) => p.month < currentMonth).map((p) => p.rubles / 1_000_000);
    } catch (e: any) {
        errors.income = e.message;
    }

    return NextResponse.json({ series, errors });
}
