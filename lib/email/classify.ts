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
import { recordOpenAiOk, recordOpenAiQuotaError } from '@/lib/openai-health';

export const SECRETARY_PROMPT_KEY = 'email_secretary_classifier';

/** Технические коды маршрутов, которые возвращает AI. Отделы = пересылка, остальное — заказ/пропуск. */
export type EmailRoute = 'new_request' | 'accounting' | 'logistics' | 'legal' | 'procurement' | 'not_request';
export const DEPARTMENT_ROUTES: ReadonlyArray<EmailRoute> = ['accounting', 'logistics', 'legal', 'procurement'];

export interface CorporateDetails {
    isCorporate: boolean;
    companyName?: string | null;
    inn?: string | null;
    kpp?: string | null;
    address?: string | null;
    contactName?: string | null;
    contactPhone?: string | null;
    bank?: string | null;
    bik?: string | null;
    bankAccount?: string | null;
    corrAccount?: string | null;
}

export interface RouteVerdict {
    route: EmailRoute;
    confidence: number; // 0..1
    reasoning: string; // на русском
    orderNumber?: string | null;
    failed?: boolean;  // true = анализ не выполнен (сбой AI / не настроен) — НЕ финализировать, повторить
    corporateDetails?: CorporateDetails | null;
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
    /**
     * Справка из CRM (см. lib/email/dossier.ts): проверенные кодом факты — есть ли в базе заказ
     * с указанным в письме номером, история клиента и адреса. Отдаём модели вместе с письмом,
     * чтобы она решала по фактам, а не по формулировкам («новый заказ 1005469» ≠ существующая сделка).
     */
    crmDossier?: string | null;
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
 * Извлекает реальный контакт клиента из структурированного тела письма (напр. уведомления
 * сайта-магазина webasyst: блоки «Email:», «Телефон:», «ПОЛУЧАТЕЛЬ»). Нужно, когда From = адрес
 * робота (noreply@webasyst.biz), а настоящий клиент — в теле. Возвращает то, что нашлось.
 */
export function extractLeadContact(body?: string | null): { email?: string; phone?: string; name?: string } {
    const out: { email?: string; phone?: string; name?: string } = {};
    if (!body) return out;

    // 1. Попробуем извлечь из пересылаемого сообщения (Fwd/Forwarded)
    // От: Митяшина Дарья Александровна <d.mitiashina@avp-group.org>
    // From: ...
    const forwardedM = body.match(/(?:От|From)\s*:\s*([^<\r\n]+?)\s*<([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})>/i);
    if (forwardedM) {
        out.name = forwardedM[1].trim();
        out.email = forwardedM[2].trim().toLowerCase();
    }

    // 2. Если email не найден в шапке пересылки, ищем e-mail по тексту
    if (!out.email) {
        // Поддержка "E - mail : email" и "e-mail: email"
        const emailM = body.match(/(?:e\s*-\s*mail|email|e-mail)\s*[:：]\s*([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i);
        if (emailM) {
            out.email = emailM[1].toLowerCase();
        } else {
            // Фолбэк на старый regex
            const emailOldM = body.match(/e-?mail\s*[:：]\s*([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i);
            if (emailOldM) out.email = emailOldM[1].toLowerCase();
        }
    }

    // 3. Извлечение телефона
    // Поддержка "тел. +7 ...", "тел: +7 ...", "тел +7 ...", "телефон +7 ...", "phone +7 ..."
    const phoneM = body.match(/(?:тел(?:ефон)?|phone)\s*[\.:：]?\s*(\+?\d[\d()\-\s]{5,}\d)/i);
    if (phoneM) {
        out.phone = phoneM[1].replace(/[()\-\s]/g, '');
    }

    // 4. Извлечение имени получателя/плательщика (для форм с сайта)
    if (!out.name) {
        const nameM = body.match(/ПОЛУЧАТЕЛЬ\s*[\r\n]+\s*([^\r\n]{1,80})/i)
            || body.match(/ПЛАТЕЛЬЩИК\s*[\r\n]+\s*([^\r\n]{1,80})/i);
        if (nameM) out.name = nameM[1].trim();
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
 * В теме есть служебный тег RetailCRM `[#N/NNNNN]` — ОПРЕДЕЛЁННО переписка по существующему заказу
 * (CRM сама вешает его). В отличие от «Re:», тег не бывает у спама — надёжный признак.
 */
export function hasCrmOrderTag(subject?: string | null): boolean {
    return !!subject && /\[#\d+\/\d+\]/.test(subject);
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
Твоя задача — определить ЕДИНСТВЕННЫЙ маршрут входящего письма по его СОДЕРЖАНИЮ и при наличии реквизитов извлечь данные компании (корпоративного клиента).

Верни ровно один код маршрута (route):

1) "new_request" — НОВАЯ ЗАЯВКА от клиента: запрос коммерческого предложения (КП), счёта, цены, наличия, расчёта, сроков изготовления/поставки; ТЗ/спецификация на просчёт; приглашение к участию в тендере/закупке. Любое реальное намерение купить НАШУ продукцию / получить НАШЕ предложение.

2) "accounting" — БУХГАЛТЕРИЯ: документы и деньги по УЖЕ ИДУЩЕЙ сделке — подтверждение оплаты, акты сверки, закрывающие документы (акты, накладные, УПД, счёт-фактуры), обмен реквизитами, вопросы по НДС и налогам, ЭДО по документам, возврат денежных средств, дебиторка и кредиторка. ВАЖНО: просьба клиента ВЫСТАВИТЬ СЧЁТ на покупку продукции — это НЕ бухгалтерия, а "new_request" (клиент хочет купить). Бухгалтерия начинается там, где счёт уже выставлен.

3) "logistics" — ЛОГИСТИКА: доставка и отгрузка, сроки и статус доставки, самовывоз, адрес доставки, транспортная компания, габариты/вес/упаковка для перевозки, повреждение/недостача при доставке.

4) "legal" — ЮРИСТ: договоры и их согласование, претензии и рекламации с юридическими требованиями, суд/иски, штрафы/неустойки/пени, проверка контрагента, юридические запросы и официальные требования.

5) "procurement" — СНАБЖЕНИЕ: отправитель САМ ПРЕДЛАГАЕТ продать нам товар или услуги — прайсы, каталоги, рекламные рассылки поставщиков («в наличии», «акция», «новинка», «снижение цен»), предложения поставки и сотрудничества, предложения услуг (сертификация, обучение, логистика, реклама, IT, клининг). Отдел снабжения сам решает, что из этого ему полезно. Переписка по нашему собственному заказу (тег вида [#номер], «Re:», «уточнение по заказу») — это НЕ снабжение.

6) "not_request" — НЕ относится к работе: авто-уведомления (пропущенный звонок, голосовая почта, уведомления площадок и порталов); автоматические дайджесты закупок торговых площадок; отказ и «неактуально»; нерелевантные письма; рассылки, НЕ связанные с поставкой нам товаров или услуг (например, приглашения на мероприятия не по нашему профилю). ВАЖНО: рекламные рассылки ПОСТАВЩИКОВ, которые предлагают нам товары или услуги, — это "procurement", а не "not_request".

Правила выбора:
- Маршрут ровно один — выбери НАИБОЛЕЕ подходящий по сути письма.
- Если письмо одновременно про оплату и про новую покупку — приоритет у "new_request" (это новый клиент/сделка).
- Отправитель предлагает нам свой товар или услуги → "procurement" (это не клиентская заявка).
- Если сомневаешься между отделом и "not_request", и в письме есть реальный рабочий запрос — выбери отдел.
- ВАЖНО про вложения: суть письма часто только во вложении (ТЗ, спецификация, заявка), а тело пустое.
  Пустое тело САМО ПО СЕБЕ не означает "not_request". Учитывай тему и имена вложений: если в теме или в
  названии файла есть "заявка", "запрос", "ТЗ", "техническое задание", "спецификация", "КП", "просчёт",
  "смета", "стоимость", "прайс под наш заказ" и т.п. — это, как правило, "new_request" (или нужный отдел),
  а не "not_request". Не отбрасывай письмо только потому, что текста в теле нет.

СПРАВКА ИЗ CRM (если она есть в конце сообщения) — ЭТО ФАКТЫ, ОНИ СИЛЬНЕЕ СЛОВ ПИСЬМА:
- Номер из письма НЕ найден в CRM → сделки у нас нет. Значит это НЕ бухгалтерия и НЕ переписка по заказу; если в письме есть покупка нашей продукции (заказ с сайта-магазина, позиции, сумма, контакт клиента) — это "new_request".
- Номер НАЙДЕН в CRM → письмо действительно про существующую сделку; выбирай отдел по сути (документы и деньги → "accounting", доставка → "logistics", договор и претензия → "legal").
- Уведомление нашего интернет-магазина об оформленном заказе («Новый заказ N», состав, сумма, контакты покупателя), которого нет в CRM, — это НОВАЯ ЗАЯВКА клиента: "new_request".
- Клиент без заказов в CRM («новый контакт») — довод против трактовки «уже идущая сделка».

КАК ОТЛИЧИТЬ ЗАЯВКУ ОТ СНАБЖЕНИЯ — СМОТРИ, ЧТО ДЕЛАЕТ ОТПРАВИТЕЛЬ:
- ПРОСИТ У НАС (счёт, КП, цену, наличие, сроки, расчёт; «нужно», «требуется», «можете изготовить/поставить»; прислал ТЗ, спецификацию или карточку предприятия на просчёт) → "new_request". Запрос счёта НА ПОКУПКУ нашей продукции — это "new_request", а не бухгалтерия: бухгалтерия занимается документами по УЖЕ существующей сделке.
- ПРЕДЛАГАЕТ НАМ свой товар или услуги → "procurement". Сюда же письма, где отправитель ОПИСЫВАЕТ СВОЮ продукцию, условия и цены — «коммерческое предложение» от него, прайс, каталог, презентация предприятия, «готовы поставить вам», предложение сотрудничества. Слова «коммерческое предложение» в теме заявкой это не делают: важно, чьё предложение — наше просят или своё присылают.
- ПРИГЛАШЕНИЕ к участию в конкретной закупке, тендере, закупочной сессии или запросе котировок, где заказчик зовёт нас подать предложение на понятный предмет закупки → "new_request". Слово «закупка» в теме само по себе снабжением не делает.
- НО: автоматические дайджесты и рассылки торговых площадок с ПЕРЕЧНЕМ закупок за дату («Закупки по вашей сфере деятельности за 07.07», «Позиции планов закупок», «ЦЗ за …») → "not_request": это подписка на ленту процедур, а не адресное приглашение. Услуги по сопровождению тендеров, предлагаемые нам, → "procurement".
- Должность отправителя и слова «снабжение», «закуп», «тендер» в адресе, подписи или теме значения НЕ имеют — смотри только на то, просят у нас или предлагают нам.

Верни СТРОГО JSON:
{
  "route": "new_request" | "accounting" | "logistics" | "legal" | "procurement" | "not_request",
  "confidence": число от 0 до 1,
  "reasoning": "краткое обоснование на русском (1 предложение)",
  "order_number": "найденный в теме или тексте письма номер заказа (строка только из цифр, например: '53759'), если в теме/письме явно указан конкретный номер существующего заказа нашей компании; иначе null",
  "corporate_details": {
    "is_corporate": true, // true, если в письме/теме есть реквизиты компании (ИНН, КПП, ОГРН, р/счет, название компании вроде ООО, ИП, ЗАО, ОАО, АО) или запрос явно исходит от организации/бизнеса; иначе false
    "company_name": "Краткое название компании (например: ООО «Нейровет» или ИП Иванов)", // null, если нет
    "inn": "ИНН компании (строка только из цифр)", // null, если нет
    "kpp": "КПП компании (строка только из цифр)", // null, если нет
    "address": "Фактический или юридический адрес компании", // null, если нет
    "contact_name": "Имя контактного лица (ФИО или Имя из подписи/текста, например: Александр Тельнов)", // null, если нет
    "contact_phone": "Телефон контактного лица (только цифры)", // null, если нет
    "bank": "Название банка для реквизитов", // null, если нет
    "bik": "БИК банка для реквизитов (только цифры)", // null, если нет
    "bank_account": "Расчетный счет (р/с, только цифры)", // null, если нет
    "corr_account": "Корреспондентский счет (к/с, только цифры)" // null, если нет
  }
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
    const dossierBlock = email.crmDossier && email.crmDossier.trim()
        ? `\n\n${email.crmDossier.trim()}`
        : '';
    const userContent = `От кого: ${email.fromName || ''} <${email.fromEmail || ''}>
Тема: ${email.subject || '(без темы)'}${attachmentsLine}

Тело письма:
${body || '(пусто — суть письма может быть во вложении и/или в теме)'}${dossierBlock}`;

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
        void recordOpenAiOk(); // вызов прошёл → снимаем алерт «исчерпан баланс OpenAI», если висел
        const raw = completion.choices[0].message.content;
        if (!raw) throw new Error('Empty response');
        const parsed = JSON.parse(raw);
        const route: EmailRoute = VALID_ROUTES.includes(parsed.route) ? parsed.route : 'not_request';
        const conf = Number(parsed.confidence);
        return {
            route,
            confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0,
            reasoning: parsed.reasoning ?? '',
            orderNumber: parsed.order_number ? String(parsed.order_number).trim() : null,
            corporateDetails: parsed.corporate_details ? {
                isCorporate: Boolean(parsed.corporate_details.is_corporate),
                companyName: parsed.corporate_details.company_name || null,
                inn: parsed.corporate_details.inn || null,
                kpp: parsed.corporate_details.kpp || null,
                address: parsed.corporate_details.address || null,
                contactName: parsed.corporate_details.contact_name || null,
                contactPhone: parsed.corporate_details.contact_phone || null,
                bank: parsed.corporate_details.bank || null,
                bik: parsed.corporate_details.bik || null,
                bankAccount: parsed.corporate_details.bank_account || null,
                corrAccount: parsed.corporate_details.corr_account || null,
            } : null,
        };
    } catch (e: any) {
        console.error('[classifyRoute] error:', e?.message || e);
        void recordOpenAiQuotaError(e); // если это исчерпанный баланс — поднимаем алерт для плашки
        return { route: 'not_request', confidence: 0, reasoning: 'Ошибка анализа', failed: true };
    }
}
