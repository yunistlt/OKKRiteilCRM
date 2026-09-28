import { describe, expect, it } from 'vitest';
import { extractByRegex } from '@/lib/legal-enforcement/extract';
import { formatDate, humanFieldValue } from '@/app/components/enforcement-shared';

const POSTANOVLENIE = `ФЕДЕРАЛЬНАЯ СЛУЖБА СУДЕБНЫХ ПРИСТАВОВ
Отдел судебных приставов Автозаводского района г. Тольятти

ПОСТАНОВЛЕНИЕ о возбуждении исполнительного производства
г. Тольятти 14.09.2026

Судебный пристав-исполнитель Иванова А. А., рассмотрев исполнительный лист
№ ФС 045123789 от 02.09.2026, выданный Арбитражным судом Самарской области по
делу № А55-12345/2026, возбудил исполнительное производство № 45678/26/63021-ИП.

Должник: Общество с ограниченной ответственностью «ЗМК», ИНН 6324017492
Взыскатель: Межрайонная ИФНС России № 2 по Самарской области, ИНН 6320000010
Сумма долга: 1 250 000,00 руб.
Исполнительский сбор: 87 500,00 руб.`;

function valueOf(fields: ReturnType<typeof extractByRegex>['fields'], field: string) {
  return fields.find((item) => item.field === field)?.value_text;
}

describe('разбор постановления о возбуждении ИП', () => {
  const { fields } = extractByRegex(POSTANOVLENIE);

  it('берёт номер производства, а не номер судебного дела', () => {
    expect(valueOf(fields, 'case_number')).toBe('45678/26/63021-ИП');
    expect(valueOf(fields, 'court_case_number')).toBe('А55-12345/2026');
  });

  it('отдел ФССП без шапки бланка', () => {
    expect(valueOf(fields, 'fssp_department')).toBe('Отдел судебных приставов Автозаводского района г. Тольятти');
    expect(valueOf(fields, 'fssp_department')).not.toMatch(/ФЕДЕРАЛЬНАЯ/i);
  });

  it('берёт номер исполнительного листа с буквенной серией', () => {
    expect(valueOf(fields, 'writ_number')).toBe('ФС 045123789');
  });

  it('суммы долга и взыскания различаются', () => {
    const debt = fields.find((item) => item.field === 'debt_amount_kopecks');
    const charge = fields.find((item) => item.field === 'charge_amount_kopecks');
    expect(debt?.value_raw).toBe(125000000);
    expect(charge?.value_raw).toBe(8750000);
  });

  it('под каждым полем есть цитата из документа', () => {
    for (const field of fields) {
      expect(field.quote.length).toBeGreaterThan(0);
      expect(POSTANOVLENIE.replace(/\s+/g, ' ')).toContain(field.quote.slice(0, 30));
    }
  });
});

describe('как значения показываются человеку', () => {
  it('ISO-дата печатается по-русски', () => {
    expect(formatDate('2026-09-14')).toBe('14.09.2026');
  });

  it('«2 квартал 2026» остаётся текстом, а не превращается в Invalid Date', () => {
    expect(humanFieldValue('debt_period_from', '2 квартал 2026')).toBe('2 квартал 2026');
  });

  it('русская дата не переворачивается в американскую', () => {
    // new Date('01.04.2026') в JS — 4 января, и на экране была ложь.
    expect(humanFieldValue('debt_period_from', '01.04.2026')).toBe('01.04.2026');
  });

  it('сумма строкой из документа не превращается в «не число»', () => {
    expect(humanFieldValue('debt_amount_kopecks', '1 250 000,00')).not.toContain('не число');
  });

  it('деньги показываются с разрядами и копейками', () => {
    expect(humanFieldValue('debt_amount_kopecks', 125000000).replace(/ /g, ' ')).toBe('1 250 000,00 ₽');
  });
});
