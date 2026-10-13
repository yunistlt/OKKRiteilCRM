/**
 * КП и счёт — в файлы заказа, одной дверью.
 *
 * Ирина Гордеева 12.10.2026: «только что выставила счёт, но опять нет в файлах,
 * не сохранился». Так и было: файл ложился в заказ только когда уходил письмом,
 * а кнопка «Счёт на оплату» просто отдавала PDF на экран.
 *
 * Теперь любой показанный документ сразу остаётся в заказе. Перезаписываем по
 * дате: один счёт в день, иначе список файлов засоряется.
 */
import { supabase } from '@/utils/supabase';
import { safeStorageSegment } from '@/lib/storage-path';

export type OrderDocumentKind = 'proposal' | 'invoice';

const NOTES: Record<OrderDocumentKind, string> = {
    invoice: 'Счёт по заказу',
    proposal: 'Коммерческое предложение',
};

export async function keepOrderDocument(
    orderNumber: string,
    kind: OrderDocumentKind,
    pdf: { filename: string; content: Buffer; contentType: string },
    author: string | null,
    note?: string,
): Promise<void> {
    try {
        const day = new Date().toISOString().slice(0, 10);
        const path = `order-files/${safeStorageSegment(orderNumber, 40)}/sent/${kind}-${day}.pdf`;

        const upload = await supabase.storage.from('okk-assets').upload(path, new Uint8Array(pdf.content), {
            contentType: pdf.contentType,
            upsert: true,
        });
        if (upload.error) {
            console.error('[order-document] документ не лёг в файлы заказа:', upload.error.message);
            return;
        }

        const { data: existing } = await supabase
            .from('order_files')
            .select('id')
            .eq('order_number', orderNumber)
            .eq('storage_path', path)
            .is('deleted_at', null)
            .maybeSingle();

        if (existing) {
            // Файл перезаписан — обновим имя и размер, чтобы список не врал.
            await supabase
                .from('order_files')
                .update({ file_name: pdf.filename, size_bytes: pdf.content.length, archived_at: null })
                .eq('id', (existing as any).id);
            return;
        }

        await supabase.from('order_files').insert({
            order_number: orderNumber,
            file_name: pdf.filename,
            content_type: pdf.contentType,
            size_bytes: pdf.content.length,
            storage_bucket: 'okk-assets',
            storage_path: path,
            note: note ?? NOTES[kind],
            uploaded_by: author,
        });
    } catch (e: any) {
        // Показ документа важнее: провал сохранения его не отменяет.
        console.error('[order-document] документ не сохранился:', e?.message || e);
    }
}
