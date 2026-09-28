// Сроки по делу.
//
// Исковая давность — единственный срок, пропуск которого нельзя отыграть:
// деньги теряются безвозвратно, сколько бы ни было правоты. Поэтому о ней
// предупреждаем заранее и отдельно от обычных задач.
import type { LegalMatter } from './types';

/** Общий срок исковой давности — три года (ст. 196 ГК РФ). */
export const LIMITATION_YEARS = 3;

/** За сколько дней до истечения давности дело попадает в «требует внимания». */
export const LIMITATION_WARN_DAYS = 90;

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

/**
 * Дата истечения давности: заданная руками важнее вычисленной — срок бывает
 * специальным (год по перевозке, по качеству работ) и прерывается признанием долга.
 */
export function resolveLimitationUntil(matter: Partial<LegalMatter>): string | null {
  if (matter.limitation_until) return String(matter.limitation_until).slice(0, 10);

  const start = toDate(matter.claim_right_on);
  if (!start) return null;

  const until = new Date(start);
  until.setUTCFullYear(until.getUTCFullYear() + LIMITATION_YEARS);
  return until.toISOString().slice(0, 10);
}

export type DeadlineState = {
  /** Просроченное действие: срок прошёл, дело не закрыто. */
  actionOverdue: boolean;
  actionDueInDays: number | null;
  /** Активному делу без следующего действия двигаться нечем — это дыра, а не норма. */
  actionMissing: boolean;
  limitationUntil: string | null;
  limitationInDays: number | null;
  limitationExpired: boolean;
  limitationSoon: boolean;
  /** Ответ на претензию просрочен. */
  replyOverdue: boolean;
};

export function evaluateDeadlines(matter: Partial<LegalMatter>, today = new Date()): DeadlineState {
  const now = toDate(today.toISOString().slice(0, 10)) as Date;
  const closed = Boolean(matter.closed_on) || matter.status === 'closed' || matter.stage === 'closed';

  const due = toDate(matter.next_action_due);
  const actionDueInDays = due ? daysBetween(now, due) : null;

  const limitationUntil = resolveLimitationUntil(matter);
  const limitation = toDate(limitationUntil);
  const limitationInDays = limitation ? daysBetween(now, limitation) : null;

  const replyDue = toDate(matter.claim_reply_due);
  const replied = Boolean(matter.claim_replied_on);

  return {
    actionOverdue: !closed && actionDueInDays !== null && actionDueInDays < 0,
    actionDueInDays,
    actionMissing: !closed && !matter.next_action,
    limitationUntil,
    limitationInDays,
    limitationExpired: !closed && limitationInDays !== null && limitationInDays < 0,
    limitationSoon: !closed && limitationInDays !== null && limitationInDays >= 0 && limitationInDays <= LIMITATION_WARN_DAYS,
    replyOverdue: !closed && !replied && replyDue !== null && daysBetween(now, replyDue) < 0,
  };
}
