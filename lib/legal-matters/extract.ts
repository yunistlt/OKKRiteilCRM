// Разбор документов претензионной работы.
//
// Принцип тот же, что в исполнительных производствах: бот заполняет ЧЕРНОВИК,
// под каждым полем лежит дословная цитата из документа, человек подтверждает.
// Пересказ доказательством не считается — поле без цитаты отбрасывается.
//
// Грабля, на которой уже обжигались: в JS \w и \b НЕ работают с кириллицей,
// поэтому границы слов пишем явными классами [а-яё], а не \b.
import { getOpenAIClient, isOpenAIConfigured } from '@/utils/openai';

export type ExtractedMatterField = {
  field: string;
  value_text: string;
  value_raw: any;
  quote: string;
  confidence: number;
  extractor: 'regex' | 'ai';
};

export type MatterExtraction = {
  doc_kind: string | null;
  fields: ExtractedMatterField[];
  warnings: string[];
};

/** Какие поля дела бот вправе предлагать. Всё остальное — только руками. */
export const MATTER_EXTRACTABLE_FIELDS = [
  'counterparty_name',
  'counterparty_inn',
  'claim_amount_kopecks',
  'penalty_kopecks',
  'contract_no',
  'contract_date',
  'claim_received_on',
  'claim_reply_due',
  'subject',
];

const DOC_KIND_PATTERNS: Array<[string, RegExp]> = [
  ['pretenziya', /претензи[а-яё]*/i],
  ['otvet', /ответ\s+на\s+претензи[а-яё]*/i],
  ['isk', /исков[а-яё]*\s+заявлени[а-яё]*/i],
  ['otzyv', /отзыв\s+на\s+исков[а-яё]*/i],
  ['reshenie', /решени[а-яё]*\s+(арбитражн|суда)/i],
  ['dogovor', /договор\s+(поставки|подряда|аренды|купли)/i],
  ['akt', /акт\s+(сверки|выполненн|приём|приемки)/i],
];

export function detectMatterDocKind(text: string): string | null {
  // «Ответ на претензию» содержит слово «претензия», поэтому идём от частного к общему.
  const ordered = [...DOC_KIND_PATTERNS].sort((left, right) => right[1].source.length - left[1].source.length);
  for (const [kind, pattern] of ordered) {
    if (pattern.test(text)) return kind;
  }
  return null;
}

function quoteAround(text: string, index: number, length: number, pad = 90): string {
  const from = Math.max(0, index - pad);
  const to = Math.min(text.length, index + length + pad);
  return text.slice(from, to).replace(/\s+/g, ' ').trim();
}

function pushUnique(acc: ExtractedMatterField[], candidate: ExtractedMatterField) {
  if (acc.some((item) => item.field === candidate.field)) return;
  acc.push(candidate);
}

