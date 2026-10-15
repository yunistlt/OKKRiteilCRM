import { supabase } from '@/utils/supabase';
import { fetchRetailCrmOrder } from './orders';
import {
    buildLeadCustomerCustomFields,
    buildLeadOrderCustomFields,
    unspecifiedLabel,
    type LeadFieldHints,
} from './lead-defaults';
import { routeNewOrder } from '@/lib/own-crm/own-order-insert';
import { clientHintsForOrder, existingClientHint } from '@/lib/own-crm/lead-client';
import { assignManagerForNewOrder } from '@/lib/own-crm/assign-manager';

export async function getCrmConfig() {
    const url = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL;
    const key = process.env.RETAILCRM_API_KEY;
    const site = process.env.RETAILCRM_SITE;
    if (!url || !key) throw new Error('RetailCRM config missing: URL or API_KEY');
    if (!site) throw new Error('RetailCRM config missing: RETAILCRM_SITE (shop code) is not set in environment variables');
    return { url: url.replace(/\/+$/, ''), key, site };
}

export type CorporateLeadDetails = {
    isCorporate?: boolean;
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
};

/**
 * Заявка из веб-формы без ТЗ (обратный звонок / контактная форма): в теле только
 * телефон + согласие на обработку ПДн + страница, откуда пришли; вложений нет.
 * Сравнивать в тендер-дедупе нечего — иначе разные клиенты с одной страницы товара
 * склеиваются в «дубль». Признак: нет вложений И тело имеет разметку веб-формы.
 */
function isFormWithoutTZ(params: {
    subject?: string;
    bodySnippet?: string;
    attachmentNames?: string[];
    attachmentText?: string;
}): boolean {
    if ((params.attachmentNames || []).filter(Boolean).length > 0) return false;
    if ((params.attachmentText || '').trim().length > 0) return false;
    const haystack = `${params.subject || ''}\n${params.bodySnippet || ''}`.toLowerCase();
    return /с какой страницы|согласие на обработку|обратн\w* звонок|заказать звонок|перезвон/i.test(haystack);
}

/**
 * Создать заявку по входящему ПИСЬМУ (AI-секретарь «Катерина»).
 * Статус «Новая» (novyi-1). Менеджер назначается сразу, если передан.
 * Возвращает id и номер созданного заказа.
 */
/**
 * Заявка без менеджера не создаётся (требование владельца 02.10.2026): её
 * никто не ведёт, она не попадает ни в план дня, ни в зарплату, ни в ОКК.
 * Если поток не назвал менеджера — выбираем так же, как автоприём почты.
 */
async function ensureManager(orderData: any): Promise<void> {
    const assignment = await assignManagerForNewOrder({
        managerId: orderData?.managerId,
        email: orderData?.email,
        phone: orderData?.phone,
    });
    orderData.managerId = assignment.managerId;
}

