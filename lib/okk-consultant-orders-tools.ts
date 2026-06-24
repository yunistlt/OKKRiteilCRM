import { supabase } from '@/utils/supabase';
import { getConfigForPeriod } from '@/lib/salary/config';
import type { SalaryToolContext } from '@/lib/salary/consultant-tools';

// Read-only «данные по заказам» tool for the "Семён" consultant (OpenAI function calling).
// Отвечает на вопросы вида «средний чек», «сколько заявок», «сумма заказов» за период.
//
// Две базы периода (date_basis):
//   - 'production' (по умолчанию для «успешных/переданных в производство») — заказ считается за
//     период по ДАТЕ ПЕРЕХОДА в закрывающий статус. Это и есть бизнес-смысл «успешного заказа»
//     в ОКК. Используется готовая salary_counted_orders(start, end, closing): она берёт дату
//     перехода из order_history_log (авторитетно) с фолбэками. Закрывающий статус — из конфига
//     зарплаты (config.closing_status.code), НЕ хардкод.
//   - 'created' — по дате создания заказа (orders.created_at), с опциональным фильтром по статусу.
//     Считается SQL-функцией okk_orders_aggregate.
//
// Приватность: роли admin/okk/rop видят все заявки и могут указать manager_id; остальные
// (manager/demo) видят только свои (по retailCrmManagerId из сессии).

type OrdersToolContext = SalaryToolContext & { userRole?: string };

const PRIVILEGED_ROLES = new Set(['admin', 'okk', 'rop']);

const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

const fmtMoney = (n: number): string => `${Math.round(n).toLocaleString('ru-RU')} ₽`;
const fmtDate = (d: Date): string => d.toISOString().slice(0, 10);

type ResolvedStatus = { code: string; name: string; group_name: string | null };

/**
 * Резолвит человеческий запрос статуса («производство», «отгружен», «выполнен») в коды.
 * Тянет активные статусы и фильтрует в JS — запрос приходит от модели и может содержать запятые/скобки,
 * которые сломали бы синтаксис PostgREST-фильтра .or().
 */
async function resolveStatuses(query: string): Promise<ResolvedStatus[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const { data } = await supabase
        .from('statuses')
        .select('code, name, group_name')
        .eq('is_active', true);
    const rows = (data as ResolvedStatus[]) || [];
    return rows.filter((s) =>
        (s.name || '').toLowerCase().includes(q)
        || (s.group_name || '').toLowerCase().includes(q)
        || (s.code || '').toLowerCase().includes(q),
    );
}

/** Окно периода [from; to). months_back приоритетнее явных дат. to по умолчанию — сейчас. */
function resolvePeriod(args: any): { from: Date | null; to: Date } {
    const now = new Date();
    const monthsBack = Number(args?.months_back);
    if (Number.isFinite(monthsBack) && monthsBack > 0) {
        const from = new Date();
        from.setMonth(from.getMonth() - Math.floor(monthsBack));
        return { from, to: now };
    }
    const parse = (s: unknown): Date | null => {
        if (typeof s !== 'string' || !s.trim()) return null;
        const d = new Date(s.trim());
        return Number.isNaN(d.getTime()) ? null : d;
    };
    const to = parse(args?.date_to);
    return { from: parse(args?.date_from), to: to || now };
}

/** Область видимости по менеджеру: privileged → опциональный manager_id (null=все); иначе только свои. */
function resolveScope(args: any, ctx: OrdersToolContext): { managerId: number | null } | { error: string } {
    const role = ctx.userRole || 'manager';
    if (PRIVILEGED_ROLES.has(role)) {
        const asked = Number(args?.manager_id);
        return { managerId: Number.isFinite(asked) && asked > 0 ? asked : null };
    }
    if (ctx.retailCrmManagerId == null) {
        return { error: 'У вас не привязан менеджер RetailCRM — данные по заявкам недоступны.' };
    }
    return { managerId: ctx.retailCrmManagerId };
}

function statsFrom(values: number[]) {
    const order_count = values.length;
    const total_sum = values.reduce((a, b) => a + b, 0);
    const avg_check = order_count ? total_sum / order_count : 0;
    return {
        order_count,
        total_sum,
        avg_check,
        min_check: order_count ? Math.min(...values) : 0,
        max_check: order_count ? Math.max(...values) : 0,
    };
}

/** Режим «успешные / переданные в производство»: дата перехода в закрывающий статус. */
async function aggregateProduction(args: any, scope: { managerId: number | null }): Promise<any> {
    const now = new Date();
    const config = await getConfigForPeriod(now.getFullYear(), now.getMonth() + 1);
    const closing = config.closing_status.code;

    const { from, to } = resolvePeriod(args);
    const start = from ? from.toISOString() : '1970-01-01T00:00:00.000Z';

    const { data, error } = await supabase.rpc('salary_counted_orders', {
        p_start: start,
        p_end: to.toISOString(),
        p_closing: closing,
    });
    if (error) {
        return { available: false, reason: `Ошибка расчёта успешных заявок: ${error.message}` };
    }

    let rows = (data as Array<{ manager_id: number | null; totalsumm: number | null }>) || [];
    if (scope.managerId != null) rows = rows.filter((r) => Number(r.manager_id) === scope.managerId);

    const st = statsFrom(rows.map((r) => num(r.totalsumm)));
    return {
        available: true,
        ...st,
        formatted: { avg_check: fmtMoney(st.avg_check), total_sum: fmtMoney(st.total_sum) },
        filters: {
            metric: 'успешные заявки (переданные в производство)',
            period_basis: 'дата перехода в производство',
            date_from: from ? fmtDate(from) : null,
            date_to: fmtDate(to),
            manager_id: scope.managerId,
            scope: scope.managerId != null ? 'один менеджер' : 'все менеджеры',
        },
        note: 'order_count — число заказов, переданных в производство (успешных) за период; avg_check — их средний чек (среднее totalsumm). Дата берётся по переходу в закрывающий статус из истории, а не по текущему статусу и не по дате создания. Озвучь период и область (свои/все).',
    };
}

