// Извлечение полей исполнительного производства из текста документа.
//
// Два слоя, оба возвращают ОДИН формат — поле + значение + цитата + уверенность:
//   1) regex — работает всегда, без сети и без денег, ловит номера/даты/суммы/ИНН;
//   2) ИИ — дополняет то, что регуляркой не взять (взыскатель, основание, пристав).
// ИИ не перебивает regex там, где regex уверен: номер ИП из шаблона надёжнее пересказа.
// Без OPENAI_API_KEY раздел не падает, а работает на одних регулярках (деградация).
import { getOpenAIClient, isOpenAIConfigured } from '@/utils/openai';
import {
  ENFORCEMENT_EXTRACTABLE_FIELDS,
  ENFORCEMENT_GROUNDS,
  parseAmountToKopecks,
  parseRuDate,
  type EnforcementDocKind,
} from './types';

export type ExtractedField = {
  field: string;
  value_text: string;
  value_raw: any;
  quote: string;
  confidence: number;
  extractor: 'regex' | 'ai';
};

export type ExtractionOutcome = {
  doc_kind: EnforcementDocKind | null;
  fields: ExtractedField[];
  warnings: string[];
};

/** Фрагмент вокруг совпадения — то, что человек увидит как доказательство. */
function quoteAround(text: string, index: number, length: number, pad = 90): string {
  const from = Math.max(0, index - pad);
  const to = Math.min(text.length, index + length + pad);
  return text.slice(from, to).replace(/\s+/g, ' ').trim();
}

function pushUnique(acc: ExtractedField[], candidate: ExtractedField) {
  if (acc.some((item) => item.field === candidate.field)) return;
  acc.push(candidate);
}

const DOC_KIND_PATTERNS: Array<[EnforcementDocKind, RegExp]> = [
  ['postanovlenie', /постановлени\w*\s+о\s+возбуждении/i],
  ['trebovanie', /требовани\w*\s+(об|о)\s+уплат/i],
  ['reshenie', /решени\w*\s+о\s+взыскании/i],
  ['prikaz', /судебн\w*\s+приказ/i],
  ['list', /исполнительн\w*\s+лист/i],
  ['inkasso', /инкассов\w*\s+поручени/i],
];

export function detectDocKind(text: string): EnforcementDocKind | null {
  for (const [kind, pattern] of DOC_KIND_PATTERNS) {
    if (pattern.test(text)) return kind;
  }
  return null;
}

const GROUND_PATTERNS: Array<[string, RegExp]> = [
  ['tax', /(налог|фнс|ифнс|межрайонн\w*\s+инспекц|страховы\w*\s+взнос|пен(я|и)\s+по\s+налог)/i],
  ['fund', /(социальн\w*\s+фонд|сфр|пфр|фсс|фонд\s+пенсионн)/i],
  ['court', /(решени\w*\s+суда|судебн\w*\s+приказ|арбитражн\w*\s+суд|мировой\s+судья)/i],
  ['fine', /(административн\w*\s+штраф|гибдд|постановлени\w*\s+по\s+делу\s+об\s+административн)/i],
  ['employee', /(заработн\w*\s+плат|алимент|трудов\w*\s+спор)/i],
  ['counterparty', /(ооо|ао|ип)\s|задолженност\w*\s+по\s+договор/i],
];

