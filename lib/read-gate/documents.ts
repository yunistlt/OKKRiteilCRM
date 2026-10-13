import { supabase } from '@/utils/supabase';

/**
 * Откуда шлюз берёт документ.
 *
 * Механизм общий, поэтому «что читать» вынесено в поставщиков: разбор дня,
 * изменённый регламент, приказ. Шлюзу всё равно, что внутри — ему нужны
 * заголовок, текст и ссылка, по которой документ однозначно узнаётся.
 */
export type GateDocument = {
    kind: string;
    /** Ссылка на документ: id разбора, slug статьи. Уникальна внутри вида. */
    ref: string;
    title: string;
    /** Дата, за которую документ: показывается человеку. */
    dateLabel?: string;
    /** Тело в Markdown — страница рисует его тем же рендером, что и справку. */
    body: string;
    /**
     * Своя страница документа, если тело не вытягивает вёрстку.
     *
     * Разбор дня — это карточки заказов в две колонки, цветные плашки и таблица
     * баллов; рендером справки такое не нарисовать. Поэтому поставщик может
     * отдать адрес своей страницы: шлюз уведёт человека туда, а учёт времени и
     * кнопку подтверждения страница подключает компонентом ReadGateBar.
     *
     * `body` остаётся обязательным и коротким: из него собирается анонс в
     * Telegram, и он же показывается, если страница не открылась.
     */
    url?: string | null;
};

export type DocumentProvider = {
    kind: string;
    title: string;
    /** Документ, который этот человек обязан прочитать сейчас. null — нечего читать. */
    pending: (userId: string, managerId: number | null) => Promise<GateDocument | null>;
};

/**
 * Разбор вчерашнего дня.
 *
 * Разбор формирует бот-РОП. Пока он не сохраняет разбор как документ (этим
 * занимается отдельное ТЗ, `docs/sales-rop/TZ_MORNING_CALL_REVIEW.md`), читать
 * нечего — и шлюз не срабатывает. Это не заглушка «на будущее», а прямое
 * требование: НЕТ ДОКУМЕНТА — НЕТ ШЛЮЗА. Разбор не сформировался, упал ночной
 * джоб, вчера не было звонков — работа открыта.
 */
const callReview: DocumentProvider = {
    kind: 'call_review',
    title: 'Разбор вчерашнего дня',
    async pending(_userId, managerId) {
        if (managerId == null) return null;

        const { data } = await supabase
            .from('sales_rop_day_review')
            .select('id, review_date, title, body, url')
            .eq('manager_id', managerId)
            .order('review_date', { ascending: false })
            .limit(1)
            .maybeSingle()
            // Таблицы ещё нет — значит, разборы не сохраняются и читать нечего.
            .then((r: any) => r, () => ({ data: null as any }));

        if (!data?.body) return null;
        return {
            kind: 'call_review',
            ref: String(data.id),
            title: data.title || 'Разбор вчерашнего дня',
            dateLabel: data.review_date ? new Date(data.review_date).toLocaleDateString('ru-RU') : undefined,
            body: String(data.body),
            url: (data as any).url ?? null,
        };
    },
};

export const DOCUMENT_PROVIDERS: DocumentProvider[] = [callReview];

/** Первый документ, который человек обязан прочитать. null — читать нечего. */
export async function pendingDocument(userId: string, managerId: number | null): Promise<GateDocument | null> {
    for (const provider of DOCUMENT_PROVIDERS) {
        const doc = await provider.pending(userId, managerId);
        if (doc) return doc;
    }
    return null;
}
