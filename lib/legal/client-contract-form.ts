/**
 * Форма договора, которую прислал клиент, — юристу на проверку.
 *
 * Просьба Ирины Гордеевой 16.10.2026: «договор на согласование юристу отправлять
 * не через почту, а тут». До этого юристу уходил только наш договор, собранный
 * по нашему шаблону (`order-contract.ts`), а форму клиента менеджер пересылал
 * письмом — в реестре юротдела её не было вовсе.
 *
 * Своей копии файла не делаем: он уже лежит в файлах заказа (`order_files` +
 * бакет `okk-assets`), сюда пишем только путь к нему. Документ попадает в тот
 * же реестр `order_contracts`, что и наши договоры, видом `klient`: у юриста
 * один рабочий список, а не два.
 */
import { supabase } from '@/utils/supabase';
import { extractTextFromContract } from '@/lib/legal-contract-analysis';
import { reviewContract, type ContractReview } from '@/lib/legal/contract-review';

/** Вид документа в `order_contracts` для формы, присланной клиентом. */
export const CLIENT_FORM_KIND = 'klient';

export async function submitClientContractForm(params: {
    orderId: number | null;
    orderNumber: string;
    /** Файл заказа (`order_files.id`) — форма договора от клиента. */
    fileId: number;
    /** Что менеджер просит проверить, своими словами. Не обязательно. */
    question?: string | null;
    author: string;
}): Promise<{ ok: true; id: number; review: ContractReview; textFound: boolean } | { ok: false; reason: string }> {
    const { data: fileRow } = await supabase
        .from('order_files')
        .select('id, order_number, file_name, content_type, storage_bucket, storage_path')
        .eq('id', params.fileId)
        .is('deleted_at', null)
        .maybeSingle();

    const file = fileRow as any;
    if (!file) {
        return { ok: false, reason: 'Файл не найден в заказе — приложите его ещё раз.' };
    }
    if (String(file.order_number) !== String(params.orderNumber)) {
        return { ok: false, reason: 'Этот файл приложен к другому заказу.' };
    }

    /**
     * Второй раз тот же файл юристу не отправляем: это повторное нажатие.
     * Сверяем путь файла в коде, а не фильтром `or(...)`: в пути есть точки и
     * дефисы, и такой фильтр ломается на именах файлов, а не на данных.
     */
    const { data: sent } = await supabase
        .from('order_contracts')
        .select('id, pdf_path, docx_path')
        .eq('order_number', params.orderNumber)
        .eq('kind', CLIENT_FORM_KIND)
        .is('deleted_at', null);

    const already = ((sent as any[]) ?? []).some(
        (row) => row.pdf_path === file.storage_path || row.docx_path === file.storage_path,
    );

    if (already) {
        return { ok: false, reason: 'Этот файл уже отправлен юристу — он в разделе «Документы на согласовании».' };
    }

    /**
     * Текст из файла. Не вытащился (скан без текстового слоя) — это не причина
     * не отправлять: юрист откроет сам файл, а в карточке увидит, почему текста
     * нет. Молча отдать юристу пустой договор было бы хуже.
     */
    let text = '';
    let extractProblem: string | null = null;
    try {
        const extracted = await extractTextFromContract({
            bucket: String(file.storage_bucket || 'okk-assets'),
            storagePath: String(file.storage_path),
            contentType: file.content_type ?? null,
            fileName: file.file_name ?? null,
        });
        text = String(extracted.text || '').trim();
        if (!text) {
            extractProblem = extracted.warnings[0] || 'В файле нет текстового слоя.';
        }
    } catch (e: any) {
        extractProblem = String(e?.message || e);
    }

    /**
     * Замечания ИИ-юрисконсульта — к каждому договору (требование владельца
     * 07.10.2026), форма клиента не исключение. Это подсказка, а не запрет:
     * решение всё равно принимает живой юрист.
     */
    const review: ContractReview = text
        ? await reviewContract(text, { byClient: true })
        : {
            summary: 'Текст из файла не читается — смотрит живой юрист.',
            notes: extractProblem ? [extractProblem] : [],
            level: 'attention',
            byAi: false,
        };

    const title = `Договор клиента по заказу № ${params.orderNumber} — ${file.file_name}`;
    const isPdf = String(file.content_type || '').includes('pdf')
        || String(file.file_name || '').toLowerCase().endsWith('.pdf');

    const { data, error } = await supabase
        .from('order_contracts')
        .insert({
            order_number: params.orderNumber,
            order_id: params.orderId,
            kind: CLIENT_FORM_KIND,
            title,
            // Здесь — вопрос менеджера юристу: своих «условий словами» у формы
            // клиента нет, а спросить человеку надо.
            terms_text: params.question?.trim() || null,
            body_text: text || null,
            status: 'on_review',
            submitted_at: new Date().toISOString(),
            created_by: params.author,
            // Файл один — тот, что приложен к заказу. Второй копии нет.
            ...(isPdf ? { pdf_path: file.storage_path } : { docx_path: file.storage_path }),
            ai_review: review,
            ai_review_at: new Date().toISOString(),
        })
        .select('id')
        .single();

    if (error || !data) {
        console.error('[client-contract-form] форма клиента не сохранилась:', error);
        return { ok: false, reason: 'Не получилось отправить юристу — попробуйте ещё раз.' };
    }

    await supabase.from('order_contract_versions').insert({
        contract_id: data.id,
        version_number: 1,
        body_text: text || null,
        change_note: 'Форму договора прислал клиент, менеджер отправил юристу',
        author: params.author,
    });

    return { ok: true, id: data.id, review, textFound: Boolean(text) };
}
