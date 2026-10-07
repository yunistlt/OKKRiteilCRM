/**
 * Договор по заказу: менеджер пишет условия словами, система собирает договор
 * по нашему шаблону и кладёт его юристу на согласование.
 *
 * Шаблон трогать нельзя (`contract-template.ts`) — это согласованная редакция.
 * ИИ отвечает только за один раздел: превращает «70 предоплата, 30 перед
 * отгрузкой» в формулировку пункта 2.4. Если ИИ недоступен, подставляем нашу
 * штатную схему 70/30 и помечаем это юристу.
 */
import { supabase } from '@/utils/supabase';
import { getOpenAIClient, isOpenAIConfigured } from '@/utils/openai';
import { orderDocumentData } from '@/lib/own-crm/documents';
import { buildContractText, DEFAULT_PAYMENT_TERMS, type ContractFill } from './contract-template';

export const CONTRACT_STATUS_LABELS: Record<string, string> = {
    draft: 'Черновик',
    on_review: 'На согласовании',
    approved: 'Согласован',
    rework: 'На доработку',
};

export type ContractRow = {
    id: number;
    order_number: string;
    title: string;
    status: string;
    version: number;
    terms_text: string | null;
    body_text: string | null;
    created_by: string | null;
    reviewed_by: string | null;
    review_comment: string | null;
    created_at: string;
    updated_at: string;
};

/**
 * Пункт 2.4 из слов менеджера. Правовую рамку задаём сами, ИИ только
 * формулирует — иначе каждый договор получится своим, и юристу придётся
 * вычитывать всё заново.
 */
export async function renderPaymentTerms(
    termsText: string,
    /**
     * Текст уже готов и согласован — переписывать его нечем и незачем.
     * Так приходят стандартные условия, выбранные из списка (решение владельца
     * 07.10.2026): это редакция, по которой отдел продаж работал в RetailCRM.
     */
    asIs = false,
): Promise<{ text: string; byAi: boolean }> {
    const raw = (termsText || '').trim();
    if (!raw) return { text: DEFAULT_PAYMENT_TERMS, byAi: false };
    if (asIs) return { text: raw, byAi: false };
    if (!isOpenAIConfigured()) return { text: raw, byAi: false };

    try {
        const client = getOpenAIClient();
        const completion = await client!.chat.completions.create({
            model: 'gpt-4o-mini',
            temperature: 0,
            messages: [
                {
                    role: 'system',
                    content:
                        'Ты юрист завода металлоконструкций. Превращаешь короткую запись менеджера об условиях оплаты ' +
                        'в пункт договора купли-продажи на русском языке. Пиши строго по записи: не добавляй условий, ' +
                        'которых в ней нет, не меняй проценты и сроки. Формат — одна или несколько строк вида ' +
                        '«70% предоплаты в течение 5 (пяти) банковских дней с момента выставления счёта на оплату ' +
                        'путём перечисления денежных средств на расчётный счёт Продавца.». Если срок в записи не указан, ' +
                        'срок не выдумывай и не пиши о нём. В ответе только текст пункта, без заголовков и пояснений.',
                },
                { role: 'user', content: raw },
            ],
        });
        const text = completion.choices[0]?.message?.content?.trim();
        if (text) return { text, byAi: true };
    } catch (e: any) {
        console.error('[order-contract] ИИ не собрал условия оплаты:', e?.message || e);
    }
    return { text: raw, byAi: false };
}

/** Собирает текст договора по заказу. Возвращает null, если данных заказа не хватает. */
export async function buildOrderContract(params: {
    orderId: number;
    orderNumber: string;
    termsText: string;
    sellerCode?: string | null;
    /** Текст условий готов и согласован — вставляем как есть, без ИИ. */
    termsAsIs?: boolean;
}): Promise<{ text: string; byAi: boolean; sellerName: string } | null> {
    const data = await orderDocumentData(params.orderId, params.sellerCode ?? null);
    if (!data?.seller) return null;

    const payment = await renderPaymentTerms(params.termsText, params.termsAsIs === true);
    const now = new Date();
    const fill: ContractFill = {
        number: params.orderNumber,
        date: now.toLocaleDateString('ru-RU'),
        city: 'Тольятти',
        seller: {
            shortName: data.seller.name,
            signerTitle: data.signerTitle || 'Директор',
            signerName: data.signerName || '',
            inn: data.seller.inn,
            kpp: data.seller.kpp,
            bank: data.seller.bank,
            bik: data.seller.bik,
            account: data.seller.rs,
            corrAccount: data.seller.ks,
            address: data.seller.address,
        },
        buyer: {
            // Полное наименование в договоре правильнее сокращённого.
            name: data.payerFullName || data.payerCompany || data.payerName || 'Покупатель',
            // Кто подписывает со стороны клиента — из его карточки.
            signerName: data.payerSignerName,
            signerTitle: data.payerSignerTitle,
            signerBasis: data.payerSignerBasis,
            inn: data.payerInn,
            kpp: data.payerKpp,
            address: data.payerAddress,
        },
        paymentTerms: payment.text,
        // Срок берём из заказа; если менеджер его не заполнил — наш обычный срок.
        productionDays: data.productionDays ?? 45,
        productionTerm: data.productionTerm,
    };

    return { text: buildContractText(fill), byAi: payment.byAi, sellerName: data.seller.name };
}

