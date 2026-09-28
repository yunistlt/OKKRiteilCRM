// Общее для реестра дел и карточки дела.
// ЗАКОН проекта: коды в интерфейс не выпускаем — названия стадий, статусов и
// категорий приходят с сервера из справочника и правятся без деплоя.
import type { AttentionReason } from '@/lib/legal-matters/attention';

export type DictItem = { kind: string; code: string; name: string; description: string | null; color: string | null };
export type Dictionaries = Record<string, DictItem[]>;
export type LegalEntityRow = { inn: string; short_name: string; kind: string };

export type RiskPartRow = { field: string; kopecks: number; adds: boolean };

export type MatterRowUi = Record<string, any> & {
  id: number;
  matter_no: string;
  stage: string;
  status: string;
  matter_side: string;
  risk: { totalKopecks: number; parts: RiskPartRow[]; side: string };
  deadlines: {
    actionOverdue: boolean;
    actionDueInDays: number | null;
    actionMissing: boolean;
    limitationUntil: string | null;
    limitationInDays: number | null;
    limitationExpired: boolean;
    limitationSoon: boolean;
    replyOverdue: boolean;
  };
  last_event: { id: number; event_on: string; title: string; kind: string } | null;
};

export type AttentionRow = { matter: MatterRowUi; reasons: AttentionReason[]; weight: number };

/** Почему дело требует внимания. Формулировки для руководителя, не для юриста. */
export const ATTENTION_LABELS: Record<AttentionReason, string> = {
  limitation_expired: 'Срок давности истёк',
  limitation_soon: 'Давность на исходе',
  action_overdue: 'Действие просрочено',
  reply_overdue: 'Ответ на претензию просрочен',
  action_missing: 'Не указано следующее действие',
};

export function dictName(dictionaries: Dictionaries, kind: string, code: string | null | undefined): string {
  if (!code) return '—';
  const found = dictionaries[kind]?.find((item) => item.code === code);
  return found?.name || String(code);
}

export function dictColor(dictionaries: Dictionaries, kind: string, code: string | null | undefined): string | null {
  if (!code) return null;
  return dictionaries[kind]?.find((item) => item.code === code)?.color || null;
}

/** Деньги: разряды обязательны (ЗАКОН), копейки показываем только когда они есть. */
export function formatMoney(kopecks: number | null | undefined): string {
  if (kopecks === null || kopecks === undefined) return '—';
  const rubles = Number(kopecks) / 100;
  return rubles.toLocaleString('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: Number.isInteger(rubles) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** Крупные суммы на плитках — без копеек, иначе не читается. */
export function formatMoneyShort(kopecks: number | null | undefined): string {
  if (kopecks === null || kopecks === undefined) return '—';
  return `${Math.round(Number(kopecks) / 100).toLocaleString('ru-RU')} ₽`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString('ru-RU');
}

/** «через 5 дней» / «просрочено на 3 дня» — руководителю важен не срок, а запас. */
export function formatDueHint(days: number | null): string {
  if (days === null) return '';
  if (days === 0) return 'сегодня';
  if (days > 0) return `через ${days} ${plural(days, 'день', 'дня', 'дней')}`;
  const overdue = Math.abs(days);
  return `просрочено на ${overdue} ${plural(overdue, 'день', 'дня', 'дней')}`;
}

function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = count % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
