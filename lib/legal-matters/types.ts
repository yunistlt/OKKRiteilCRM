// Претензионно-исковая работа: один конфликт = одно дело с постоянным номером.
//
// ЗАКОН проекта: в интерфейсе только человеческий язык. Русские названия стадий,
// статусов и категорий лежат в БД (legal_matter_dictionaries) и правятся без
// деплоя — здесь только коды, которыми сравнивает логика.
import { z } from 'zod';

export const MATTER_BUCKET = 'legal-matters';
export const MATTER_MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

/** Стадии дела. Порядок значим: дело движется сверху вниз и не перескакивает назад само. */
export const MATTER_STAGES = [
  'claim',
  'talks',
  'lawsuit',
  'court',
  'appeal',
  'enforcement',
  'closed',
] as const;
export type MatterStage = (typeof MATTER_STAGES)[number];

/** Статусов намеренно семь: больше — руководителю сложнее, а не понятнее. */
export const MATTER_STATUSES = [
  'new',
  'in_work',
  'waiting_counterparty',
  'court',
  'enforcement',
  'paused',
  'closed',
] as const;
export type MatterStatus = (typeof MATTER_STATUSES)[number];

/** Наша сторона спора: дебиторка — это тоже претензия, только наша. */
export const MATTER_SIDES = ['claimant', 'respondent'] as const;
export type MatterSide = (typeof MATTER_SIDES)[number];

/** К чему дело может быть привязано. Суды и ИП живут в своих таблицах. */
export const MATTER_LINK_KINDS = ['court_case', 'enforcement_case', 'order', 'payment'] as const;
export type MatterLinkKind = (typeof MATTER_LINK_KINDS)[number];

export const MATTER_EVENT_KINDS = [
  'claim_in',
  'claim_out',
  'reply',
  'talks',
  'filing',
  'hearing',
  'ruling',
  'writ',
  'payment',
  'stage_change',
  'note',
] as const;
export type MatterEventKind = (typeof MATTER_EVENT_KINDS)[number];

/** Денежные поля дела. Все в копейках — рубли с копейками в double не живут. */
export const MATTER_MONEY_FIELDS = [
  'contract_amount_kopecks',
  'claim_amount_kopecks',
  'our_claim_amount_kopecks',
  'penalty_kopecks',
  'damages_kopecks',
  'state_duty_kopecks',
  'court_costs_kopecks',
  'settled_amount_kopecks',
  'recovered_kopecks',
  'paid_out_kopecks',
  'costs_recovered_kopecks',
] as const;
export type MatterMoneyField = (typeof MATTER_MONEY_FIELDS)[number];

export type LegalMatter = {
  id: number;
  matter_no: string;
  our_entity_inn: string | null;
  counterparty_name: string | null;
  counterparty_inn: string | null;
  counterparty_rep: string | null;
  matter_side: MatterSide;
  category: string | null;
  subject: string | null;
  our_position: string | null;
  cause: string | null;
  contract_no: string | null;
  contract_date: string | null;
  order_number: string | null;
  business_unit: string | null;
  responsible_user_id: string | null;
  business_owner: string | null;
  stage: MatterStage;
  status: MatterStatus;
  risk_level: string | null;
  opened_on: string;
  closed_on: string | null;
  close_reason: string | null;
  outcome: string | null;
  next_action: string | null;
  next_action_due: string | null;
  claim_right_on: string | null;
  limitation_until: string | null;
  claim_received_on: string | null;
  claim_reply_due: string | null;
  claim_replied_on: string | null;
  claim_result: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
} & Record<MatterMoneyField, number | null>;

export type LegalMatterEvent = {
  id: number;
  matter_id: number;
  event_on: string;
  kind: MatterEventKind;
  title: string;
  description: string | null;
  result: string | null;
  document_id: number | null;
  stage_before: string | null;
  stage_after: string | null;
  actor: string | null;
  source: 'human' | 'bot' | 'import';
  created_at: string;
};

export type LegalMatterLink = {
  id: number;
  matter_id: number;
  target_kind: MatterLinkKind;
  target_id: string;
  role: string | null;
  link_state: 'suggested' | 'confirmed' | 'rejected';
  match_reason: unknown;
  created_by: string | null;
  created_at: string;
};

