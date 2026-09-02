// Сборка расчётной ведомости ЗП ОП в Excel. Один источник для выгрузки по кнопке
// (/api/salary/export) и для отправки в бухгалтерию (/api/salary/send-to-accounting) —
// чтобы бухгалтер и РОП смотрели буквально один и тот же файл.
//
// Колонки НЕ зашиты: состав ведомости строится из фактических блоков схем периода
// (breakdown.blockContributions). Раньше шапка была фиксированной, из-за чего в файл
// попадали мёртвые колонки вроде «Дежурства» (в движке всегда 0) и не попадали
// реально начисленные блоки. Оформление — ExcelJS (SheetJS community не умеет стили).
import ExcelJS from 'exceljs';
import { supabase } from '@/utils/supabase';
import { listSchemes } from '@/lib/salary/schemes';
import { loadPeriodView } from '@/lib/salary/period-view';

export const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

const ORDER_TYPE_LABEL: Record<string, string> = { new: 'Новый', permanent: 'Постоянный' };
const fmtDateRu = (s?: string) => {
    if (!s) return '';
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ru-RU');
};

// Числовые форматы: разряды пробелом (закон «числа с разделителями разрядов»).
const MONEY_FMT = '# ##0 ₽';
const MULT_FMT = '0.00';

// Палитра — плоская, без градиентов (golds: Metro/High-Density).
const INK = 'FF1F2937';       // шапка
const GRID = 'FFD1D5DB';      // линии
const ZEBRA = 'FFF7F7F8';     // чётные строки
const TOTAL_BG = 'FFFFF3C4';  // «Итого к выплате» и строка ФОТ
const GROUP_BG = 'FFEDF2F7';  // подзаголовок групп колонок

export interface PayrollWorkbook {
    /** Готовый xlsx. ArrayBuffer — чтобы одинаково годился и для NextResponse, и для Blob в Telegram. */
    buffer: ArrayBuffer;
    filename: string;
    status: 'open' | 'closed';
    periodLabel: string;
    fot: number;
    managers: number;
}

interface BlockCol {
    code: string;
    name: string;
    kind: string;   // additive | multiplier | penalty
    group: string;  // base | premia | variable | flat | penalty
    isMultiplier: boolean;
}

// Порядок групп = порядок формулы: оклад → премия → переменная → фиксированные → удержания.
const GROUP_ORDER: Record<string, number> = { base: 0, premia: 1, variable: 2, flat: 3 };
const GROUP_TITLE: Record<string, string> = {
    base: 'Постоянная часть',
    premia: 'Премия',
    variable: 'Переменная часть',
    flat: 'Разовые начисления',
    penalty: 'Удержания',
};

/** Колонки-блоки — объединение по всем менеджерам периода, в порядке формулы. */
function collectBlockColumns(rows: any[]): BlockCol[] {
    const byCode = new Map<string, BlockCol>();
    for (const r of rows) {
        for (const c of (r.breakdown?.blockContributions ?? []) as any[]) {
            if (byCode.has(c.code)) continue;
            byCode.set(c.code, {
                code: c.code,
                name: c.name || c.code,
                kind: c.kind,
                group: c.kind === 'penalty' ? 'penalty' : (c.group || 'flat'),
                isMultiplier: c.kind === 'multiplier',
            });
        }
    }
    return Array.from(byCode.values()).sort((a, b) => {
        const ga = a.group === 'penalty' ? 9 : GROUP_ORDER[a.group] ?? 8;
        const gb = b.group === 'penalty' ? 9 : GROUP_ORDER[b.group] ?? 8;
        if (ga !== gb) return ga - gb;
        // Множитель — после аддитивных блоков своей группы: так читается формула.
        if (a.isMultiplier !== b.isMultiplier) return a.isMultiplier ? 1 : -1;
        return a.name.localeCompare(b.name, 'ru');
    });
}

function styleHeaderCell(cell: ExcelJS.Cell) {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
        top: { style: 'thin', color: { argb: INK } },
        left: { style: 'thin', color: { argb: INK } },
        bottom: { style: 'thin', color: { argb: INK } },
        right: { style: 'thin', color: { argb: INK } },
    };
}

function gridBorder(cell: ExcelJS.Cell) {
    cell.border = {
        top: { style: 'thin', color: { argb: GRID } },
        left: { style: 'thin', color: { argb: GRID } },
        bottom: { style: 'thin', color: { argb: GRID } },
        right: { style: 'thin', color: { argb: GRID } },
    };
}

