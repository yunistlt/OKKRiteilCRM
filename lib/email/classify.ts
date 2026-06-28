/**
 * Воркер «Новые заявки»: ЕДИНСТВЕННАЯ задача — найти среди входящих писем новые заявки
 * и создать по ним заказ. Никакой другой аналитики (рекламации, вопросы, отказы) НЕ делает.
 *
 * Двухступенчатое решение:
 *  1) Детерминированный пре-фильтр isReplyThread(): если в теме есть `Re` — это переписка
 *     по существующему заказу → письмо ПРОПУСКАЕМ, AI даже не вызываем.
 *  2) Для писем без `Re` — AI отвечает бинарно: это новая заявка или нет.
 *
 * Прод-промпт должен жить в БД (ai_prompts, key 'email_new_request_classifier');
 * здесь встроенный дефолт-fallback.
 */
import { getOpenAIClient, isOpenAIConfigured } from '@/utils/openai';
import { supabase } from '@/utils/supabase';

export const SECRETARY_PROMPT_KEY = 'email_secretary_classifier';

export interface NewRequestVerdict {
    isNewRequest: boolean;
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

const DEFAULT_SYSTEM_PROMPT = `Ты — фильтр входящей почты отдела продаж компании, торгующей металлоконструкциями/шкафами/стеллажами (B2B).
Твоя ЕДИНСТВЕННАЯ задача — определить, является ли письмо НОВОЙ ЗАЯВКОЙ, по которой нужно завести заказ.

НОВАЯ ЗАЯВКА (is_new_request = true): клиент запрашивает коммерческое предложение (КП), счёт, цену, наличие, расчёт, сроки изготовления/поставки; присылает ТЗ/спецификацию на просчёт; приглашает к участию в тендере/закупке. Любое реальное намерение купить/получить предложение.

НЕ заявка (is_new_request = false): рекламные рассылки и маркетинг; автоматические уведомления (пропущенный звонок, голосовая почта, уведомления площадок/порталов, штрафы, ЭДО); системные письма самой компании (отправитель — собственный домен); отказ/«неактуально»; нерелевантное.
ВАЖНО: письма от ПОСТАВЩИКОВ, которые предлагают/продают товар или услуги НАМ (прайсы, коммерческие предложения в наш адрес, «продаём крепёж/металл/оборудование», «сравните наши цены») — это НЕ заявка (is_new_request = false). Заявка — только когда клиент запрашивает НАШЕ предложение/счёт на НАШУ продукцию.

Верни СТРОГО JSON:
{
  "is_new_request": true | false,
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

export async function classifyNewRequest(
    email: EmailForClassification,
    systemPrompt: string = DEFAULT_SYSTEM_PROMPT
): Promise<NewRequestVerdict> {
    if (!isOpenAIConfigured()) {
        return { isNewRequest: false, confidence: 0, reasoning: 'OpenAI не настроен' };
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
        const conf = Number(parsed.confidence);
        return {
            isNewRequest: parsed.is_new_request === true,
            confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0,
            reasoning: parsed.reasoning ?? '',
        };
    } catch (e: any) {
        console.error('[classifyNewRequest] error:', e?.message || e);
        return { isNewRequest: false, confidence: 0, reasoning: 'Ошибка анализа' };
    }
}
