import { supabase } from '@/utils/supabase';
import { safeStorageSegment } from '@/lib/storage-path';
import { buildContractPdf } from '@/lib/legal/contract-pdf';
import { orderDocumentData } from '@/lib/own-crm/documents';

/**
 * Договор должен лежать файлом — в карточке заказа и в реестре юротдела.
 *
 * Требование владельца 08.10.2026. До этого договор существовал только текстом
 * в базе: менеджер нажимал «Составить договор», видел замечания
 * ИИ-юрисконсульта и не понимал, где взять сам документ.
 *
 * Кладём в тот же бакет и ту же таблицу, что и файлы, приложенные руками
 * (`order_files` + `okk-assets`), — тогда договор виден во вкладке «Файлы»
 * заказа без отдельного механизма. Путь к файлу пишем и в сам договор
 * (`order_contracts.pdf_path`), чтобы реестр юротдела отдавал ссылку.
 */
const BUCKET = 'okk-assets';

export type ContractFile = { ok: true; path: string; fileName: string } | { ok: false; reason: string };

export async function saveContractFile(params: {
    contractId: string;
    orderNumber: string;
    title: string;
    bodyText: string;
    version?: number | null;
    author?: string | null;
    /** Номер заказа в нашей базе — по нему берём подпись и печать юрлица. */
    orderId?: number | null;
}): Promise<ContractFile> {
    try {
        // Подпись и печать — те же, что на счёте: из карточки нашего юрлица.
        // Не собрались (нет юрлица, нет картинок) — договор всё равно нужен,
        // останутся линии для подписи от руки.
        const doc = params.orderId
            ? await orderDocumentData(Number(params.orderId)).catch(() => null)
            : null;

        const pdf = await buildContractPdf({
            title: params.title,
            bodyText: params.bodyText,
            signing: doc
                ? {
                    signerName: doc.signerName,
                    signerTitle: doc.signerTitle,
                    signatureImage: doc.signatureImage,
                    sealImage: doc.sellerHasSeal ? doc.sealImage : null,
                    buyerName: doc.payerSignerName || doc.payerName || null,
                }
                : null,
        });

        const version = params.version && params.version > 1 ? `-v${params.version}` : '';
        const fileName = `Договор №${params.orderNumber}${version}.pdf`;
        // И номер, и имя — латиницей: у своих заказов номер с кириллической «А».
        const path = `order-files/${safeStorageSegment(params.orderNumber, 40)}/contracts/${params.contractId}${version}.pdf`;

        const upload = await supabase.storage.from(BUCKET).upload(path, new Uint8Array(pdf), {
            contentType: 'application/pdf',
            upsert: true,
        });
        if (upload.error) return { ok: false, reason: upload.error.message };

        // Перезаписанный договор не плодит строк в файлах заказа: одна версия —
        // одна запись, иначе менеджер не поймёт, какой из пяти файлов свежий.
        const { data: existing } = await supabase
            .from('order_files')
            .select('id')
            .eq('order_number', params.orderNumber)
            .eq('storage_path', path)
            .is('deleted_at', null)
            .maybeSingle();

        if (!existing) {
            await supabase.from('order_files').insert({
                order_number: params.orderNumber,
                file_name: fileName,
                content_type: 'application/pdf',
                size_bytes: pdf.length,
                storage_bucket: BUCKET,
                storage_path: path,
                note: 'Договор по заказу',
                uploaded_by: params.author ?? null,
            });
        }

        await supabase.from('order_contracts').update({ pdf_path: path }).eq('id', params.contractId);

        return { ok: true, path, fileName };
    } catch (e: any) {
        // Договор уже сохранён текстом — провал файла не должен отменять его.
        console.error('[contract-file] файл договора не собрался:', e?.message || e);
        return { ok: false, reason: String(e?.message || e) };
    }
}
