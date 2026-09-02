import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';
import { SETTINGS_SCHEMA, specFor } from '@/lib/sales-rop/settings-schema';

export const dynamic = 'force-dynamic';

// Настройки бота-РОПа: чтение и правка.
//
// До этого экрана 37 ключей правились только напрямую в базе, и это уже стоило
// нам расхождения: план месяца стоял в одном месте, а бот читал другое.

type Row = { key: string; value: string; comment: string | null };

async function loadRows(): Promise<Row[]> {
    const { data, error } = await supabase.from('sales_rop_settings').select('key, value, comment').order('key');
    if (error) throw new Error(error.message);
    return (data ?? []) as Row[];
}

// GET /api/sales-rop/settings — все настройки с человеческими названиями.
export async function GET() {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop'])) {
            return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
        }

        const rows = await loadRows();
        const items = rows.map((r) => ({ ...specFor(r.key), value: r.value ?? '', comment: r.comment ?? '' }));

        // Настройки из схемы, которых ещё нет в базе: показываем пустыми, чтобы
        // человек мог их завести, а не гадать, почему ручки нет.
        const known = new Set(rows.map((r) => r.key));
        for (const spec of SETTINGS_SCHEMA) {
            if (!known.has(spec.key)) items.push({ ...spec, value: '', comment: '' });
        }

        // Справочники — чтобы в интерфейсе стояли имена и названия статусов, а
        // не идентификаторы и слаги.
        const [{ data: mgrs }, { data: statuses }] = await Promise.all([
            supabase.from('managers').select('id, first_name, last_name, active').eq('active', true),
            supabase.from('statuses').select('code, name'),
        ]);

        return NextResponse.json({
            items,
            managers: ((mgrs ?? []) as any[])
                .map((m) => ({
                    id: Number(m.id),
                    name: [m.last_name, m.first_name].filter(Boolean).join(' ').trim() || `#${m.id}`,
                }))
                .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
            statuses: ((statuses ?? []) as any[])
                .map((s) => ({ code: String(s.code), name: String(s.name || s.code) }))
                .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

const PutSchema = z.object({
    changes: z.array(z.object({ key: z.string().min(1).max(64), value: z.string().max(2000) })).min(1).max(50),
});

// PUT /api/sales-rop/settings — сохранить изменённые значения.
export async function PUT(req: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop'])) {
            return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
        }

        const parsed = PutSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: 'Неверные данные формы' }, { status: 400 });
        }

        // Нагрузка — единственное значение, где опечатка бьёт по всему отделу
        // сразу: 10 вместо 1.0 завалит людей списком, который не сделать.
        for (const c of parsed.data.changes) {
            if (c.key !== 'load_factor') continue;
            const v = Number(c.value);
            if (!Number.isFinite(v) || v < 0.5 || v > 2) {
                return NextResponse.json({ error: 'Нагрузка задаётся числом от 0.5 до 2.0' }, { status: 400 });
            }
        }

        for (const c of parsed.data.changes) {
            const { error } = await supabase
                .from('sales_rop_settings')
                .upsert({ key: c.key, value: c.value }, { onConflict: 'key' });
            if (error) throw new Error(error.message);
        }

        return NextResponse.json({ ok: true, saved: parsed.data.changes.length });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
