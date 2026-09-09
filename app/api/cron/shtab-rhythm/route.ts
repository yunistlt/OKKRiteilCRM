import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { weekStart } from '@/lib/shtab/tamara';
import { executeShtabTool } from '@/lib/shtab/tamara-tools';
import { upsertRhythm } from '@/lib/shtab/google/calendar';
import { googleConfigured } from '@/lib/shtab/google/oauth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// GET /api/cron/shtab-rhythm — обновляет повестку планёрок ритма.
//
// Раз в неделю, сразу после понедельничной сводки. Обновляется ТОЛЬКО повестка:
// время встреч не трогается никогда. Смысл ритма в том, что планёрка не двигается
// — отменённая дважды встреча перестаёт существовать, и помощник, вежливо
// переносящий её при каждом конфликте, разрушает ровно то, ради чего она заведена.
//
// Повестка собирается ЗДЕСЬ, в коде, из инструмента shtab_programs, а не пишется
// моделью: она должна быть одинаковой всю неделю, иначе на неё нельзя сослаться.

function ensureAuthorized(req: NextRequest) {
    const authHeader = req.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        throw new Error('Unauthorized');
    }
}

/** Строка про одну программу: главная задача и как идут её числа. */
function programLine(p: any): string {
    const numbers = (p.proizvodstvennye ?? []).map((t: any) => {
        const target = t.target || (t.source_note ? `не замерено (из: ${t.source_note})` : 'число не названо');
        const fact = t.fact ? `, факт ${t.fact}` : '';
        return `${t.text} — ${target}${fact}`;
    });
    const head = `${p.block ?? 'без блока'}: ${p.main_task ?? 'главная задача не сформулирована'}`;
    const who = p.manager ? ` (${p.manager})` : ' (руководитель не назначен)';
    const steps = ` Шаги: ${p.rabochih_sdelano} из ${p.rabochih_vsego}.`;
    return `${head}${who}.${steps}${numbers.length > 0 ? ' ' + numbers.join('; ') : ' Производственных задач нет — программа выполняется понарошку.'}`;
}

export async function GET(req: NextRequest) {
    try {
        ensureAuthorized(req);
    } catch {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        if (!googleConfigured()) {
            return NextResponse.json({ ok: true, skipped: 'Google Calendar не настроен' });
        }

        const { data: token } = await supabase.from('shtab_google_token').select('id').eq('id', 1).maybeSingle();
        if (!token) {
            return NextResponse.json({ ok: true, skipped: 'календарь не подключён' });
        }

        const state = (await executeShtabTool('shtab_programs', {})) as any;
        if (state?.available === false) {
            return NextResponse.json({ ok: false, error: state.reason }, { status: 502 });
        }

        const lines = (state.programs ?? []).map(programLine);
        const results = await upsertRhythm({
            weekStartIso: weekStart(new Date()),
            // Часы по умолчанию: ежедневная в начале смены, недельная сразу после
            // понедельничной сводки, месячная и квартальная с утра.
            hours: { daily: 8, weekly: 9, monthly: 9, quarterly: 9 },
            programLines: lines,
        });

        return NextResponse.json({
            ok: true,
            week: weekStart(new Date()),
            programs: lines.length,
            events: results.map((r) => ({ [r.code]: r.action })),
        });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
