/**
 * Маршрутизатор входящей почты «Катерина»: по СОДЕРЖАНИЮ письма выбирает один маршрут —
 * новая заявка (→ заказ менеджеру), бухгалтерия / логистика / юрист (→ пересылка в отдел)
 * или «не заявка» (пропуск).
 *
 * Решение:
 *  1) Детерминированные пре-фильтры (в воркере): noreply-отправитель → пропуск без AI;
 *     переписка по заказу (Re/тег CRM) не может стать НОВОЙ заявкой (заказ не плодим), но
 *     по содержанию всё равно может уйти в отдел.
 *  2) AI выбирает ровно один маршрут из пяти.
 *
 * Прод-промпт живёт в БД (ai_prompts, key 'email_secretary_classifier');
 * здесь встроенный дефолт-fallback.
 */
import { getOpenAIClient, isOpenAIConfigured } from '@/utils/openai';
import { supabase } from '@/utils/supabase';

export const SECRETARY_PROMPT_KEY = 'email_secretary_classifier';

/** Технические коды маршрутов, которые возвращает AI. Отделы = пересылка, остальное — заказ/пропуск. */
export type EmailRoute = 'new_request' | 'accounting' | 'logistics' | 'legal' | 'procurement' | 'not_request';
export const DEPARTMENT_ROUTES: ReadonlyArray<EmailRoute> = ['accounting', 'logistics', 'legal', 'procurement'];

export interface RouteVerdict {
    route: EmailRoute;
    confidence: number; // 0..1
    reasoning: string; // на русском
}

export interface EmailForClassification {
    fromEmail?: string | null;
    fromName?: string | null;
    subject?: string | null;
    bodyText?: string | null;
}

/**
 * Признак «письмо относится к существующему заказу» → переписку пропускаем (AI не читаем).
 * Срабатывает на ЛЮБОЙ из двух признаков:
 *  1) латинский токен `Re` перед двоеточием (Re:, RE:, RE[2]:, "RE: RE:") — ответ в ветке;
 *     кириллическое «Ре…» (Реквизиты) и `Fwd`/`FW` без `Re` сюда НЕ относятся;
 *  2) служебный тег RetailCRM `[#N/NNNNN]` в теме — CRM сама вешает его на переписку по заказу,
 *     поэтому он = существующий заказ независимо от Re/FW (ловит FW-переписку).
 */