export async function createEmailLead(params: {
    email: string;
    name?: string;
    phone?: string;
    subject?: string;
    bodySnippet?: string;
    attachmentNames?: string[];
    managerId?: number | null;
    corporateDetails?: CorporateLeadDetails | null;
    attachmentText?: string;
    fieldHints?: LeadFieldHints;
}): Promise<{ id: number; number: string }> {
    // Клиент всегда корпоративный (B2B). Карточку найдёт или заведёт запись
    // заказа — по ИНН, затем по названию с почтой или телефоном. В RetailCRM
    // карточки больше не уходят (решение владельца 15.10.2026).
    const existingCustomerHint = await existingClientHint({ email: params.email, phone: params.phone });

    // Проверка на дубликат тендера
    let assignedManagerId = params.managerId;
    let duplicateReason = '';
    let duplicateOfNumber: string | null = null;
    
    try {
        if (isFormWithoutTZ(params)) {
            // Веб-форма без ТЗ (обратный звонок / контактная форма): тело — телефон
            // + согласие + страница, сравнивать нечего. Тендер-дедуп не запускаем,
            // иначе разные клиенты с одной страницы товара склеиваются в «дубль».
            console.log('[Tender Duplicate] Пропуск: заявка из веб-формы без ТЗ');
        } else {
            const { findTenderDuplicate } = await import('./tender-duplicates');
            const dupResult = await findTenderDuplicate({
                bodyText: params.bodySnippet || '',
                attachmentText: params.attachmentText || '',
                attachmentNames: params.attachmentNames || [],
                deliveryAddress: params.corporateDetails?.address || null
            });

            if (dupResult) {
                assignedManagerId = dupResult.managerId;
                duplicateOfNumber = dupResult.refOrderNumber;
                duplicateReason = `\n\n⚠️ ДУБЛИКАТ ТЕНДЕРА: обнаружен дублирующий запрос на тендер (ранее создан заказ №${dupResult.refOrderNumber}, ответственный менеджер назначен автоматически)`;
            }
        }
    } catch (dupErr) {
        console.error('Error running duplicate check:', dupErr);
    }

    // Мягкая пометка «возможно дубль»: у клиента уже есть заказ за последние N дней.
    // Заказ всё равно создаём — по разметке менеджеров (78 дублей из 399 заказов секретаря за
    // 60 дней) такие письма примерно в половине случаев оказываются ЗАКОННОЙ новой заявкой, и
    // автоматически отличить их нельзя: ни сходство текста (медиана 0.79 у дублей против 0.80 у
    // законных), ни совпадение темы (47% против 39%) не разделяют. Поэтому решение оставляем
    // менеджеру, но показываем ему предыдущий заказ сразу в карточке, чтобы не искать вручную.
    let recentHint = '';
    if (!duplicateOfNumber && params.email) {
        try {
            const { getDuplicateHintDays } = await import('@/lib/email/routes');
            const hintDays = await getDuplicateHintDays();
            const since = new Date(Date.now() - hintDays * 86400000).toISOString();
            const { data: recent } = await supabase
                .from('orders')
                .select('number, created_at')
                // Регистр email в CRM не нормализован; lower() в фильтр не завернуть (иначе не
                // сработает индекс idx_orders_raw_email_created) — сравниваем оба варианта.
                .in('raw_payload->>email', Array.from(new Set([params.email.trim(), params.email.trim().toLowerCase()])))
                .gte('created_at', since)
                .order('created_at', { ascending: false })
                .limit(1);
            const prev = recent?.[0];
            if (prev) {
                const days = Math.floor((Date.now() - new Date(prev.created_at).getTime()) / 86400000);
                const when = days === 0 ? 'сегодня' : `${days} дн. назад`;
                recentHint = `возможно дубль ${prev.number} (заявка того же клиента ${when}) — проверьте`;
            }
        } catch (hintErr) {
            console.error('Error running recent-order hint:', hintErr);
        }
    }

    const attNames = (params.attachmentNames || []).filter(Boolean);
    const bodyPart = (params.bodySnippet || '').trim()
        || (attNames.length ? 'Тело письма пустое — суть во вложении (прикреплено к заказу).' : 'не распознано — открыть письмо');
    const attLine = attNames.length ? `\n\n📎 Вложения: ${attNames.join(', ')}` : '';
    const comment = `✉️ Заявка принята AI-секретарём (входящее письмо)
 
📧 Email: ${params.email || 'не определён'}${params.phone ? `\n📱 Телефон: ${params.phone}` : ''}
📨 Тема: ${params.subject || '(без темы)'}
 
📝 Текст письма:
${bodyPart}${attLine}${duplicateReason}`;

    const orderData: any = {
        status: 'novyi-1', // всегда «Новая»
        firstName: params.corporateDetails?.contactName || params.name || 'Клиент',
        customerComment: comment,
        // Реквизиты из письма: по ИНН и названию запись заказа найдёт карточку
        // клиента или заведёт её. Без них карточка плодилась бы на каждую заявку.
        ...clientHintsForOrder(params.corporateDetails),
        source: { source: 'email-secretary' },
        // Обязательные поля карточки: без них менеджер не сохранит заказ.
        customFields: await buildLeadOrderCustomFields(params.fieldHints),
    };
    if (params.email) orderData.email = params.email;
    if (params.phone) orderData.phone = params.phone;
    if (duplicateOfNumber) {
        orderData.managerComment = `дубль ${duplicateOfNumber}`;
    } else if (recentHint) {
        orderData.managerComment = recentHint;
    }
    if (existingCustomerHint) {
        orderData.managerComment = orderData.managerComment
            ? `${orderData.managerComment}\n${existingCustomerHint}`
            : existingCustomerHint;
    }
    if (assignedManagerId) orderData.managerId = assignedManagerId;

    await ensureManager(orderData);
    const orderResult = await routeNewOrder(orderData);
    const number = (orderResult.order && orderResult.order.number) || orderResult.number || String(orderResult.id);
    return { id: orderResult.id as number, number: String(number) };
}

