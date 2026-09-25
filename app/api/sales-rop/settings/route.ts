import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';
import { SETTINGS_SCHEMA, specFor } from '@/lib/sales-rop/settings-schema';
import { assertSalesRopValue } from '@/lib/settings-registry/sales-rop';

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
        // Только активные сущности: в CRM 195 статусов, живых из них 62 —
        // остальные это история («Цех-успех», старые схемы работы). Предлагать
        // их к выбору значит предлагать настроить то, чего больше не бывает.
        const [{ data: mgrs }, { data: statuses }, { data: dict }, { data: working }] = await Promise.all([
            supabase.from('managers').select('id, first_name, last_name, active').eq('active', true),
            supabase.from('statuses').select('code, name, is_active'),
            supabase.from('retailcrm_dictionaries').select('item_code, item_name, active').eq('entity_type', 'status'),
            supabase.from('status_settings').select('code, is_working').eq('is_working', true),
        ]);

        const fromCrm = new Map(((dict ?? []) as any[]).map((d) => [String(d.item_code), d]));
        const isWorking = new Set(((working ?? []) as any[]).map((r) => String(r.code)));

        // Личная нагрузка живёт колонкой в sales_rop_manager, а не ключом в
        // настройках: она привязана к человеку, и ключ «load_factor_249»
        // пришлось бы заводить руками на каждого нового сотрудника.
        const { data: ropManagers } = await supabase
            .from('sales_rop_manager')
            .select('manager_id, load_factor, is_active')
            .eq('is_active', true);

        return NextResponse.json({
            items,
            managerLoads: ((ropManagers ?? []) as any[]).map((r) => ({
                managerId: Number(r.manager_id),
                loadFactor: r.load_factor === null || r.load_factor === undefined ? '' : String(r.load_factor),
            })),
            managers: ((mgrs ?? []) as any[])
                .map((m) => ({
                    id: Number(m.id),
                    name: [m.last_name, m.first_name].filter(Boolean).join(' ').trim() || `#${m.id}`,
                }))
                .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
            statuses: ((statuses ?? []) as any[])
                .map((s) => {
                    const crm = fromCrm.get(String(s.code));
                    return {
                        code: String(s.code),
                        // Название — из CRM, она источник правды для справочников.
                        name: String(crm?.item_name || s.name || s.code),
                        // Активность тоже из CRM; своя колонка — запасной ответ.
                        active: crm ? Boolean(crm.active) : Boolean(s.is_active),
                        // Бот вообще смотрит только на рабочие статусы. Галочка
                        // на нерабочем ничего не делает, и это должно быть видно.
                        working: isWorking.has(String(s.code)),
                    };
                })
                .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

const PutSchema = z.object({
    changes: z.array(z.object({ key: z.string().min(1).max(64), value: z.string().max(2000) })).max(50).default([]),
    /** Личная нагрузка: пустая строка — «как у отдела». */
    managerLoads: z
        .array(z.object({ managerId: z.number().int().positive(), loadFactor: z.string().max(10) }))
        .max(50)
        .optional(),
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

        // Проверка одна на все пути к настройке: сюда ходит этот экран, а через
        // реестр настроек — предложения Тамары. Проверка, стоящая на одном
        // пути, — это проверка, которую второй путь обходит.
        try {
            for (const c of parsed.data.changes) assertSalesRopValue(c.key, c.value);
        } catch (e: any) {
            return NextResponse.json({ error: e.message }, { status: 400 });
        }

        for (const c of parsed.data.changes) {
            const { error } = await supabase
                .from('sales_rop_settings')
                .upsert({ key: c.key, value: c.value }, { onConflict: 'key' });
            if (error) throw new Error(error.message);
        }

        for (const m of parsed.data.managerLoads ?? []) {
            const raw = m.loadFactor.trim();
            // Пусто — значит «как у отдела»: стираем личный множитель, а не
            // ставим единицу. Единица — это решение, пустота — его отсутствие.
            if (raw === '') {
                const { error } = await supabase
                    .from('sales_rop_manager')
                    .update({ load_factor: null, updated_at: new Date().toISOString() })
                    .eq('manager_id', m.managerId);
                if (error) throw new Error(error.message);
                continue;
            }
            try {
                assertSalesRopValue('load_factor', raw);
            } catch (e: any) {
                return NextResponse.json({ error: e.message }, { status: 400 });
            }
            const { error } = await supabase
                .from('sales_rop_manager')
                .update({ load_factor: Number(raw), updated_at: new Date().toISOString() })
                .eq('manager_id', m.managerId);
            if (error) throw new Error(error.message);
        }

        return NextResponse.json({
            ok: true,
            saved: parsed.data.changes.length + (parsed.data.managerLoads?.length ?? 0),
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