export function isReplyThread(subject?: string | null): boolean {
    if (!subject) return false;
    if (/\[#\d+\/\d+\]/.test(subject)) return true; // CRM-тег существующего заказа
    return /(^|\s)re(\s*\[\d+\])?\s*:/i.test(subject);
}

/**
 * Отправитель-робот (noreply/no-reply/donotreply) — тендерные площадки и авто-уведомления.
 * По решению владельца такие письма НЕ заводим как заявку (= спам), AI не вызываем.
 */
export function isNoReplySender(fromEmail?: string | null): boolean {
    if (!fromEmail) return false;
    const local = fromEmail.split('@')[0]?.toLowerCase() || '';
    return /no-?reply|donotreply|do-not-reply/.test(local);
}

const DEFAULT_SYSTEM_PROMPT = `Ты — Катерина, секретарь компании, торгующей металлоконструкциями/шкафами/стеллажами (B2B).
Твоя задача — определить ЕДИНСТВЕННЫЙ маршрут входящего письма по его СОДЕРЖАНИЮ.

Верни ровно один код маршрута (route):

1) "new_request" — НОВАЯ ЗАЯВКА от клиента: запрос коммерческого предложения (КП), счёта, цены, наличия, расчёта, сроков изготовления/поставки; ТЗ/спецификация на просчёт; приглашение к участию в тендере/закупке. Любое реальное намерение купить НАШУ продукцию / получить НАШЕ предложение.

2) "accounting" — БУХГАЛТЕРИЯ: счета на оплату и подтверждения оплаты, акты сверки, закрывающие документы (акты, накладные, УПД, счёт-фактуры), запрос/обмен реквизитов, вопросы по НДС и налогам, ЭДО по документам, возврат денежных средств, дебиторка/кредиторка.

3) "logistics" — ЛОГИСТИКА: доставка и отгрузка, сроки и статус доставки, самовывоз, адрес доставки, транспортная компания, габариты/вес/упаковка для перевозки, повреждение/недостача при доставке.

4) "legal" — ЮРИСТ: договоры и их согласование, претензии и рекламации с юридическими требованиями, суд/иски, штрафы/неустойки/пени, проверка контрагента, юридические запросы и официальные требования.

5) "procurement" — СНАБЖЕНИЕ: письма от ПОСТАВЩИКОВ, которые предлагают/продают товар или услуги НАМ — прайсы и коммерческие предложения в наш адрес, предложения о поставке/сотрудничестве, ответы на наши запросы закупки, наличие/сроки/условия поставки сырья и материалов.

6) "not_request" — НЕ относится к работе: рекламные рассылки и маркетинг; авто-уведомления (пропущенный звонок, голосовая почта, уведомления площадок/порталов); отказ/«неактуально»; нерелевантное.

Правила выбора:
- Маршрут ровно один — выбери НАИБОЛЕЕ подходящий по сути письма.
- Если письмо одновременно про оплату и про новую покупку — приоритет у "new_request" (это новый клиент/сделка).
- Поставщик предлагает товар/услуги НАМ → "procurement" (а не "new_request": это не клиентская заявка).
- Если сомневаешься между отделом и "not_request", и в письме есть реальный рабочий запрос — выбери отдел.

Верни СТРОГО JSON:
{
  "route": "new_request" | "accounting" | "logistics" | "legal" | "procurement" | "not_request",
  "confidence": число от 0 до 1,
  "reasoning": "краткое обоснование на русском (1 предложение)"
}`;

/**
 * Загружает системный промпт секретаря из ai_prompts (key=email_secretary_classifier).
 * При отсутствии/ошибке — встроенный дефолт. Так инструкция живёт там же, где у других агентов.
 */
export async function loadSecretaryPrompt(): Promise<string> {
    try {
        const { data } = await supabase
            .from('ai_prompts')
            .select('system_prompt, is_active')
            .eq('key', SECRETARY_PROMPT_KEY)
            .maybeSingle();
        if (data?.is_active && data.system_prompt) return data.system_prompt as string;
    } catch {
        /* graceful fallback */
    }
    return DEFAULT_SYSTEM_PROMPT;
}

const VALID_ROUTES: ReadonlyArray<EmailRoute> = ['new_request', 'accounting', 'logistics', 'legal', 'procurement', 'not_request'];

/**
 * Определяет маршрут письма (один из пяти). При ошибке/недоступности AI — безопасный дефолт
 * 'not_request' (письмо не теряется: оно останется размеченным, заказ/пересылка не выполнятся).
 */
export async function classifyRoute(
    email: EmailForClassification,
    systemPrompt: string = DEFAULT_SYSTEM_PROMPT
): Promise<RouteVerdict> {
    if (!isOpenAIConfigured()) {
        return { route: 'not_request', confidence: 0, reasoning: 'OpenAI не настроен' };
    }
    const openai = getOpenAIClient();
    const body = (email.bodyText || '').replace(/\s+\n/g, '\n').slice(0, 4000);
    const userContent = `От кого: ${email.fromName || ''} <${email.fromEmail || ''}>
Тема: ${email.subject || '(без темы)'}

Тело письма:
${body || '(пусто)'}`;

    try {
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userContent },
            ],
            response_format: { type: 'json_object' },
            temperature: 0,
        });
        const raw = completion.choices[0].message.content;
        if (!raw) throw new Error('Empty response');
        const parsed = JSON.parse(raw);
        const route: EmailRoute = VALID_ROUTES.includes(parsed.route) ? parsed.route : 'not_request';
        const conf = Number(parsed.confidence);
        return {
            route,
            confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0,
            reasoning: parsed.reasoning ?? '',
        };
    } catch (e: any) {
        console.error('[classifyRoute] error:', e?.message || e);
        return { route: 'not_request', confidence: 0, reasoning: 'Ошибка анализа' };
    }
}
