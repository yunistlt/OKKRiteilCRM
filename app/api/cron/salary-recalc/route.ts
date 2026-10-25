import { isCronHeaderAuthorized } from '@/lib/cron-auth';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { recalcAndPersist } from '@/lib/salary/engine';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const WORKER_KEY = 'salary.recalc';

/**
 * Пересчёт открытого периода зарплаты по расписанию.
 *
 * Решение владельца 16.10.2026: считать раз в три часа. До этого зарплата
 * пересчитывалась ТОЛЬКО по кнопке на /salary, и цифры открытого периода жили
 * столько, сколько прошло с последнего нажатия: на 16.10 октябрьский расчёт был
 * от 12-го числа, четырёхдневной давности. Человек, открывая свою зарплату,
 * видел устаревшие суммы и не мог этого понять.
 *
 * Кнопка остаётся: когда нужно увидеть результат сейчас, ждать до трёх часов
 * никто не должен.
 *
 * Считается только ОТКРЫТЫЙ период. Закрытый не трогаем: он утверждён и ушёл в
 * бухгалтерию, пересчёт задним числом менял бы выплаченное.
 *
 * Замер 16.10.2026: пересчёт занимает 14 секунд при лимите в пять минут.
 */
export async function GET(req: NextRequest) {
    if (!isCronHeaderAuthorized(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const началось = Date.now();

    try {
        const { data: период } = await supabase
            .from('salary_period')
            .select('year, month')
            .eq('status', 'open')
            .order('year', { ascending: false })
            .order('month', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (!период) {
            return NextResponse.json({ ok: true, пропущено: 'открытого периода нет' });
        }

        const { year, month } = период as any;
        await recalcAndPersist(Number(year), Number(month), 'по расписанию');

        const итог = { период: `${year}-${String(month).padStart(2, '0')}`, заняло_мс: Date.now() - началось };
        await recordWorkerSuccess(WORKER_KEY, итог);
        return NextResponse.json({ ok: true, ...итог });
    } catch (e: any) {
        await recordWorkerFailure(WORKER_KEY, e?.message || String(e));
        return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
    }
}