// Форматирует найденные в каталоге ЗМК позиции с реальной ценой — для менеджера.
// Цена показывается только менеджеру в комментарии заказа; клиенту в чате она не озвучивается.
export function formatMatchedCatalogProducts(
    products?: Array<{ name: string; price: number; url?: string; category?: string; priceSource?: 'live' | 'cache' | 'none' }>
): string {
    if (!products || products.length === 0) return '';
    const lines = products
        .filter((p) => p && p.name)
        .map((p, i) => {
            let priceStr: string;
            if (p.price > 0) {
                const note = p.priceSource === 'cache' ? ' (из кэша, сверьте на сайте)' : ' (актуально с сайта)';
                priceStr = `${Math.round(p.price).toLocaleString('ru-RU')} ₽${note}`;
            } else {
                // Цены нет ни живой, ни в выгрузке: на сайте её не задали.
                priceStr = 'цены на сайте нет — надо актуализировать';
            }
            return `${i + 1}. ${p.name} — ${priceStr}${p.url ? ` — ${p.url}` : ''}`;
        });
    if (lines.length === 0) return '';
    return `\n📦 НАЙДЕНО В КАТАЛОГЕ ЗМК (реальная цена — для менеджера; клиенту НЕ озвучена):\n${lines.join('\n')}\n`;
}