/** Regex-слой: ищет то, что в документах ФССП стоит в устойчивых формулировках. */
export function extractByRegex(text: string): ExtractionOutcome {
  const fields: ExtractedField[] = [];
  const warnings: string[] = [];

  const add = (
    field: string,
    valueText: string,
    valueRaw: any,
    match: RegExpMatchArray,
    confidence: number,
  ) => {
    if (!valueText) return;
    pushUnique(fields, {
      field,
      value_text: valueText,
      value_raw: valueRaw,
      quote: quoteAround(text, match.index ?? 0, match[0].length),
      confidence,
      extractor: 'regex',
    });
  };

  // Номер исполнительного производства: 12345/26/63001-ИП
  const caseNumber = text.match(/\b(\d{3,7}\/\d{2}\/\d{3,6}(?:-ИП)?)\b/i);
  if (caseNumber) add('case_number', caseNumber[1].toUpperCase(), caseNumber[1], caseNumber, 0.95);

  // Дата возбуждения
  const startedOn = text.match(/возбужден\w*[^.\n]{0,60}?(\d{1,2}[.\/]\d{1,2}[.\/]\d{4})/i)
    || text.match(/от\s+(\d{1,2}[.\/]\d{1,2}[.\/]\d{4})\s*(?:г\.?)?[^\n]{0,40}возбужд/i);
  if (startedOn) {
    const iso = parseRuDate(startedOn[1]);
    if (iso) add('started_on', startedOn[1], iso, startedOn, 0.85);
  }

  // ИНН: первый — чаще должник, но однозначно не скажем → отдаём оба с пометкой.
  const innMatches = Array.from(text.matchAll(/ИНН[\s:]*?(\d{10}(?:\d{2})?)/gi));
  if (innMatches[0]) add('debtor_inn', innMatches[0][1], innMatches[0][1], innMatches[0], 0.6);
  if (innMatches[1]) add('claimant_inn', innMatches[1][1], innMatches[1][1], innMatches[1], 0.45);

  // Должник / взыскатель по подписям в постановлении
  const debtor = text.match(/должник[^:\n]{0,20}[:\s]+([^\n,;]{4,160})/i);
  if (debtor) add('debtor_name', debtor[1].trim(), debtor[1].trim(), debtor, 0.7);

  const claimant = text.match(/взыскател\w*[^:\n]{0,20}[:\s]+([^\n,;]{4,160})/i);
  if (claimant) add('claimant_name', claimant[1].trim(), claimant[1].trim(), claimant, 0.7);

  // Суммы
  const debt = text.match(/(?:сумм\w*\s+(?:долга|задолженност\w*)|задолженност\w*\s+в\s+размере)[^\d]{0,30}([\d\s ]+(?:[.,]\d{2})?)/i);
  if (debt) {
    const kopecks = parseAmountToKopecks(debt[1]);
    if (kopecks) add('debt_amount_kopecks', debt[1].trim(), kopecks, debt, 0.8);
  }

  const charge = text.match(/(?:исполнительн\w*\s+сбор|сумм\w*\s+взыскани\w*)[^\d]{0,30}([\d\s ]+(?:[.,]\d{2})?)/i);
  if (charge) {
    const kopecks = parseAmountToKopecks(charge[1]);
    if (kopecks) add('charge_amount_kopecks', charge[1].trim(), kopecks, charge, 0.75);
  }

  // Отдел ФССП и пристав
  const department = text.match(/((?:[А-ЯЁ][а-яё\-]+\s+){0,3}(?:районн\w*|городск\w*|межрайонн\w*)?\s*отдел\w*\s+судебных\s+приставов[^\n,;]{0,90})/i);
  if (department) add('fssp_department', department[1].replace(/\s+/g, ' ').trim(), department[1].trim(), department, 0.8);

  const bailiff = text.match(/судебн\w*\s+пристав\w*[^:\n]{0,40}[:\s]+([А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.\s?[А-ЯЁ]\.)/);
  if (bailiff) add('bailiff_name', bailiff[1].trim(), bailiff[1].trim(), bailiff, 0.75);

  // Судебное дело и исполнительный лист
  const courtCase = text.match(/(?:дел\w*\s*№|дел\w*\s+номер)\s*([А-ЯA-Z0-9\-\/]{4,30})/i);
  if (courtCase) add('court_case_number', courtCase[1].trim(), courtCase[1].trim(), courtCase, 0.7);

  const writ = text.match(/(?:исполнительн\w*\s+лист\w*|судебн\w*\s+приказ\w*)\s*(?:серии\s*)?№?\s*([А-ЯA-Z0-9\-\/]{4,30})/i);
  if (writ) add('writ_number', writ[1].trim(), writ[1].trim(), writ, 0.7);

  // Период долга: «за 2025 год», «за 1 квартал 2026»
  const period = text.match(/за\s+(\d{1,2})\s+квартал\w*\s+(\d{4})/i);
  if (period) {
    const quarter = Number(period[1]);
    const year = period[2];
    if (quarter >= 1 && quarter <= 4) {
      const fromMonth = String((quarter - 1) * 3 + 1).padStart(2, '0');
      const toMonth = String(quarter * 3).padStart(2, '0');
      const lastDay = quarter === 1 || quarter === 4 ? '31' : '30';
      add('debt_period_from', `${quarter} квартал ${year}`, `${year}-${fromMonth}-01`, period, 0.6);
      add('debt_period_to', `${quarter} квартал ${year}`, `${year}-${toMonth}-${lastDay}`, period, 0.6);
    }
  }

  // Основание
  for (const [ground, pattern] of GROUND_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      add('ground', ground, ground, match, ground === 'counterparty' ? 0.4 : 0.7);
      break;
    }
  }

  if (fields.length === 0) {
    warnings.push('Регулярные выражения не нашли ни одного поля: документ нетиповой или текст распознан плохо.');
  }

  return { doc_kind: detectDocKind(text), fields, warnings };
}

