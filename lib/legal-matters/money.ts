// Деньги по делу.
//
// ЗАКОН проекта: любое названное число раскладывается до исходных данных по
// первому вопросу. Поэтому риск возвращается не числом, а числом ВМЕСТЕ со
// слагаемыми — интерфейс раскрывает их по клику, не пересчитывая ничего сам.
//
// Русских подписей здесь нет: слагаемое отдаётся кодом поля, название берётся
// из справочника legal_matter_dictionaries (kind='money_field').
import type { LegalMatter, MatterMoneyField, MatterSide } from './types';

export type RiskPart = {
  field: MatterMoneyField;
  kopecks: number;
  /** true — прибавляем, false — вычитаем. Знак показываем в интерфейсе. */
  adds: boolean;
};

export type RiskBreakdown = {
  side: MatterSide;
  totalKopecks: number;
  parts: RiskPart[];
};

function value(matter: Partial<LegalMatter>, field: MatterMoneyField): number {
  const raw = matter[field];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

/**
 * Сколько денег на кону.
 *
 * Считается по-разному с двух сторон спора, и это не формальность:
 * — с нас требуют: риск это потенциальная потеря (требование + неустойка +
 *   убытки + наши расходы), уже урегулированное и выплаченное вычитается;
 * — требуем мы: риск это недополученное (наше требование + неустойка + убытки),
 *   минус взысканное и урегулированное; госпошлина и судебные расходы прибавляются,
 *   потому что они уже потрачены и вернутся только при выигрыше.
 *
 * Отрицательным результат не бывает: если взыскали больше требования,
 * на кону ноль, а не «минус».
 */
export function calcFinancialRisk(matter: Partial<LegalMatter>): RiskBreakdown {
  const side: MatterSide = matter.matter_side === 'claimant' ? 'claimant' : 'respondent';

  const parts: RiskPart[] = side === 'respondent'
    ? [
        { field: 'claim_amount_kopecks', kopecks: value(matter, 'claim_amount_kopecks'), adds: true },
        { field: 'penalty_kopecks', kopecks: value(matter, 'penalty_kopecks'), adds: true },
        { field: 'damages_kopecks', kopecks: value(matter, 'damages_kopecks'), adds: true },
        { field: 'state_duty_kopecks', kopecks: value(matter, 'state_duty_kopecks'), adds: true },
        { field: 'court_costs_kopecks', kopecks: value(matter, 'court_costs_kopecks'), adds: true },
        { field: 'settled_amount_kopecks', kopecks: value(matter, 'settled_amount_kopecks'), adds: false },
        { field: 'paid_out_kopecks', kopecks: value(matter, 'paid_out_kopecks'), adds: false },
      ]
    : [
        { field: 'our_claim_amount_kopecks', kopecks: value(matter, 'our_claim_amount_kopecks'), adds: true },
        { field: 'penalty_kopecks', kopecks: value(matter, 'penalty_kopecks'), adds: true },
        { field: 'damages_kopecks', kopecks: value(matter, 'damages_kopecks'), adds: true },
        { field: 'state_duty_kopecks', kopecks: value(matter, 'state_duty_kopecks'), adds: true },
        { field: 'court_costs_kopecks', kopecks: value(matter, 'court_costs_kopecks'), adds: true },
        { field: 'recovered_kopecks', kopecks: value(matter, 'recovered_kopecks'), adds: false },
        { field: 'settled_amount_kopecks', kopecks: value(matter, 'settled_amount_kopecks'), adds: false },
      ];

  const used = parts.filter((part) => part.kopecks > 0);
  const total = used.reduce((sum, part) => sum + (part.adds ? part.kopecks : -part.kopecks), 0);

  return { side, totalKopecks: Math.max(0, total), parts: used };
}

/** Сумма риска по набору дел — для плитки руководителя. */
export function sumFinancialRisk(matters: Array<Partial<LegalMatter>>): number {
  return matters.reduce((sum, matter) => sum + calcFinancialRisk(matter).totalKopecks, 0);
}
