import { z } from 'zod';
import type { ManagerMetrics } from '@/lib/salary/metrics';

// ============================================================================
// Модель «бонус-блока». Блок — декларативный дескриптор + чистая compute().
// Блок НЕ знает итоговую формулу: он возвращает вклад с ролью композиции (kind)
// и областью множителя (multiplierScope). Сборку в формулу делает compose().
// Все числа мотивации приходят в params (из БД); метод расчёта — в коде.
// ============================================================================

export type BlockKind = 'base' | 'premia' | 'variable' | 'multiplier' | 'penalty';

// Аддитивный «ящик», в который попадает вклад блока (для kind != 'multiplier').
//  base    — оклад (raw, без множителей)
//  premia  — премия за заявки (множится К_качества, затем К_команды)
//  variable— конв/скидка и пр. (множится К_команды)
//  flat    — разовые/SPIFF/план-бонусы (raw, не множатся)
//  duty    — дежурства (raw)
export type CompositionGroup = 'base' | 'premia' | 'variable' | 'flat' | 'duty';

// Что множит блок-множитель.
//  premia          — только премию (К_качества)
//  variableBracket — всю переменную скобку (К_команды, гейт по плану)
export type MultiplierScope = 'premia' | 'variableBracket';

export interface DataFill {
    required: number; // сколько объектов в принципе требуют показатель
    present: number; // у скольких показатель заполнен
    pct: number; // present/required (1, если required = 0)
}

export interface BlockComputeContext {
    year: number;
    month: number;
    businessDays: number;
    teamRevenueNoVat: number;
    personalPlanTarget: number | null;
    departmentPlanTarget: number | null;
    managerGrade: number | null; // текущий грейд менеджера на период (null = не назначен)
    categoryNames?: Record<string, string>; // код категории RetailCRM → человеческое имя (для explain)
}

export interface BlockResult {
    amount: number; // ₽ для аддитивных/штрафных/базовых; 0 для чистых множителей
    multiplier?: number; // для kind === 'multiplier'
    explain: string; // человекочитаемая строка для отчёта
    dataFill: DataFill;
}

export interface BonusBlock<P = any> {
    code: string;
    name: string; // русское название
    methodology: string; // методика расчёта (текст для каталога/тултипа)
    kind: BlockKind;
    group: CompositionGroup; // значим для аддитивных/штрафных
    multiplierScope?: MultiplierScope; // обязателен для kind === 'multiplier'
    requiredMetrics: string[]; // коды из metrics-catalog (структурный гейт)
    paramSchema: z.ZodType<P>;
    compute(m: ManagerMetrics, params: P, ctx: BlockComputeContext): BlockResult;
}

// Назначенный блок в схеме/карточке менеджера: код + параметры (из БД).
export interface BlockInstance {
    code: string;
    params: any;
}

// Итоговый вклад блока — кладётся в breakdown.blockContributions (отчёт/экспорт).
export interface BlockContribution {
    code: string;
    name: string;
    kind: BlockKind;
    group: CompositionGroup;
    multiplierScope?: MultiplierScope;
    amount: number;
    multiplier?: number;
    explain: string;
    dataFill: DataFill;
}

export const fullFill = (required = 0): DataFill => ({ required, present: required, pct: 1 });
