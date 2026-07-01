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
import { recordAiUsage, AiAgent } from '@/lib/ai-usage';

export const SECRETARY_PROMPT_KEY = 'email_secretary_classifier';

/** Технические коды маршрутов, которые возвращает AI. Отделы = пересылка, остальное — заказ/пропуск. */
export type EmailRoute = 'new_request' | 'accounting' | 'logistics' | 'legal' | 'procurement' | 'not_request';
export const DEPARTMENT_ROUTES: ReadonlyArray<EmailRoute> = ['accounting', 'logistics', 'legal', 'procurement'];

export interface RouteVerdict {
    route: EmailRoute;
    confidence: number; // 0..1
    reasoning: string; // на русском
    failed?: boolean;  // true = анализ не выполнен (сбой AI / не настроен) — НЕ финализировать, повторить
}

export interface EmailAttachmentMeta {
    filename?: string | null;
    contentType?: string | null;
}

export interface EmailForClassification {
    fromEmail?: string | null;
    fromName?: string | null;
    subject?: string | null;
    bodyText?: string | null;
    bodyHtml?: string | null; // фолбэк, когда plain-текста нет (HTML-only письма)
    attachments?: EmailAttachmentMeta[] | null;
}

/**
 * Грубое извлечение текста из HTML для классификации (когда plain-части нет — HTML-only письма).
 * Не для отображения, только чтобы модель увидела суть письма. Режем стили/скрипты/теги,
 * раскрываем базовые сущности, схлопываем пробелы.
 */
export function stripHtml(html?: string | null): string {
    if (!html) return '';
    return html
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<head[\s\S]*?<\/head>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&rsquo;|&lsquo;/gi, "'")
        .replace(/&[a-z#0-9]+;/gi, ' ')
        .replace(/[^\S\n]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Имена «документных» вложений (ТЗ/спецификации/счета и т.п.) — сильный сигнал о сути письма,
 * особенно когда тело пустое (запрос целиком в файле). Инлайн-картинки из подписи/тела
 * (image/*, встроенные png/jpg, message/rfc822) отбрасываем — это шум, а не вложенный документ.
 */
export function documentAttachmentNames(attachments?: EmailAttachmentMeta[] | null): string[] {
    if (!Array.isArray(attachments)) return [];
    const DOC_EXT = /\.(pdf|docx?|xlsx?|rtf|odt|ods|csv|txt|7z|zip|rar)$/i;
    const out: string[] = [];
    for (const a of attachments) {
        const name = (a?.filename || '').trim();
        const ct = (a?.contentType || '').toLowerCase();
        if (!name) continue;                       // безымянные части (вложенные письма) пропускаем
        if (ct.startsWith('image/')) continue;     // инлайн-картинки из подписи/тела
        if (ct === 'message/rfc822') continue;     // вложенное письмо целиком
        if (ct.startsWith('image/') && !DOC_EXT.test(name)) continue;
        if (!DOC_EXT.test(name) && !ct) continue;  // без расширения и типа — не считаем документом
        out.push(name);
    }
    return out;
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

5) "procurement" — СНАБЖЕНИЕ: письма от ПОСТАВЩИКОВ, которые предлагают/продают товар или услуги НАМ — прайсы и коммерческие предложения в наш адрес, предложения о поставке/сотрудничестве, ответы на наши запросы закупки, наличие/сроки/условия поставки сырья и материалов. ВАЖНО: это всегда НОВОЕ предложение поставщика. Переписка по нашему собственному заказу (тема с тегом вида [#номер] или "Re:"/"уточнение по заказу") — это НЕ снабжение, даже если отправитель похож на торговую компанию.

6) "not_request" — НЕ относится к работе: рекламные рассылки и маркетинг; авто-уведомления (пропущенный звонок, голосовая почта, уведомления площадок/порталов); отказ/«неактуально»; нерелевантное.

Правила выбора:
- Маршрут ровно один — выбери НАИБОЛЕЕ подходящий по сути письма.
- Если письмо одновременно про оплату и про новую покупку — приоритет у "new_request" (это новый клиент/сделка).
- Поставщик предлагает товар/услуги НАМ → "procurement" (а не "new_request": это не клиентская заявка).
- Если сомневаешься между отделом и "not_request", и в письме есть реальный рабочий запрос — выбери отдел.
- ВАЖНО про вложения: суть письма часто только во вложении (ТЗ, спецификация, заявка), а тело пустое.
  Пустое тело САМО ПО СЕБЕ не означает "not_request". Учитывай тему и имена вложений: если в теме или в
  названии файла есть "заявка", "запрос", "ТЗ", "техническое задание", "спецификация", "КП", "просчёт",
  "смета", "стоимость", "прайс под наш заказ" и т.п. — это, как правило, "new_request" (или нужный отдел),
  а не "not_request". Не отбрасывай письмо только потому, что текста в теле нет.

РАЗЛИЧАЙ НАПРАВЛЕНИЕ СДЕЛКИ, А НЕ ДОЛЖНОСТЬ ОТПРАВИТЕЛЯ (важно для выбора между "new_request" и "procurement"):
- Отправитель ХОЧЕТ КУПИТЬ наш товар или просит ИЗГОТОВИТЬ/ПОСТАВИТЬ ему продукцию ("нужно", "необходимо к закупу", "есть возможность поставки?", "можете поставить/изготовить", прислал ТЗ/спецификацию/карточку предприятия) — это КЛИЕНТ → "new_request". ДАЖЕ если отправитель из "отдела снабжения"/снабженец и пишет слова "закуп", "снабжение", "поставка". Должность отправителя НЕ делает письмо снабжением.
- "procurement" — ТОЛЬКО когда отправитель САМ ПРЕДЛАГАЕТ ПРОДАТЬ что-то НАМ ("предлагаем", "наш прайс", "готовы поставить вам", каталог поставщика). Признак снабжения: он продаёт НАМ, а не мы ему.

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
 * Определяет маршрут письма (один из пяти). При ошибке/недоступности AI возвращает failed=true —
 * воркер НЕ финализирует такое письмо (оставляет на повтор), чтобы транзиентный сбой не «съел» заявку.
 */
export async function classifyRoute(
    email: EmailForClassification,
    systemPrompt: string = DEFAULT_SYSTEM_PROMPT
): Promise<RouteVerdict> {
    if (!isOpenAIConfigured()) {
        return { route: 'not_request', confidence: 0, reasoning: 'OpenAI не настроен', failed: true };
    }
    const openai = getOpenAIClient();
    // Тело для анализа: plain-текст, а если его нет (HTML-only письмо) — вытаскиваем из HTML.
    const rawBody = (email.bodyText && email.bodyText.trim()) ? email.bodyText : stripHtml(email.bodyHtml);
    const body = (rawBody || '').replace(/\s+\n/g, '\n').slice(0, 4000);
    const docs = documentAttachmentNames(email.attachments);
    const attachmentsLine = docs.length
        ? `\nВложения (документы): ${docs.join('; ')}`
        : '';
    const userContent = `От кого: ${email.fromName || ''} <${email.fromEmail || ''}>
Тема: ${email.subject || '(без темы)'}${attachmentsLine}

Тело письма:
${body || '(пусто — суть письма может быть во вложении и/или в теме)'}`;

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
        await recordAiUsage({ agentId: AiAgent.KATERINA, model: completion.model, usage: completion.usage, purpose: 'email_classify' });
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
        return { route: 'not_request', confidence: 0, reasoning: 'Ошибка анализа', failed: true };
    }
}