export async function createLeadInCrm(params: {
    name: string;
    phone?: string;
    email?: string;
    telegram?: string;
    query_summary: string;
    domain?: string;
    utm?: any;
    items?: string[];
    city?: string;
    history?: Array<{ role: string; content: string }>;
    visitedPages?: Array<{ url: string; title: string }>;
    managerId?: number | null;
    matchedCatalogProducts?: Array<{ name: string; price: number; url?: string; category?: string; priceSource?: 'live' | 'cache' | 'none' }>;
    corporateDetails?: CorporateLeadDetails | null;
    orderMethod?: string;
    fieldHints?: LeadFieldHints;
}) {
    console.log('Creating lead in RetailCRM:', params);
    // Категорию товара подсказывает каталог, если Елена подобрала позиции.
    const fieldHints: LeadFieldHints = {
        productCategory: params.matchedCatalogProducts?.find((p) => p.category)?.category || null,
        ...params.fieldHints,
    };

    /**
     * Клиента в RetailCRM не заводим: карточку найдёт или создаст у себя
     * `insertOwnOrder` (по ИНН, затем по названию с почтой или телефоном).
     * Раньше карточка появлялась в RetailCRM, у нас её не было, и в заказе
     * пустовали компания и реквизиты — разбор заказа 1039А (02.10.2026).
     */
    const existingCustomerHint = await existingClientHint({ email: params.email, phone: params.phone });

    // 3. Format Manager Comment
    const visitedPagesStr = params.visitedPages?.slice(-5).map(p => p.url).join(', ') || 'неизвестно';
    const cityStr = params.city || 'не определен';
    const telegramStr = params.telegram ? `Telegram: ${params.telegram}` : '';
    
    let historyLog = '';
    if (params.history) {
        historyLog = params.history.map(h => `${h.role === 'user' ? 'Клиент' : 'ИИ'}: ${h.content}`).join('\n');
    }

    const catalogBlock = formatMatchedCatalogProducts(params.matchedCatalogProducts);

    const managerComment = `🔥 НОВЫЙ ЛИД ИЗ ИИ-ЧАТА

📍 ГЕО: ${cityStr}
📱 КОНТАКТЫ: ${telegramStr || params.phone || params.email || 'указаны в карточке'}

📝 СУТЬ ЗАПРОСА (Анализ от Семёна):
${params.query_summary}

-------------------------------------------
🔎 ДЕТАЛИ:
- Страницы: ${visitedPagesStr}
- Товары: ${params.items?.join(', ') || 'не указаны'}
${catalogBlock}
📜 КРАТКИЙ ЛОГ ДИАЛОГА:
${historyLog.split('\n').slice(-10).join('\n')}
`;

    // 2. Create Order/Lead
    const orderData: any = {
        status: 'novyi-1', // Correct code for "Новый" from dictionary
        orderMethod: params.orderMethod || 'live-chat',
        lastName: 'ИИ-Лид',
        firstName: params.corporateDetails?.contactName || params.name || 'Клиент',
        phone: params.phone,
        email: params.email,
        customerComment: managerComment,
        ...clientHintsForOrder(params.corporateDetails),
        ...(existingCustomerHint ? { managerComment: existingCustomerHint } : {}),
        source: {
            source: params.utm?.source || 'ai-widget',
            medium: params.utm?.medium || 'chat',
            campaign: params.utm?.campaign || ''
        },
        // Обязательные поля карточки: без них менеджер не сохранит заказ.
        customFields: await buildLeadOrderCustomFields(fieldHints),
    };


    if (params.managerId) {
        orderData.managerId = params.managerId;
    }

    if (params.items && params.items.length > 0) {
        orderData.customerComment += `\nИнтересовался товарами: ${params.items.join(', ')}`;
    }

    await ensureManager(orderData);
    // Заказ заводится у нас; не записался — `insertOwnOrder` бросает сам.
    return routeNewOrder(orderData);
}

/**
 * Создать заявку по входящему звонку (AI-секретарь Телфина).
 * Статус всегда «Новая» (novyi-1). Менеджер назначается сразу, если передан.
 * Возвращает id заказа и его номер (для озвучки клиенту).
 */
export async function createSecretaryLead(params: {
    phone: string;
    name?: string;
    summary?: string;            // распознанная суть запроса (voice_navigator_STT)
    managerId?: number | null;   // выбранный по нагрузке менеджер
    fieldHints?: LeadFieldHints;
}): Promise<{ id: number; number: string }> {
    // Клиент всегда корпоративный (B2B). Карточку найдёт или заведёт запись
    // заказа: по звонку известен только телефон, по нему и ищем.
    const existingCustomerHint = await existingClientHint({ phone: params.phone });

    const comment = `📞 Заявка принята AI-секретарём (входящий звонок)

📱 Телефон: ${params.phone || 'не определён'}

📝 Суть запроса (распознано):
${params.summary?.trim() || 'не распознано — уточнить у клиента'}`;

    const orderData: any = {
        status: 'novyi-1', // всегда «Новая»
        firstName: params.name || 'Клиент',
        phone: params.phone,
        customerComment: comment,
        ...(existingCustomerHint ? { managerComment: existingCustomerHint } : {}),
        source: { source: 'telphin-secretary' },
        // Обязательные поля карточки: без них менеджер не сохранит заказ.
        customFields: await buildLeadOrderCustomFields(params.fieldHints),
    };
    if (params.managerId) orderData.managerId = params.managerId;

    await ensureManager(orderData);
    const orderResult = await routeNewOrder(orderData);

    const number = (orderResult.order && orderResult.order.number) || orderResult.number || String(orderResult.id);
    return { id: orderResult.id as number, number: String(number) };
}