/** Режим «по дате создания / текущему статусу». */
async function aggregateCreated(args: any, scope: { managerId: number | null }): Promise<any> {
    const statusQuery = typeof args?.status_query === 'string' ? args.status_query.trim() : '';
    let statusCodes: string[] | null = null;
    let resolvedStatuses: ResolvedStatus[] = [];
    if (statusQuery) {
        resolvedStatuses = await resolveStatuses(statusQuery);
        if (resolvedStatuses.length === 0) {
            return {
                available: false,
                reason: `Не нашёл статус по запросу «${statusQuery}» в справочнике. Уточните формулировку (например, «отгружен», «выполнен», «согласование»).`,
            };
        }
        statusCodes = resolvedStatuses.map((s) => s.code);
    }

    const { from, to } = resolvePeriod(args);
    const { data, error } = await supabase.rpc('okk_orders_aggregate', {
        p_status_codes: statusCodes,
        p_date_from: from ? from.toISOString() : null,
        p_date_to: to.toISOString(),
        p_manager_id: scope.managerId,
    });
    if (error) {
        return { available: false, reason: `Ошибка расчёта по заявкам: ${error.message}` };
    }

    const row = Array.isArray(data) ? data[0] : data;
    const avgCheck = num(row?.avg_check);
    const totalSum = num(row?.total_sum);
    const filters = {
        metric: 'заказы по дате создания',
        statuses: resolvedStatuses.map((s) => s.name),
        period_basis: 'дата создания заказа',
        date_from: from ? fmtDate(from) : null,
        date_to: fmtDate(to),
        manager_id: scope.managerId,
        scope: scope.managerId != null ? 'один менеджер' : 'все менеджеры',
    };

    return {
        available: true,
        order_count: num(row?.order_count),
        total_sum: totalSum,
        avg_check: avgCheck,
        min_check: num(row?.min_check),
        max_check: num(row?.max_check),
        formatted: { avg_check: fmtMoney(avgCheck), total_sum: fmtMoney(totalSum) },
        filters,
        note: 'Период считается по дате создания заказа. Если задан статус — это ТЕКУЩИЙ статус заявки, а не история переходов. Для вопросов «успешные / переданные в производство за период» используй date_basis="production". Озвучь применённые фильтры.',
    };
}

async function aggregateOrders(args: any, ctx: OrdersToolContext): Promise<any> {
    const scope = resolveScope(args, ctx);
    if ('error' in scope) return { available: false, reason: scope.error };

    const basis = args?.date_basis === 'created' ? 'created' : 'production';
    return basis === 'production' ? aggregateProduction(args, scope) : aggregateCreated(args, scope);
}

export const ORDERS_TOOLS = [
    {
        type: 'function' as const,
        function: {
            name: 'orders_aggregate',
            description: 'Агрегаты по заказам (заявкам) из CRM: количество, сумма, средний чек (avg), мин/макс по сумме заказа. ДВА режима (date_basis): "production" (по умолчанию) — успешные заявки, переданные в производство, за период по ДАТЕ ПЕРЕХОДА в производство (именно этот переход = успешный заказ); "created" — заказы по дате создания, с опциональным фильтром по статусу. Используй для вопросов «средний чек», «сколько заявок передано в производство», «сумма успешных заказов» за период. Менеджер получает данные только по своим заявкам.',
            parameters: {
                type: 'object',
                properties: {
                    date_basis: {
                        type: 'string',
                        enum: ['production', 'created'],
                        description: 'База периода. "production" — по дате передачи в производство (успешные заявки); используй для «переданных/отправленных в производство», «успешных», «завершённых» за период. "created" — по дате создания заказа. По умолчанию "production".',
                    },
                    months_back: {
                        type: 'integer',
                        description: 'За сколько последних месяцев считать. Напр. 3 = последние 3 месяца. Приоритетнее date_from/date_to.',
                    },
                    date_from: {
                        type: 'string',
                        description: 'Начало периода YYYY-MM-DD. Игнорируется, если задан months_back.',
                    },
                    date_to: {
                        type: 'string',
                        description: 'Конец периода YYYY-MM-DD. По умолчанию — сегодня.',
                    },
                    status_query: {
                        type: 'string',
                        description: 'Только для date_basis="created": человеческое название статуса/группы для фильтра (напр. «отгружен», «выполнен»). В режиме "production" игнорируется.',
                    },
                    manager_id: {
                        type: 'integer',
                        description: 'ID менеджера RetailCRM для фильтра. Доступно только ролям admin/okk/rop. Менеджер всегда видит только свои заявки.',
                    },
                },
            },
        },
    },
];

export async function executeOrdersTool(name: string, args: any, ctx: OrdersToolContext): Promise<any> {
    if (name === 'orders_aggregate') return aggregateOrders(args, ctx);
    return { available: false, reason: `Неизвестный инструмент: ${name}` };
}
