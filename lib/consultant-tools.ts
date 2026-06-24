import { SALARY_TOOLS, executeSalaryTool, type SalaryToolContext } from '@/lib/salary/consultant-tools';
import { RATING_TOOLS, executeRatingTool } from '@/lib/okk-consultant-rating-tools';
import { ORDERS_TOOLS, executeOrdersTool } from '@/lib/okk-consultant-orders-tools';

// Aggregates the consultant's analytical tools (OpenAI function calling):
// - calc: safe arithmetic (no eval) so the LLM never does mental math
// - orders tools: orders_aggregate (количество/сумма/средний чек заказов по статусу и периоду)
// - salary tools: get_my_salary / orders_to_reach / simulate_salary (any salary what-if)
// - rating tools: get_my_rating / how_to_improve_my_rating
// calc и orders_aggregate доступны всегда (orders сам ограничивает область по роли);
// salary/rating tools привязаны к менеджеру сессии.

export type ConsultantToolContext = SalaryToolContext & { userRole?: string };

// ── Safe arithmetic evaluator (recursive descent, no eval/Function) ──────────

const FUNCS: Record<string, (args: number[]) => number> = {
    min: (a) => Math.min(...a),
    max: (a) => Math.max(...a),
    abs: (a) => Math.abs(a[0]),
    round: (a) => (a.length > 1 ? Math.round(a[0] * 10 ** a[1]) / 10 ** a[1] : Math.round(a[0])),
    ceil: (a) => Math.ceil(a[0]),
    floor: (a) => Math.floor(a[0]),
    sqrt: (a) => Math.sqrt(a[0]),
    pow: (a) => Math.pow(a[0], a[1]),
};

function evalExpression(expr: string, variables: Record<string, number>): number {
    if (expr.length > 500) throw new Error('Слишком длинное выражение.');
    let pos = 0;
    const s = expr;

    const skipWs = () => { while (pos < s.length && /\s/.test(s[pos])) pos += 1; };
    const peek = () => { skipWs(); return s[pos]; };

    function parseExpr(): number {
        let value = parseTerm();
        for (;;) {
            const op = peek();
            if (op === '+') { pos += 1; value += parseTerm(); }
            else if (op === '-') { pos += 1; value -= parseTerm(); }
            else break;
        }
        return value;
    }
    function parseTerm(): number {
        let value = parseFactor();
        for (;;) {
            const op = peek();
            if (op === '*') { pos += 1; value *= parseFactor(); }
            else if (op === '/') { pos += 1; value /= parseFactor(); }
            else if (op === '%') { pos += 1; value %= parseFactor(); }
            else break;
        }
        return value;
    }
    function parseFactor(): number {
        const c = peek();
        if (c === '-') { pos += 1; return -parseFactor(); }
        if (c === '+') { pos += 1; return parseFactor(); }
        return parsePrimary();
    }
    function parsePrimary(): number {
        skipWs();
        const c = s[pos];
        if (c === '(') {
            pos += 1;
            const v = parseExpr();
            if (peek() !== ')') throw new Error('Ожидалась )');
            pos += 1;
            return v;
        }
        // number
        const numMatch = /^\d+(\.\d+)?/.exec(s.slice(pos));
        if (numMatch) { pos += numMatch[0].length; return Number(numMatch[0]); }
        // identifier (function call or variable)
        const idMatch = /^[a-zA-Zа-яёА-ЯЁ_][a-zA-Zа-яёА-ЯЁ0-9_]*/.exec(s.slice(pos));
        if (idMatch) {
            const name = idMatch[0];
            pos += name.length;
            if (peek() === '(') {
                pos += 1;
                const args: number[] = [];
                if (peek() !== ')') {
                    args.push(parseExpr());
                    while (peek() === ',') { pos += 1; args.push(parseExpr()); }
                }
                if (peek() !== ')') throw new Error('Ожидалась )');
                pos += 1;
                const fn = FUNCS[name];
                if (!fn) throw new Error(`Неизвестная функция: ${name}`);
                return fn(args);
            }
            if (name in variables && Number.isFinite(variables[name])) return variables[name];
            throw new Error(`Неизвестная переменная: ${name}`);
        }
        throw new Error(`Не разобрать выражение у позиции ${pos}`);
    }

    const result = parseExpr();
    skipWs();
    if (pos < s.length) throw new Error(`Лишние символы: «${s.slice(pos)}»`);
    if (!Number.isFinite(result)) throw new Error('Результат не число.');
    return result;
}

function executeCalc(args: any): any {
    const expression = String(args?.expression || '').trim();
    if (!expression) return { ok: false, error: 'Пустое выражение.' };
    const variables: Record<string, number> = {};
    if (args?.variables && typeof args.variables === 'object') {
        for (const [k, v] of Object.entries(args.variables)) {
            const n = Number(v);
            if (Number.isFinite(n)) variables[k] = n;
        }
    }
    try {
        const value = evalExpression(expression, variables);
        return { ok: true, expression, value: Math.round(value * 1e6) / 1e6 };
    } catch (e: any) {
        return { ok: false, error: e?.message || 'Ошибка вычисления.' };
    }
}

const CALC_TOOL = {
    type: 'function' as const,
    function: {
        name: 'calc',
        description: 'Безопасный калькулятор для произвольной арифметики (+ - * / %, скобки, min/max/round/ceil/floor/abs/sqrt/pow и переменные). Используй для любых числовых вычислений и сравнений, чтобы не считать в уме.',
        parameters: {
            type: 'object',
            properties: {
                expression: { type: 'string', description: 'Арифметическое выражение, напр. "41750 + 10*900" или "(a-b)/c".' },
                variables: { type: 'object', description: 'Опционально: значения переменных, напр. {"a": 100000, "b": 41750}.' },
            },
            required: ['expression'],
        },
    },
};

const SALARY_NAMES = new Set(SALARY_TOOLS.map((t) => t.function.name));
const RATING_NAMES = new Set(RATING_TOOLS.map((t) => t.function.name));
const ORDERS_NAMES = new Set(ORDERS_TOOLS.map((t) => t.function.name));

/** Набор инструментов для tool-loop. calc и orders_aggregate — всегда; зарплата/рейтинг — при наличии менеджера. */
export function buildConsultantTools(ctx: ConsultantToolContext) {
    const tools: any[] = [CALC_TOOL, ...ORDERS_TOOLS];
    if (ctx.retailCrmManagerId != null) {
        tools.push(...SALARY_TOOLS, ...RATING_TOOLS);
    }
    return tools;
}

export async function executeConsultantTool(name: string, args: any, ctx: ConsultantToolContext): Promise<any> {
    if (name === 'calc') return executeCalc(args);
    if (ORDERS_NAMES.has(name)) return executeOrdersTool(name, args, ctx);
    if (SALARY_NAMES.has(name)) return executeSalaryTool(name, args, ctx);
    if (RATING_NAMES.has(name)) return executeRatingTool(name, args, ctx);
    return { available: false, reason: `Неизвестный инструмент: ${name}` };
}
