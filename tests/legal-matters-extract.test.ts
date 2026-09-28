import { describe, expect, it } from 'vitest';
import {
  detectMatterDocKind,
  extractMatterFieldsByRegex,
  parseMoneyToKopecks,
  parseRuDate,
} from '@/lib/legal-matters/extract';

const CLAIM = `
ПРЕТЕНЗИЯ
об устранении недостатков и возврате денежных средств

ООО «Дорогобуж», ИНН 6320123456, далее Покупатель, по договору поставки № 17/2025
от 12.03.2025 приобрёл оборудование.

Покупатель требует возврата 480 000,50 руб. за поставленное оборудование
ненадлежащего качества.

Также начислена неустойка в размере 52 300 руб.

Просим рассмотреть настоящую претензию и направить ответ до 25.09.2026.
`;

describe('разбор претензии регулярками', () => {
  const result = extractMatterFieldsByRegex(CLAIM);
  const byField = new Map(result.fields.map((field) => [field.field, field]));

  it('узнаёт вид документа', () => {
    expect(result.doc_kind).toBe('pretenziya');
  });

  it('ответ на претензию не путает с самой претензией', () => {
    expect(detectMatterDocKind('Ответ на претензию от 01.09.2026')).toBe('otvet');
  });

  it('достаёт ИНН контрагента', () => {
    expect(byField.get('counterparty_inn')?.value_raw).toBe('6320123456');
  });

  it('достаёт название вместе с организационно-правовой формой', () => {
    expect(byField.get('counterparty_name')?.value_text).toBe('ООО «Дорогобуж»');
  });

  it('сумма требования переводится в копейки', () => {
    expect(byField.get('claim_amount_kopecks')?.value_raw).toBe(48_000_050);
  });

  it('неустойка не попадает в основное требование', () => {
    expect(byField.get('penalty_kopecks')?.value_raw).toBe(5_230_000);
  });

  it('номер и дата договора', () => {
    expect(byField.get('contract_no')?.value_text).toBe('17/2025');
    expect(byField.get('contract_date')?.value_raw).toBe('2025-03-12');
  });

  it('срок ответа на претензию', () => {
    expect(byField.get('claim_reply_due')?.value_raw).toBe('2026-09-25');
  });

  it('под каждым полем лежит цитата из документа', () => {
    for (const field of result.fields) {
      expect(field.quote.length).toBeGreaterThan(0);
      expect(CLAIM.replace(/\s+/g, ' ')).toContain(field.quote.slice(0, 30));
    }
  });
});

describe('срок «в течение N дней»', () => {
  it('датой не становится, но человека предупреждаем', () => {
    const result = extractMatterFieldsByRegex(
      'Просим направить ответ в течение 30 календарных дней с момента получения.',
    );

    expect(result.fields.some((field) => field.field === 'claim_reply_due')).toBe(false);
    expect(result.warnings.join(' ')).toContain('30 дней');
  });
});

describe('разбор чисел и дат', () => {
  it('неразрывные пробелы в суммах не ломают разбор', () => {
    expect(parseMoneyToKopecks('1 234 567,89')).toBe(123_456_789);
  });

  it('дата словами', () => {
    expect(parseRuDate('15 сентября 2026')).toBe('2026-09-15');
  });

  it('дата цифрами через разные разделители', () => {
    expect(parseRuDate('01.02.2026')).toBe('2026-02-01');
    expect(parseRuDate('01/02/2026')).toBe('2026-02-01');
  });

  it('мусор датой не считается', () => {
    expect(parseRuDate('не указано')).toBeNull();
  });
});
