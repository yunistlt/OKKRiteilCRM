import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { createLeadInCrm, updateExistingOrderInCrm, formatMatchedCatalogProducts } from '@/lib/retailcrm/leads';
import { enrichWithLivePrice } from '@/lib/webasyst';
import { safeEnqueueSystemJob } from '@/lib/system-jobs';
import { recordAiUsage, AiAgent } from '@/lib/ai-usage';
import { getAssignmentContext, resolveAssignment } from '@/lib/email/assign';
import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

function mapPurchaseForm(raw?: string): string {
    if (!raw) return 'trebuetsya-utochnit';
    const val = raw.toLowerCase();
    if (val.includes('прямая') || val.includes('внутренний')) {
        return 'dlya-sebya-pryamaya-zakupka-vnutrennij-tender';
    }
    if (val.includes('гос') || val.includes('44-фз') || val.includes('223-фз') || val.includes('государствен') || val.includes('тендер')) {
        return 'tender';
    }
    if (val.includes('смета')) {
        return 'dlya-sebya-smeta';
    }
    return 'trebuetsya-utochnit';
}

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    try {
        const authHeader = req.headers.get('authorization');
        // Simple security check for CRON
        if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            // In development, we might skip this
        }

        // 1. Find sessions that need processing (any session that isn't a lead yet)
        const { data: sessions, error: sessionsError } = await supabase
            .from('widget_sessions')
            .select('*')
            .eq('is_lead_created', false)
            .or('has_contacts.eq.true,utm_campaign.not.is.null') // Берем те, где есть контакты ИЛИ пришли с UTM кампанией заказа
            .order('updated_at', { ascending: false })
            .limit(10);

        // Закрываем старые сессии (> 3 дней без движения) у которых has_contacts = false и нет utm_campaign,
        // чтобы они не крутились вечно
        const cutoff3d = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
        await supabase
            .from('widget_sessions')
            .update({ is_lead_created: true })
            .eq('is_lead_created', false)
            .eq('has_contacts', false)
            .is('utm_campaign', null)
            .lt('updated_at', cutoff3d);

        if (sessionsError) throw sessionsError;
        if (!sessions || sessions.length === 0) {
            return NextResponse.json({ message: 'No sessions to process' });
        }

        const assignmentCtx = await getAssignmentContext();

        const results = [];

        for (const session of sessions) {
            const { data: messages, error: msgsError } = await supabase
                .from('widget_messages')
                .select('role, content, created_at')
                .eq('session_id', session.id)
                .order('created_at', { ascending: true });

            if (msgsError || !messages || messages.length === 0) continue;

            // 1. Проверяем, ответил ли вообще клиент хоть раз
            const hasUserMsg = messages.some((m: any) => m.role === 'user');
            if (!hasUserMsg) continue;

            // 2. Проверяем неактивность (ждем завершения диалога)
            const isSimulation = session.visitor_id && session.visitor_id.startsWith('v_lc_sim_');
            const lastMsg = messages[messages.length - 1];
            const lastMsgTime = new Date(lastMsg.created_at || new Date()).getTime();
            const timeSinceLastMsg = Date.now() - lastMsgTime;
            
            // Если это не симуляция и последнее сообщение было менее 2 минут назад - даем клиенту договорить
            if (!isSimulation && timeSinceLastMsg < 2 * 60 * 1000) {
                continue;
            }

            const chatLog = messages.map((m: any) => `${m.role === 'user' ? 'Клиент' : 'ИИ'}: ${m.content}`).join('\n');

            const extractionResponse = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { 
                        role: 'system', 
                        content: `Ты — Семён, профессиональный бизнес-аналитик завода ЗМК. Твоя задача — проанализировать диалог и составить КРАТКОЕ, но ЕМКОЕ саммри для менеджера по продажам.
                        
                        В поле query_summary напиши:
                        1. Что именно ищет клиент (модели, размеры).
                        2. Ключевые требования (материал, сроки).
                        3. Куда нужна доставка (город).
                        4. Были ли прикреплены файлы (ТЗ).
                        
                        В поле gifts укажи подарки, которые зафиксировала Елена:
                        - Если есть email: "free_installation" (бесплатный монтаж + КП на бланке)
                        - Если есть телефон: "alice_speaker" (Яндекс Станция Алиса Мини)
                        - Если оба контакта: массив ["free_installation", "alice_speaker"]
                        
                        Верни строго JSON:
                        {
                            "name": "Имя клиента",
                            "phone": "Телефон (только цифры)",
                            "email": "Email",
                            "telegram": "Ник в Telegram",
                            "query_summary": "Структурированная выжимка потребностей клиента",
                            "gifts": ["free_installation"] или ["alice_speaker"] или ["free_installation", "alice_speaker"] или [],
                            "corporate_details": {
                                "is_corporate": true/false, // true, если в диалоге есть упоминание названия компании, ИНН или реквизитов
                                "company_name": "Название компании (например: ООО «Нейровет»)", // null, если нет
                                "inn": "ИНН компании (только цифры)", // null, если нет
                                "kpp": "КПП компании (только цифры)", // null, если нет
                                "address": "Адрес компании/доставки", // null, если нет
                                "contact_name": "Имя контактного лица", // null, если нет
                                "contact_phone": "Телефон контактного лица (только цифры)", // null, если нет
                                "bank": "Название банка для реквизитов", // null, если нет
                                "bik": "БИК банка (только цифры)", // null, если нет
                                "bank_account": "Расчетный счет (только цифры)", // null, если нет
                                "corr_account": "Корреспондентский счет (только цифры)" // null, если нет
                            },
                            "qualification": {
                                "delivery_timing": "Когда нужно чтобы стояло оборудование (желаемая дата/месяц/срок, например 'до сентября' или 'в течение 2 месяцев')", // null, если нет
                                "budget": "Бюджет в рублях (число или null, если не назван)", // null, если нет
                                "decision_drivers": "Что принципиально важно для принятия решения (цена, сроки, качество, характеристики и т.д.)", // null, если нет
                                "inn": "ИНН компании, если указан (9-12 цифр, или null)", // null, если нет
                                "has_tz": true/false/null, // true, если клиент прикрепил ТЗ или сказал, что ТЗ есть; false, если ТЗ точно нет; null, если вопрос не обсуждался
                                "competitors": "С кем будут сравнивать наше предложение (названия конкурентов, или null)", // null, если нет
                                "purchase_form_raw": "Прямая закупка | Тендер на гос площадке | Внутренний тендер | Смета | другое" // null, если нет
                            }
                        }`
                    },
                    { role: 'user', content: `Лог диалога:\n${chatLog}` }
                ],
                response_format: { type: 'json_object' }
            });
            await recordAiUsage({ agentId: AiAgent.ELENA, model: extractionResponse.model, usage: extractionResponse.usage, purpose: 'lead_extraction' });

            const extractedData = JSON.parse(extractionResponse.choices[0].message.content || '{}');

            let existingOrderId: number | null = null;
            if (session.utm_campaign) {
                const m = session.utm_campaign.match(/\d+/);
                if (m) {
                    existingOrderId = parseInt(m[0]);
                }
            }

            if (extractedData.phone || extractedData.email || extractedData.telegram || existingOrderId) {
                try {
                    const contacts = { email: extractedData.email || undefined, phone: extractedData.phone || undefined };
                    const assignment = await resolveAssignment(contacts, assignmentCtx);
                    const managerId = assignment.managerId;

                    // Добираем АКТУАЛЬНУЮ цену найденных товаров прямо с сайта (Webasyst getInfo по ID).
                    // Живой фетч здесь, в кроне: клиент цену не видит, запрос идёт только для реального лида.
                    const enrichedCatalog = await enrichWithLivePrice(
                        Array.isArray(session.matched_catalog_products) ? session.matched_catalog_products : []
                    );

                    const corpDetails = extractedData.corporate_details ? {
                        isCorporate: Boolean(extractedData.corporate_details.is_corporate),
                        companyName: extractedData.corporate_details.company_name || null,
                        inn: extractedData.corporate_details.inn || null,
                        kpp: extractedData.corporate_details.kpp || null,
                        address: extractedData.corporate_details.address || null,
                        contactName: extractedData.corporate_details.contact_name || null,
                        contactPhone: extractedData.corporate_details.contact_phone || null,
                        bank: extractedData.corporate_details.bank || null,
                        bik: extractedData.corporate_details.bik || null,
                        bankAccount: extractedData.corporate_details.bank_account || null,
                        corrAccount: extractedData.corporate_details.corr_account || null,
                    } : null;

                    let orderNumber: string;
                    if (existingOrderId) {
                        const giftsInfo = extractedData.gifts && extractedData.gifts.length > 0
                            ? extractedData.gifts.map((g: string) => {
                                if (g === 'free_installation') return '🎁 Бесплатный монтаж + КП на фирменном бланке';
                                if (g === 'alice_speaker') return '🎁 Яндекс Станция Алиса Мини';
                                return g;
                            }).join('\n')
                            : 'нет';

                        const qualification = extractedData.qualification || {};
                        const managerComment = `🔥 ИНФОРМАЦИЯ ИЗ ИИ-ЧАТА (КВАЛИФИКАЦИЯ)

📍 ГЕО: ${session.geo_city || 'не определен'}
📱 КОНТАКТЫ: ${extractedData.telegram ? `Telegram: ${extractedData.telegram}` : ''} ${extractedData.phone || ''} ${extractedData.email || ''}

🎁 ПОДАРКИ (зафиксировала Елена):
${giftsInfo}

📝 СУТЬ ЗАПРОСА (Анализ от Семёна):
${extractedData.query_summary}

-------------------------------------------
❓ ОТВЕТЫ НА ВОПРОСЫ КВАЛИФИКАЦИИ:
1. Срок установки: ${qualification.delivery_timing || 'не указан'}
2. Бюджет: ${qualification.budget ? `${qualification.budget} руб.` : 'не указан'}
3. Критично при выборе: ${qualification.decision_drivers || 'не указано'}
4. ИНН: ${qualification.inn || extractedData.corporate_details?.inn || 'не указан'}
5. Наличие ТЗ: ${qualification.has_tz === true ? 'Да (запрошено/прикреплено)' : qualification.has_tz === false ? 'Нет (требуется составить)' : 'не обсуждалось'}
6. С кем сравнивают (конкуренты): ${qualification.competitors || 'не указаны'}
7. Форма закупки: ${qualification.purchase_form_raw || 'не указана'}

-------------------------------------------
🔎 ДЕТАЛИ:
- Товары: ${session.interested_products?.join(', ') || 'не указаны'}
${formatMatchedCatalogProducts(enrichedCatalog)}
📜 КРАТКИЙ ЛОГ ДИАЛОГА:
${chatLog.split('\n').slice(-10).join('\n')}`;

                        const customFields: Record<string, any> = {
                            kogda_vam_nuzhno_chtoby_oborudovanie_uzhe_stoyalo: qualification.delivery_timing || null,
                            typ_customer_margin: mapPurchaseForm(qualification.purchase_form_raw)
                        };
                        if (qualification.budget) {
                            customFields.expected_amount = Number(qualification.budget) || null;
                            customFields.ozhidaemaya_summa = Number(qualification.budget) || null;
                        }

                        let nameToUpdate = extractedData.name || null;
                        if (nameToUpdate === 'Клиент из чата' || nameToUpdate === session.nickname) {
                            nameToUpdate = null;
                        }

                        await updateExistingOrderInCrm(existingOrderId, {
                            status: 'zapros-kontaktov',
                            noteText: managerComment,
                            customFields,
                            firstName: nameToUpdate || undefined
                        });
                        orderNumber = String(existingOrderId);
                    } else {
                        // Если у сессии есть заявка на обратный звонок — заказ в CRM
                        // должен идти каналом «Заказ обратного звонка с сайта» (missed-call),
                        // а не общим live-chat.
                        const { data: callbackReq } = await supabase
                            .from('widget_callback_requests')
                            .select('id')
                            .eq('session_id', session.id)
                            .limit(1)
                            .maybeSingle();
                        const orderMethod = callbackReq ? 'missed-call' : 'live-chat';

                        const crmResult = await createLeadInCrm({
                            name: extractedData.name || session.nickname || 'Клиент из чата',
                            phone: extractedData.phone,
                            email: extractedData.email,
                            telegram: extractedData.telegram,
                            query_summary: extractedData.query_summary,
                            gifts: Array.isArray(extractedData.gifts) ? extractedData.gifts : [],
                            domain: 'zmktlt.ru',
                            city: session.geo_city,
                            history: messages,
                            visitedPages: [],
                            managerId: managerId,
                            corporateDetails: corpDetails,
                            matchedCatalogProducts: enrichedCatalog,
                            orderMethod
                        });
                        orderNumber = crmResult.order?.number || crmResult.id?.toString();
                    }
                    // Compatibility: different environments may have either crm_order_id or crm_order_number,
                    // and some may not yet have contact_* columns.
                    const primaryPayload: any = {
                        is_lead_created: true,
                        crm_order_id: parseInt(orderNumber) || null,
                        contact_phone: extractedData.phone,
                        contact_email: extractedData.email,
                        contact_name: extractedData.name || session.nickname || null,
                        assigned_manager_id: managerId
                    };

                    let { error: updateError } = await supabase
                        .from('widget_sessions')
                        .update(primaryPayload)
                        .eq('id', session.id);

                    if (updateError) {
                        const fallbackPayload: any = {
                            is_lead_created: true,
                            crm_order_number: orderNumber,
                            assigned_manager_id: managerId
                        };
                        const fallbackResult = await supabase
                            .from('widget_sessions')
                            .update(fallbackPayload)
                            .eq('id', session.id);
                        updateError = fallbackResult.error;
                    }

                    if (updateError) throw updateError;

                    await supabase.from('widget_messages').insert([
                        {
                            session_id: session.id,
                            role: 'system',
                            content: `✅ Заказ #${orderNumber} успешно создан в CRM (Семён-Архивариус)`
                        },
                        {
                            session_id: session.id,
                            role: 'system',
                            content: `👤 Распределено ИИ: ${assignmentCtx.managerNames[managerId!] || managerId} (${assignment.reason})`
                        },
                        {
                            session_id: session.id,
                            role: 'system',
                            content: `🗣️ Передаю сделку Артему для голосовой квалификации...`
                        }
                    ]);

                    // Инициируем звонок через очередь задач
                    if (extractedData.phone) {
                        await safeEnqueueSystemJob({
                            jobType: 'telphin_callback',
                            payload: {
                                visitorId: session.visitor_id,
                                phone: extractedData.phone,
                                sessionId: session.id,
                                crm_order_id: parseInt(orderNumber) || null
                            },
                            priority: 15,
                            idempotencyKey: `telphin_callback:${extractedData.phone}:${session.id}`
                        });
                    }

                    results.push({ sessionId: session.id, status: 'success', data: extractedData });
                } catch (crmError: any) {
                    console.error(`CRM Error for session ${session.id}:`, crmError);
                    results.push({ sessionId: session.id, status: 'crm_error', error: crmError.message });
                }
            } else {
                // GPT не смог извлечь контакты из диалога — НЕ помечаем как обработанную,
                // чтобы при следующем запуске попробовать снова (пользователь может написать позже)
                results.push({ sessionId: session.id, status: 'no_contacts_found' });
            }
        }

        return NextResponse.json({ results });

    } catch (error: any) {
        console.error('Lead Catcher Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