/**
 * Заводит договор по заказу.
 *
 * `toLawyer` решает, идёт ли он юристу. Стандартные условия (выбранные из
 * списка) юристу не нужны — это согласованная редакция, и ждать 1–2 дня из-за
 * неё нельзя (требование владельца 07.10.2026 по жалобе Евгении Матвеевой).
 * Свои формулировки по-прежнему уходят на согласование.
 */
export async function createOrderContract(params: {
    orderId: number;
    orderNumber: string;
    termsText: string;
    sellerCode?: string | null;
    author: string;
    /** Отправить юристу. По умолчанию да — так было раньше. */
    toLawyer?: boolean;
    /** Текст условий готов и согласован — вставляем как есть, без ИИ. */
    termsAsIs?: boolean;
}): Promise<{ ok: true; id: number; byAi: boolean } | { ok: false; reason: string }> {
    const built = await buildOrderContract(params);
    if (!built) {
        return {
            ok: false,
            reason: 'Не выбрано наше юрлицо — выберите его в списке «Юрлицо заказа» рядом с кнопками документов.',
        };
    }

    const title = `Договор купли-продажи № ${params.orderNumber} — ${built.sellerName}`;
    const { data, error } = await supabase
        .from('order_contracts')
        .insert({
            order_number: params.orderNumber,
            order_id: params.orderId,
            title,
            terms_text: params.termsText,
            body_text: built.text,
            // Стандартный договор готов к отправке клиенту сразу; свои условия
            // ждут юриста.
            status: params.toLawyer === false ? 'approved' : 'on_review',
            submitted_at: params.toLawyer === false ? null : new Date().toISOString(),
            reviewed_at: params.toLawyer === false ? new Date().toISOString() : null,
            review_comment: params.toLawyer === false
                ? 'Стандартные условия из списка — согласование юриста не требуется.'
                : null,
            created_by: params.author,
        })
        .select('id')
        .single();

    if (error || !data) {
        console.error('[order-contract] договор не сохранился:', error);
        return { ok: false, reason: 'Договор не сохранился — попробуйте ещё раз.' };
    }

    await supabase.from('order_contract_versions').insert({
        contract_id: data.id,
        version_number: 1,
        body_text: built.text,
        change_note: 'Составлен менеджером',
        author: params.author,
    });

    return { ok: true, id: data.id, byAi: built.byAi };
}

/** Решение юриста по договору: согласовать или вернуть на доработку. */
export async function decideOrderContract(params: {
    contractId: number;
    decision: 'approved' | 'rework';
    comment?: string | null;
    reviewer: string;
}): Promise<{ ok: boolean; reason?: string }> {
    const { error } = await supabase
        .from('order_contracts')
        .update({
            status: params.decision,
            reviewed_by: params.reviewer,
            reviewed_at: new Date().toISOString(),
            review_comment: params.comment ?? null,
            updated_at: new Date().toISOString(),
        })
        .eq('id', params.contractId);

    if (error) {
        console.error('[order-contract] решение не записалось:', error);
        return { ok: false, reason: 'Решение не записалось — попробуйте ещё раз.' };
    }
    return { ok: true };
}

/** Правка текста юристом: сохраняем новую версию, старую не теряем. */
export async function reviseOrderContract(params: {
    contractId: number;
    bodyText: string;
    note: string;
    author: string;
}): Promise<{ ok: boolean; version?: number; reason?: string }> {
    const { data: current } = await supabase
        .from('order_contracts')
        .select('version')
        .eq('id', params.contractId)
        .maybeSingle();

    const nextVersion = Number(current?.version ?? 1) + 1;

    const { error } = await supabase
        .from('order_contracts')
        .update({ body_text: params.bodyText, version: nextVersion, updated_at: new Date().toISOString() })
        .eq('id', params.contractId);

    if (error) {
        console.error('[order-contract] правка не сохранилась:', error);
        return { ok: false, reason: 'Правка не сохранилась — попробуйте ещё раз.' };
    }

    await supabase.from('order_contract_versions').insert({
        contract_id: params.contractId,
        version_number: nextVersion,
        body_text: params.bodyText,
        change_note: params.note,
        author: params.author,
    });

    return { ok: true, version: nextVersion };
}
