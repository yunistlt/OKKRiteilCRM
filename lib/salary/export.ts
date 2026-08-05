// Сборка расчётной ведомости ЗП ОП в Excel. Один источник для выгрузки по кнопке
// (/api/salary/export) и для отправки в бухгалтерию (/api/salary/send-to-accounting) —
// чтобы бухгалтер и РОП смотрели буквально один и тот же файл.
import { supabase } from '@/utils/supabase';
import { listSchemes } from '@/lib/salary/schemes';
import { loadPeriodView } from '@/lib/salary/period-view';
import * as XLSX from 'xlsx';

export const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

const ORDER_TYPE_LABEL: Record<string, string> = { new: 'Новый', permanent: 'Постоянный' };
const fmtDateRu = (s?: string) => {
    if (!s) return '';
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ru-RU');
};

const toArrayBuffer = (buf: Buffer): ArrayBuffer =>
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

export interface PayrollWorkbook {
    /** Готовый xlsx. ArrayBuffer — чтобы одинаково годился и для NextResponse, и для Blob в Telegram. */
    buffer: ArrayBuffer;
    filename: string;
    /** Период не рассчитан вовсе — вызывающий отдаёт 404. */
    status: 'open' | 'closed';
    periodLabel: string;
    fot: number;
    managers: number;
}

/** Ведомость за период. null — период не рассчитан. */
export async function buildPayrollWorkbook(year: number, month: number): Promise<PayrollWorkbook | null> {
    // Открытый период — расчёт на лету; закрытый — снимок (единый источник).
    const view = await loadPeriodView(year, month);
    if (view.status === 'none') return null;
    const rows = view.rows as any[];

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

    const periodLabel = `${MONTHS[month - 1]} ${year}`;

    // Структура листа — повторяет дашборд (для сверки с гугл-таблицей)
    const header = [
        'Менеджер', 'Схема', 'Оклад', 'Премия за заявки', 'К_качества', 'Конв-бонус',
        'Скидка-бонус', 'К_команды', 'Дежурства', 'Итого к выплате',
        'Новых', 'Постоянных', 'Конверсия %', 'Скоринг ОКК', 'Скидка %', 'Маржа', 'Состав (блоки)',
    ];
    const aoa: any[][] = [
        [`Расчёт ЗП ОП — ${periodLabel} (${view.status === 'closed' ? 'закрыт' : 'открыт'})`],
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
    ws['!cols'] = header.map((_h, i) => ({ wch: i === 0 ? 22 : 14 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `ЗП ${periodLabel}`);

    // Лист «Заказы» — детализация засчитанных заказов с клиентом и числом сделок
    const orderHeader = ['Менеджер', '№ заказа', 'Клиент', 'Тип', 'Сделок клиента', 'Сумма', 'Скидка %', 'Передан в произв.'];
    const ordersAoa: any[][] = [orderHeader];
    for (const r of rows.sort((a, b) => a.manager_id - b.manager_id)) {
        const b = r.breakdown || {};
        const detail: any[] = Array.isArray(b.countedOrders) ? b.countedOrders : [];
        for (const o of detail) {
            ordersAoa.push([
                namesById.get(r.manager_id) || `#${r.manager_id}`,
                o.id,
                o.clientName || '',
                ORDER_TYPE_LABEL[o.type] ?? '',
                typeof o.deals === 'number' ? o.deals : '',
                Number(o.sum) || 0,
                o.discountPct ?? '',
                fmtDateRu(o.enteredAt),
            ]);
        }
    }
    if (ordersAoa.length > 1) {
        const wsOrders = XLSX.utils.aoa_to_sheet(ordersAoa);
        wsOrders['!cols'] = [{ wch: 22 }, { wch: 12 }, { wch: 40 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 16 }];
        XLSX.utils.book_append_sheet(wb, wsOrders, 'Заказы');
    }

    return {
        buffer: toArrayBuffer(XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' })),
        filename: `salary_${year}_${String(month).padStart(2, '0')}.xlsx`,
        status: view.status === 'closed' ? 'closed' : 'open',
        periodLabel,
        fot,
        managers: rows.length,
    };
}
