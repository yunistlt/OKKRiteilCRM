import { describe, expect, it } from 'vitest';
import { isCourtWatchEmail, parseStrajEmail } from '@/lib/court/straj-parser';

const STRAJ_EMAIL = `
Уважаемый пользователь!
По вашей подписке в сервисе «Электронный страж» произошли изменения.

Дело № А55-12345/2026
Арбитражный суд Самарской области
Дата регистрации: 14.09.2026
Истец: ООО «Ромашка», ИНН 6312001234
Ответчик: ООО «ЗМК», ИНН 6324017492
Цена иска: 1 250 000,00 руб.

15.09.2026 Исковое заявление принято к производству, назначено предварительное
судебное заседание на 20.10.2026.
Карточка дела: https://kad.arbitr.ru/card/8f1c2d4e-0000-4a1b-9c3d-77aa11bb22cc
`;

describe('письма «Электронного стража»', () => {
  it('узнаёт письмо картотеки по отправителю', () => {
    expect(isCourtWatchEmail({ fromEmail: 'e-storoj@arbitr.ru', subject: 'Изменения', body: '' })).toBe(true);
  });

  it('узнаёт письмо по содержимому, даже если адрес сменили', () => {
    expect(isCourtWatchEmail({ fromEmail: 'robot@example.com', subject: 'тема', body: STRAJ_EMAIL })).toBe(true);
  });

  it('не принимает обычное письмо за уведомление картотеки', () => {
    expect(
      isCourtWatchEmail({ fromEmail: 'client@mail.ru', subject: 'Запрос цены', body: 'Пришлите счёт на шкаф' }),
    ).toBe(false);
  });

  it('достаёт дело, стороны, сумму и движение', () => {
    const [item] = parseStrajEmail({ subject: 'Электронный страж: изменения', body: STRAJ_EMAIL });

    expect(item.case_number).toBe('А55-12345/2026');
    expect(item.court_name).toContain('Арбитражный суд Самарской области');
    expect(item.registered_on).toBe('2026-09-14');
    expect(item.amount_kopecks).toBe(125000000);
    expect(item.defendant).toContain('ЗМК');
    expect(item.mentioned_inns).toContain('6324017492');
    expect(item.kad_url).toContain('kad.arbitr.ru/card/');
    expect(item.event_text).toMatch(/принято к производству|назначено/i);
    expect(item.raw_excerpt.length).toBeGreaterThan(0);
  });

  it('возвращает пусто, когда номера дела в письме нет', () => {
    expect(parseStrajEmail({ subject: 'Изменение тарифов', body: 'Уважаемый пользователь, тарифы меняются.' })).toEqual([]);
  });

  it('разбирает несколько дел из одного письма', () => {
    const many = STRAJ_EMAIL + '\nДело № А55-99999/2026\nАрбитражный суд Самарской области\n01.09.2026 Определение об отложении.';
    const items = parseStrajEmail({ body: many });
    expect(items.map((item) => item.case_number)).toEqual(['А55-12345/2026', 'А55-99999/2026']);
  });
});