const AI_SYSTEM_PROMPT = `Ты юрист-аналитик. Тебе дают текст документа по исполнительному производству
(постановление ФССП, требование ФНС, судебный приказ, исполнительный лист).
Верни JSON со списком найденных полей. Каждое поле обязано опираться на дословную цитату из текста.
Ничего не выдумывай: нет в тексте — не возвращай поле вовсе. Цитата — точный фрагмент документа.
Формат: {"fields":[{"field":"<код>","value":"<значение>","quote":"<цитата>","confidence":<0..1>}]}
Допустимые коды поля: ${ENFORCEMENT_EXTRACTABLE_FIELDS.join(', ')}.
Для ground допустимы только: ${ENFORCEMENT_GROUNDS.join(', ')}.
Суммы возвращай числом с копейками через точку, даты — в формате ДД.ММ.ГГГГ.
Для management_account предложи управленческую статью расхода по-русски (например «Налоги и сборы»,
«Судебные издержки», «Расчёты с сотрудниками»).`;

/** ИИ-слой. Возвращает пустой результат, когда ключа нет или ответ не разобрался. */
export async function extractByAi(text: string): Promise<ExtractionOutcome> {
  if (!isOpenAIConfigured()) {
    return { doc_kind: null, fields: [], warnings: ['OPENAI_API_KEY не задан: поля заполнены только регулярками.'] };
  }

  try {
    const client = getOpenAIClient();
    const completion = await client.chat.completions.create({
      model: process.env.LEGAL_ENFORCEMENT_MODEL || 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: AI_SYSTEM_PROMPT },
        { role: 'user', content: text.slice(0, 24000) },
      ],
    });

    const raw = completion.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(raw) as { fields?: Array<Record<string, any>> };
    const fields: ExtractedField[] = [];
    const warnings: string[] = [];

    for (const item of parsed.fields || []) {
      const field = String(item.field || '');
      if (!ENFORCEMENT_EXTRACTABLE_FIELDS.includes(field)) continue;
      const valueText = String(item.value ?? '').trim();
      const quote = String(item.quote ?? '').trim();
      if (!valueText || !quote) continue;

      // Цитата обязана встречаться в документе — иначе это пересказ, а не доказательство.
      const normalizedText = text.replace(/\s+/g, ' ');
      if (!normalizedText.includes(quote.replace(/\s+/g, ' ').slice(0, 40))) {
        warnings.push(`Поле «${field}» отброшено: цитата не найдена в документе.`);
        continue;
      }

      fields.push({
        field,
        value_text: valueText,
        value_raw: normalizeAiValue(field, valueText),
        quote,
        confidence: Math.min(0.9, Math.max(0, Number(item.confidence) || 0.6)),
        extractor: 'ai',
      });
    }

    return { doc_kind: null, fields, warnings };
  } catch (error: any) {
    return { doc_kind: null, fields: [], warnings: [`ИИ-разбор не удался: ${error?.message || error}`] };
  }
}

function normalizeAiValue(field: string, valueText: string): any {
  if (field.endsWith('_kopecks')) return parseAmountToKopecks(valueText);
  if (field === 'started_on' || field.startsWith('debt_period')) return parseRuDate(valueText);
  if (field === 'ground') {
    const lower = valueText.toLowerCase();
    return (ENFORCEMENT_GROUNDS as readonly string[]).includes(lower) ? lower : 'other';
  }
  return valueText;
}

/** Полный разбор документа: regex + ИИ, regex имеет приоритет при совпадении поля. */
export async function extractEnforcementFields(text: string): Promise<ExtractionOutcome> {
  const byRegex = extractByRegex(text);
  const byAi = await extractByAi(text);

  const fields = [...byRegex.fields];
  for (const candidate of byAi.fields) {
    const existing = fields.find((item) => item.field === candidate.field);
    if (!existing) {
      fields.push(candidate);
      continue;
    }
    // Значения разошлись — это конфликт, человек должен увидеть оба.
    if (String(existing.value_text).toLowerCase() !== String(candidate.value_text).toLowerCase()) {
      fields.push({ ...candidate, confidence: Math.min(candidate.confidence, 0.5) });
    }
  }

  return {
    doc_kind: byRegex.doc_kind,
    fields,
    warnings: [...byRegex.warnings, ...byAi.warnings],
  };
}