/** Ведомость за период. null — период не рассчитан. */
export async function buildPayrollWorkbook(year: number, month: number): Promise<PayrollWorkbook | null> {
    // Открытый период — расчёт на лету; закрытый — снимок (единый источник).
    const view = await loadPeriodView(year, month);
    if (view.status === 'none') return null;
    const rows = [...(view.rows as any[])].sort((a, b) => a.manager_id - b.manager_id);

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
    const managerName = (id: number) => namesById.get(id) || `#${id}`;

    const periodLabel = `${MONTHS[month - 1]} ${year}`;
    const closed = view.status === 'closed';
    const blockCols = collectBlockColumns(rows);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'OKK ZMK';

    // ── Лист 1: ВЕДОМОСТЬ ────────────────────────────────────────────────────
    const ws = wb.addWorksheet('Ведомость', {
        views: [{ state: 'frozen', xSplit: 1, ySplit: 5 }],
        pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    const lastCol = 2 + blockCols.length + 1; // Менеджер + Схема + блоки + Итого
    const headerRow = 5;
    const groupRow = 4;

    ws.mergeCells(1, 1, 1, lastCol);
    const title = ws.getCell(1, 1);
    title.value = `Расчётная ведомость ЗП отдела продаж — ${periodLabel}`;
    title.font = { bold: true, size: 15 };
    title.alignment = { vertical: 'middle' };
    ws.getRow(1).height = 26;

    ws.mergeCells(2, 1, 2, lastCol);
    const sub = ws.getCell(2, 1);
    sub.value = `Период ${closed ? 'закрыт' : 'ОТКРЫТ — предварительный расчёт'} · менеджеров: ${rows.length}`;
    sub.font = { size: 10, color: { argb: closed ? 'FF6B7280' : 'FFB45309' }, italic: !closed };

    ws.getCell(headerRow, 1).value = 'Менеджер';
    ws.getCell(headerRow, 2).value = 'Схема (группа CRM)';
    blockCols.forEach((b, i) => {
        ws.getCell(headerRow, 3 + i).value = b.isMultiplier ? `${b.name} (коэф.)` : b.name;
    });
    const totalCol = lastCol;
    ws.getCell(headerRow, totalCol).value = 'Итого к выплате';

    // Шапка групп: объединяем соседние колонки одной группы.
    let gi = 0;
    while (gi < blockCols.length) {
        let gj = gi;
        while (gj + 1 < blockCols.length && blockCols[gj + 1].group === blockCols[gi].group) gj++;
        const from = 3 + gi;
        const to = 3 + gj;
        if (to > from) ws.mergeCells(groupRow, from, groupRow, to);
        const cell = ws.getCell(groupRow, from);
        cell.value = GROUP_TITLE[blockCols[gi].group] ?? '';
        cell.font = { bold: true, size: 10, color: { argb: 'FF374151' } };
        cell.alignment = { horizontal: 'center' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GROUP_BG } };
        for (let c = from; c <= to; c++) gridBorder(ws.getCell(groupRow, c));
        gi = gj + 1;
    }

    for (let c = 1; c <= lastCol; c++) styleHeaderCell(ws.getCell(headerRow, c));
    ws.getRow(headerRow).height = 42;

    let fot = 0;
    rows.forEach((r, idx) => {
        const rowIdx = headerRow + 1 + idx;
        const b = r.breakdown || {};
        const contribByCode = new Map<string, any>();
        for (const c of (b.blockContributions ?? []) as any[]) contribByCode.set(c.code, c);
        fot += Number(r.total) || 0;

        ws.getCell(rowIdx, 1).value = managerName(r.manager_id);
        ws.getCell(rowIdx, 2).value = (b.schemeCode ? schemeNameByCode.get(b.schemeCode) : '') || b.schemeCode || '';

        blockCols.forEach((bc, k) => {
            const cell = ws.getCell(rowIdx, 3 + k);
            const c = contribByCode.get(bc.code);
            if (!c) { cell.value = null; return; }
            if (bc.isMultiplier) {
                cell.value = Number(c.multiplier ?? 1);
                cell.numFmt = MULT_FMT;
            } else {
                cell.value = Number(c.amount) || 0;
                cell.numFmt = MONEY_FMT;
            }
            // Пояснение блока — во всплывающем комментарии: цифра остаётся проверяемой.
            if (c.explain) cell.note = String(c.explain).slice(0, 500);
        });

        const totalCell = ws.getCell(rowIdx, totalCol);
        totalCell.value = Number(r.total) || 0;
        totalCell.numFmt = MONEY_FMT;

        for (let c = 1; c <= lastCol; c++) {
            const cell = ws.getCell(rowIdx, c);
            gridBorder(cell);
            if (idx % 2 === 1 && c !== totalCol) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
            }
            if (c > 2) cell.alignment = { horizontal: 'right' };
        }
        totalCell.font = { bold: true };
        totalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_BG } };
        ws.getCell(rowIdx, 1).font = { bold: true };
    });

    // Итоговая строка — ФОТ отдела.
    const fotRow = headerRow + rows.length + 1;
    ws.mergeCells(fotRow, 1, fotRow, Math.max(2, totalCol - 1));
    const fotLabel = ws.getCell(fotRow, 1);
    fotLabel.value = 'ФОТ отдела за период';
    fotLabel.font = { bold: true, size: 12 };
    fotLabel.alignment = { horizontal: 'right', vertical: 'middle' };
    const fotCell = ws.getCell(fotRow, totalCol);
    fotCell.value = fot;
    fotCell.numFmt = MONEY_FMT;
    fotCell.font = { bold: true, size: 12 };
    fotCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_BG } };
    ws.getRow(fotRow).height = 22;
    for (let c = 1; c <= lastCol; c++) gridBorder(ws.getCell(fotRow, c));

    ws.getColumn(1).width = 26;
    ws.getColumn(2).width = 22;
    for (let c = 3; c <= lastCol; c++) ws.getColumn(c).width = 16;
    if (rows.length) {
        ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow + rows.length, column: lastCol } };
    }

    // ── Лист 2: ПОКАЗАТЕЛИ (то, из чего считались блоки) ─────────────────────
    const wsM = wb.addWorksheet('Показатели', { views: [{ state: 'frozen', ySplit: 1 }] });
    const mHeader = ['Менеджер', 'Новых заявок', 'Постоянных', 'Конверсия, %', 'Скоринг ОКК', 'Скидка, %', 'Маржа'];
    wsM.addRow(mHeader);
    for (let c = 1; c <= mHeader.length; c++) styleHeaderCell(wsM.getCell(1, c));
    wsM.getRow(1).height = 30;
    rows.forEach((r, idx) => {
        const b = r.breakdown || {};
        const row = wsM.addRow([
            managerName(r.manager_id),
            b.counts?.new ?? 0,
            b.counts?.permanent ?? 0,
            b.conversionPct ?? 0,
            b.qualityScore != null ? Math.round(b.qualityScore) : '',
            b.discountValue ?? '',
            Number(r.margin_info) || 0,
        ]);
        row.getCell(7).numFmt = MONEY_FMT;
        for (let c = 1; c <= mHeader.length; c++) {
            const cell = row.getCell(c);
            gridBorder(cell);
            if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
            if (c > 1) cell.alignment = { horizontal: 'right' };
        }
        row.getCell(1).font = { bold: true };
    });
    wsM.getColumn(1).width = 26;
    for (let c = 2; c <= mHeader.length; c++) wsM.getColumn(c).width = 15;

    // ── Лист 3: ЗАКАЗЫ (расшифровка засчитанного) ────────────────────────────
    const orderHeader = ['Менеджер', '№ заказа', 'Клиент', 'Тип', 'Сделок клиента', 'Сумма с НДС', 'Сумма без НДС', 'Скидка, %', 'Передан в произв.'];
    const wsO = wb.addWorksheet('Заказы', { views: [{ state: 'frozen', ySplit: 1 }] });
    wsO.addRow(orderHeader);
    for (let c = 1; c <= orderHeader.length; c++) styleHeaderCell(wsO.getCell(1, c));
    wsO.getRow(1).height = 30;
    let oIdx = 0;
    for (const r of rows) {
        const detail: any[] = Array.isArray(r.breakdown?.countedOrders) ? r.breakdown.countedOrders : [];
        for (const o of detail) {
            const row = wsO.addRow([
                managerName(r.manager_id),
                o.id,
                o.clientName || '',
                ORDER_TYPE_LABEL[o.type] ?? '',
                typeof o.deals === 'number' ? o.deals : '',
                Number(o.sum) || 0,
                Number(o.revenueNoVat) || 0,
                o.discountPct ?? '',
                fmtDateRu(o.enteredAt),
            ]);
            row.getCell(6).numFmt = MONEY_FMT;
            row.getCell(7).numFmt = MONEY_FMT;
            for (let c = 1; c <= orderHeader.length; c++) {
                const cell = row.getCell(c);
                gridBorder(cell);
                if (oIdx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
                if (c >= 5) cell.alignment = { horizontal: 'right' };
            }
            oIdx++;
        }
    }
    wsO.getColumn(1).width = 26;
    wsO.getColumn(3).width = 42;
    for (const c of [2, 4, 5, 6, 7, 8, 9]) wsO.getColumn(c).width = 16;
    if (oIdx > 0) wsO.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1 + oIdx, column: orderHeader.length } };

    const buffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    return {
        buffer,
        filename: `Ведомость_ЗП_${MONTHS[month - 1]}_${year}.xlsx`,
        status: closed ? 'closed' : 'open',
        periodLabel,
        fot,
        managers: rows.length,
    };
}
