import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';
import { listSchemes } from '@/lib/salary/schemes';
import * as XLSX from 'xlsx';

export const dynamic = 'force-dynamic';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

// GET /api/salary/export?period=YYYY-MM — выгрузка расчёта в Excel
export async function GET(req: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop'])) {
            return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
        }
        const { searchParams } = new URL(req.url);
        const period = searchParams.get('period') || '';
        const m = period.match(/^(\d{4})-(\d{1,2})$/);
        if (!m) return NextResponse.json({ error: 'period в формате YYYY-MM' }, { status: 400 });
        const year = Number(m[1]);
        const month = Number(m[2]);

        const { data: periodRow } = await supabase
            .from('salary_period')
            .select('id,status')
            .eq('year', year)
            .eq('month', month)
            .maybeSingle();
        if (!periodRow) return NextResponse.json({ error: 'Период не рассчитан' }, { status: 404 });

        const { data: calcRows } = await supabase.from('salary_calc').select('*').eq('period_id', periodRow.id);
        const rows = (calcRows as any[]) ?? [];

        // Имя схемы (= группа из RetailCRM), а не код роли — закон «только человеческий язык»
        const asOf = `${year}-${String(month).padStart(2, '0')}-01`;
        const schemeNameByCode = new Map<string, string>();
        for (const s of await listSchemes(asOf)) schemeNameByCode.set(s.code, s.name);

        const managerIds = Array.from(new Set(rows.map((r) => r.manager_id)));
        const namesById = new Map<number, string>();
        if (managerIds.length) {
            const { data: mgrs } = await supabase.from('managers').select('id,first_name,last_name').in('id', managerIds);
            for (const mgr of (mgrs as any[]) ?? []) {
                namesById.set(mgr.id, [mgr.first_name, mgr.last_name].filter(Boolean).join(' ') || `#${mgr.id}`);
            }
        }

        // Структура листа — повторяет дашборд (для сверки с гугл-таблицей)
        const header = [
            'Менеджер', 'Схема', 'Оклад', 'Премия за заявки', 'К_качества', 'Конв-бонус',
            'Скидка-бонус', 'К_команды', 'Дежурства', 'Итого к выплате',
            'Новых', 'Постоянных', 'Конверсия %', 'Скоринг ОКК', 'Скидка %', 'Маржа', 'Состав (блоки)',
        ];
        const aoa: any[][] = [
            [`Расчёт ЗП ОП — ${MONTHS[month - 1]} ${year} (${periodRow.status === 'closed' ? 'закрыт' : 'открыт'})`],
            [],
            header,
        ];
        let fot = 0;
        for (const r of rows.sort((a, b) => a.manager_id - b.manager_id)) {
            const b = r.breakdown || {};
            fot += Number(r.total) || 0;
            const composition = Array.isArray(b.blockContributions)
                ? b.blockContributions.map((c: any) => `${c.name}: ${c.kind === 'multiplier' ? '×' + c.multiplier : Math.round(c.amount) + ' ₽'}`).join('; ')
                : '';
            aoa.push([
                namesById.get(r.manager_id) || `#${r.manager_id}`,
                (b.schemeCode ? schemeNameByCode.get(b.schemeCode) : '') || b.schemeCode || '',
                Number(r.oklad), Number(r.premia_zayavki), Number(r.k_quality), Number(r.conv_bonus),
                Number(r.discount_bonus), Number(r.k_team), Number(r.duty_pay), Number(r.total),
                b.counts?.new ?? 0, b.counts?.permanent ?? 0,
                b.conversionPct ?? 0, b.qualityScore != null ? Math.round(b.qualityScore) : '', b.discountValue ?? '', Number(r.margin_info) || 0,
                composition,
            ]);
        }
        aoa.push([]);
        aoa.push(['ФОТ отдела', '', '', '', '', '', '', '', '', fot]);

        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = header.map((h, i) => ({ wch: i === 0 ? 22 : 14 }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, `ЗП ${MONTHS[month - 1]} ${year}`);
        const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });

        return new NextResponse(buf, {
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="salary_${year}_${String(month).padStart(2, '0')}.xlsx"`,
            },
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
