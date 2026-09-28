// Юрлица группы, дела которых нас интересуют.
//
// Список уже есть у платежей (`PAYMENT_OWN_INNS`) — второй справочник завёл бы
// расхождение: добавили юрлицо в одном месте, забыли в другом.
export function ownInns(): string[] {
  const raw =
    process.env.PAYMENT_OWN_INNS || '6324017492,6321277326,632101044652,1674010590,6320082677';
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

export function isOurInn(inn: string | null | undefined): boolean {
  const normalized = String(inn || '').replace(/\D/g, '');
  return normalized.length > 0 && ownInns().includes(normalized);
}