/** «1 234 567,89» → копейки. Пробелы-разделители в документах бывают неразрывными. */
export function parseMoneyToKopecks(raw: string): number | null {
  const cleaned = raw.replace(/[\s  ]/g, '').replace(',', '.');
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

const MONTHS: Record<string, string> = {
  январ: '01', феврал: '02', март: '03', апрел: '04', ма: '05', июн: '06',
  июл: '07', август: '08', сентябр: '09', октябр: '10', ноябр: '11', декабр: '12',
};

/** Даты в документах пишут и цифрами, и словами: «15.09.2026» и «15 сентября 2026». */
export function parseRuDate(raw: string): string | null {
  const digits = raw.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
  if (digits) {
    const [, day, month, year] = digits;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const words = raw.match(/(\d{1,2})\s+([а-яё]+)\s+(\d{4})/i);
  if (words) {
    const [, day, monthWord, year] = words;
    const key = Object.keys(MONTHS).find((prefix) => monthWord.toLowerCase().startsWith(prefix));
    if (key) return `${year}-${MONTHS[key]}-${day.padStart(2, '0')}`;
  }

  return null;
}

export function extractMatterFieldsByRegex(text: string): MatterExtraction {
  const fields: ExtractedMatterField[] = [];
  const warnings: string[] = [];

  // ИНН: 10 цифр у юрлица, 12 у предпринимателя.
  const inn = /ИНН[\s:]*(\d{10}|\d{12})/i.exec(text);
  if (inn) {
    pushUnique(fields, {
      field: 'counterparty_inn',
      value_text: inn[1],
      value_raw: inn[1],
      quote: quoteAround(text, inn.index, inn[0].length),
      confidence: 0.9,
      extractor: 'regex',
    });
  }

  // Наименование: берём вместе с организационно-правовой формой, иначе теряется смысл.
  const org = /((?:ООО|АО|ПАО|ЗАО|ИП)\s+«[^»]{2,120}»|(?:ООО|АО|ПАО|ЗАО)\s+"[^"]{2,120}")/i.exec(text);
  if (org) {
    pushUnique(fields, {
      field: 'counterparty_name',
      value_text: org[1].trim(),
      value_raw: org[1].trim(),
      quote: quoteAround(text, org.index, org[0].length),
      confidence: 0.6,
      extractor: 'regex',
    });
  }

  // Сумма требования. «Неустойка» ловится отдельно — иначе она попадёт в основное требование.
  const claim = /(?:требу[а-яё]*|взыскать|возврат[а-яё]*|уплатить|сумм[а-яё]*\s+требовани[а-яё]*)[^.\n]{0,80}?([\d\s  ]{4,20}[,.]?\d{0,2})\s*(?:руб|₽)/i.exec(text);
  if (claim) {
    const kopecks = parseMoneyToKopecks(claim[1]);
    if (kopecks !== null && kopecks > 0) {
      pushUnique(fields, {
        field: 'claim_amount_kopecks',
        value_text: claim[1].trim(),
        value_raw: kopecks,
        quote: quoteAround(text, claim.index, claim[0].length),
        confidence: 0.7,
        extractor: 'regex',
      });
    }
  }

  const penalty = /(?:неустойк[а-яё]*|пен[а-яё]*|штраф[а-яё]*)[^.\n]{0,80}?([\d\s  ]{4,20}[,.]?\d{0,2})\s*(?:руб|₽)/i.exec(text);
  if (penalty) {
    const kopecks = parseMoneyToKopecks(penalty[1]);
    if (kopecks !== null && kopecks > 0) {
      pushUnique(fields, {
        field: 'penalty_kopecks',
        value_text: penalty[1].trim(),
        value_raw: kopecks,
        quote: quoteAround(text, penalty.index, penalty[0].length),
        confidence: 0.7,
        extractor: 'regex',
      });
    }
  }

  // Договор: номер и дата рядом — «Договор № 17/2025 от 12.03.2025».
  const contract = /договор[а-яё]*\s*(?:поставки|подряда|аренды|купли-продажи)?\s*№\s*([^\s,;]{1,30})(?:\s*от\s*([\d.\-/]{8,10}|\d{1,2}\s+[а-яё]+\s+\d{4}))?/i.exec(text);
  if (contract) {
    pushUnique(fields, {
      field: 'contract_no',
      value_text: contract[1].trim(),
      value_raw: contract[1].trim(),
      quote: quoteAround(text, contract.index, contract[0].length),
      confidence: 0.8,
      extractor: 'regex',
    });

    if (contract[2]) {
      const iso = parseRuDate(contract[2]);
      if (iso) {
        pushUnique(fields, {
          field: 'contract_date',
          value_text: contract[2].trim(),
          value_raw: iso,
          quote: quoteAround(text, contract.index, contract[0].length),
          confidence: 0.8,
          extractor: 'regex',
        });
      }
    }
  }

  // Срок ответа на претензию — то, что нельзя пропускать: от него считается просрочка.
  const replyDue = /(?:ответ[а-яё]*|рассмотр[а-яё]*)[^.\n]{0,60}?(?:в\s+течение\s+(\d{1,3})\s+(?:календарных\s+|рабочих\s+)?дн|до\s+([\d.\-/]{8,10}))/i.exec(text);
  if (replyDue) {
    if (replyDue[2]) {
      const iso = parseRuDate(replyDue[2]);
      if (iso) {
        pushUnique(fields, {
          field: 'claim_reply_due',
          value_text: replyDue[2],
          value_raw: iso,
          quote: quoteAround(text, replyDue.index, replyDue[0].length),
          confidence: 0.75,
          extractor: 'regex',
        });
      }
    } else if (replyDue[1]) {
      // Срок «в течение N дней» сам по себе даты не даёт: от чего считать, решает человек.
      warnings.push(`Срок ответа указан как «${replyDue[1]} дней» — поставьте дату вручную, от какого события считать.`);
    }
  }

  return { doc_kind: detectMatterDocKind(text), fields, warnings };
}

const AI_SYSTEM_PROMPT = `Ты помощник юриста. Из текста претензии или искового заявления извлеки поля и для КАЖДОГО верни дословную цитату из текста.
Верни JSON: {"fields":[{"field":"...","value":"...","quote":"..."}]}.
Допустимые поля: ${MATTER_EXTRACTABLE_FIELDS.join(', ')}.
Суммы — строкой как в документе. Даты — как в документе.
Если поля в тексте нет, не выдумывай его. Цитата обязана дословно встречаться в тексте.`;

/**
 * ИИ-слой. Включается только при заданном ключе; без него раздел работает на
 * регулярках, а не падает.
 *
 * НОЧНОЙ ПРОГОН: написан, но не запускался — платные вызовы без подтверждения
 * не делаем. Проверять на реальных документах вместе с Андреем.
 */
export async function extractMatterFieldsByAi(text: string): Promise<MatterExtraction> {
  if (!isOpenAIConfigured()) {
    return { doc_kind: null, fields: [], warnings: ['OPENAI_API_KEY не задан: поля заполнены только регулярками.'] };
  }

  try {
    const client = getOpenAIClient();
    const completion = await client.chat.completions.create({
      model: process.env.LEGAL_MATTERS_MODEL || 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: AI_SYSTEM_PROMPT },
        { role: 'user', content: text.slice(0, 24000) },
      ],
    });

    const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}') as {
      fields?: Array<Record<string, any>>;
    };

    const fields: ExtractedMatterField[] = [];
    const warnings: string[] = [];
    const normalizedText = text.replace(/\s+/g, ' ');

    for (const item of parsed.fields || []) {
      const field = String(item.field || '');
      if (!MATTER_EXTRACTABLE_FIELDS.includes(field)) continue;

      const valueText = String(item.value ?? '').trim();
      const quote = String(item.quote ?? '').trim();
      if (!valueText || !quote) continue;

      // Цитата обязана встречаться в документе — иначе это пересказ, а не доказательство.
      if (!normalizedText.includes(quote.replace(/\s+/g, ' ').slice(0, 40))) {
        warnings.push(`Поле «${field}» отброшено: цитата не найдена в документе.`);
        continue;
      }

      pushUnique(fields, {
        field,
        value_text: valueText,
        value_raw: normalizeAiValue(field, valueText),
        quote,
        confidence: 0.65,
        extractor: 'ai',
      });
    }

    return { doc_kind: detectMatterDocKind(text), fields, warnings };
  } catch (error: any) {
    return { doc_kind: null, fields: [], warnings: [`ИИ-разбор не удался: ${error?.message || 'ошибка'}`] };
  }
}

function normalizeAiValue(field: string, valueText: string): any {
  if (field.endsWith('_kopecks')) return parseMoneyToKopecks(valueText);
  if (field.endsWith('_date') || field.endsWith('_on') || field.endsWith('_due')) return parseRuDate(valueText);
  return valueText;
}

/**
 * Полный разбор: регулярки дают опору, ИИ добирает остальное.
 * Значение из регулярки не перебивается ИИ — у механического совпадения
 * доверия больше, чем у языковой модели.
 */
export async function extractMatterFields(text: string, useAi = true): Promise<MatterExtraction> {
  const base = extractMatterFieldsByRegex(text);
  if (!useAi) return base;

  const ai = await extractMatterFieldsByAi(text);
  const fields = [...base.fields];
  for (const field of ai.fields) pushUnique(fields, field);

  return {
    doc_kind: base.doc_kind || ai.doc_kind,
    fields,
    warnings: [...base.warnings, ...ai.warnings],
  };
}