export type DictionaryItem = {
  kind: string;
  code: string;
  name: string;
  description: string | null;
  color: string | null;
  sort_order: number;
  active: boolean;
};

// ── Схемы входа API ────────────────────────────────────────────────────────

export const matterCreateSchema = z.object({
  counterparty_name: z.string().trim().min(1, 'Укажите контрагента'),
  counterparty_inn: z.string().trim().regex(/^\d{10}(\d{2})?$/, 'ИНН — 10 или 12 цифр').optional().nullable(),
  our_entity_inn: z.string().trim().optional().nullable(),
  matter_side: z.enum(MATTER_SIDES).default('respondent'),
  category: z.string().trim().optional().nullable(),
  subject: z.string().trim().min(1, 'Опишите суть спора в одном-двух предложениях'),
  cause: z.string().trim().optional().nullable(),
  contract_no: z.string().trim().optional().nullable(),
  contract_date: z.string().trim().optional().nullable(),
  order_number: z.string().trim().optional().nullable(),
  responsible_user_id: z.string().trim().optional().nullable(),
  business_owner: z.string().trim().optional().nullable(),
  next_action: z.string().trim().optional().nullable(),
  next_action_due: z.string().trim().optional().nullable(),
  claim_right_on: z.string().trim().optional().nullable(),
  note: z.string().trim().optional().nullable(),
});

export type MatterCreateInput = z.infer<typeof matterCreateSchema>;

export const matterUpdateSchema = matterCreateSchema.partial().extend({
  stage: z.enum(MATTER_STAGES).optional(),
  status: z.enum(MATTER_STATUSES).optional(),
  risk_level: z.string().trim().optional().nullable(),
  our_position: z.string().trim().optional().nullable(),
  counterparty_rep: z.string().trim().optional().nullable(),
  business_unit: z.string().trim().optional().nullable(),
  limitation_until: z.string().trim().optional().nullable(),
  claim_received_on: z.string().trim().optional().nullable(),
  claim_reply_due: z.string().trim().optional().nullable(),
  claim_replied_on: z.string().trim().optional().nullable(),
  claim_result: z.string().trim().optional().nullable(),
  closed_on: z.string().trim().optional().nullable(),
  close_reason: z.string().trim().optional().nullable(),
  outcome: z.string().trim().optional().nullable(),
  contract_amount_kopecks: z.number().int().nonnegative().optional().nullable(),
  claim_amount_kopecks: z.number().int().nonnegative().optional().nullable(),
  our_claim_amount_kopecks: z.number().int().nonnegative().optional().nullable(),
  penalty_kopecks: z.number().int().nonnegative().optional().nullable(),
  damages_kopecks: z.number().int().nonnegative().optional().nullable(),
  state_duty_kopecks: z.number().int().nonnegative().optional().nullable(),
  court_costs_kopecks: z.number().int().nonnegative().optional().nullable(),
  settled_amount_kopecks: z.number().int().nonnegative().optional().nullable(),
  recovered_kopecks: z.number().int().nonnegative().optional().nullable(),
  paid_out_kopecks: z.number().int().nonnegative().optional().nullable(),
  costs_recovered_kopecks: z.number().int().nonnegative().optional().nullable(),
});

export const matterEventSchema = z.object({
  matter_id: z.number().int().positive(),
  event_on: z.string().trim().optional(),
  kind: z.enum(MATTER_EVENT_KINDS).default('note'),
  title: z.string().trim().min(1, 'Опишите, что произошло'),
  description: z.string().trim().optional().nullable(),
  result: z.string().trim().optional().nullable(),
  document_id: z.number().int().positive().optional().nullable(),
  next_action: z.string().trim().optional().nullable(),
  next_action_due: z.string().trim().optional().nullable(),
  stage_after: z.enum(MATTER_STAGES).optional().nullable(),
});

export const matterLinkSchema = z.object({
  matter_id: z.number().int().positive(),
  target_kind: z.enum(MATTER_LINK_KINDS),
  target_id: z.string().trim().min(1),
  role: z.string().trim().optional().nullable(),
});
