import { PDFDocument } from 'pdf-lib';
import { supabase } from '@/utils/supabase';
import { orderDocumentData, type OrderDocumentData } from '@/lib/own-crm/documents';
import { buildOrderDocumentPdf } from '@/lib/own-crm/order-document-pdf';
import { KP_ABOUT_PAGE_PDF_BASE64 } from '@/lib/own-crm/kp-about-page';
import { buildContractPdf } from '@/lib/legal/contract-pdf';
import { buildSpecificationPdf, type SpecificationData } from '@/lib/legal/specification-pdf';
import { safeStorageSegment } from '@/lib/storage-path';

/**
 * Комплект документов по заказу: счёт + договор + спецификация одним файлом.
 *
 * Так его выдавала RetailCRM (эталон — заказ 54729): сначала счёт с подписью и
 * печатью, затем договор купли-продажи, затем спецификация к нему. Клиенту
 * уходит один PDF, а не три вложения, и в нём согласовано всё: цена, состав,
 * сроки и условия.
 *
 * Спецификация обязательна не для красоты: по договору (п. 1.2 и 2.1) именно
 * в ней согласуются оборудование и цена.
 */
const BUCKET = 'okk-assets';

/** Склеить несколько PDF в один, по порядку. */
async function mergePdfs(parts: Buffer[]): Promise<Buffer> {
    const merged = await PDFDocument.create();
    for (const part of parts) {
        const doc = await PDFDocument.load(part);
        const pages = await merged.copyPages(doc, doc.getPageIndices());
        for (const page of pages) merged.addPage(page);
    }
    return Buffer.from(await merged.save());
}

/** Данные спецификации из того же источника, что счёт и договор. */
export function specificationFrom(data: OrderDocumentData, date: Date = new Date()): SpecificationData {
    const items = data.items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        sum: item.price * item.quantity,
    }));

    const itemsTotal = items.reduce((sum, item) => sum + item.sum, 0);
    const discount = data.discountAmount
        || (data.discountPercent ? Math.round(itemsTotal * data.discountPercent) / 100 : 0)
        || data.items.reduce((sum, item) => sum + (item.discount || 0) * item.quantity, 0);

    const total = data.total || Math.max(itemsTotal - discount, 0);
    // НДС внутри суммы: ставка приходит из позиций заказа, а не выдумывается.
    const vatAmount = data.vatPercent
        ? Math.round((total * data.vatPercent / (100 + data.vatPercent)) * 100) / 100
        : null;

    return {
        orderNumber: data.orderNumber,
        date: date.toLocaleDateString('ru-RU'),
        items,
        discount,
        vatAmount,
        vatPercent: data.vatPercent || null,
        total,
        delivery: data.shippingTerms,
        deliveryNote: data.shippingNote,
        priceValidDays: data.validDays,
        seller: {
            name: data.seller?.name ?? data.sellerFullName ?? '—',
            inn: data.seller?.inn ?? null,
            kpp: data.seller?.kpp ?? null,
            bank: data.seller?.bank ?? null,
            bik: data.seller?.bik ?? null,
            rs: data.seller?.rs ?? null,
            ks: data.seller?.ks ?? null,
            address: data.seller?.address ?? null,
            signerName: data.signerName,
            signerTitle: data.signerTitle,
            signatureImage: data.signatureImage,
            // ИП работает без печати — у него её и не рисуем.
            sealImage: data.sellerHasSeal ? data.sealImage : null,
        },
        buyer: {
            name: data.payerCompany || data.payerName,
            inn: data.payerInn,
            kpp: data.payerKpp,
            bank: null,
            bik: null,
            rs: null,
            ks: null,
            address: data.payerAddress,
            signerTitle: data.payerSignerTitle,
        },
    };
}

export type ContractKit =
    | { ok: true; path: string; fileName: string; pages: number }
    | { ok: false; reason: string };

/**
 * Собрать комплект и положить в файлы заказа.
 *
 * Договор берём уже составленный (его текст согласован и проверен
 * ИИ-юрисконсультом) — сочинять второй здесь нельзя.
 */
export async function buildContractKit(params: {
    orderId: number;
    orderNumber: string;
    contractId: string | number;
    contractTitle: string;
    contractText: string;
    author?: string | null;
}): Promise<ContractKit> {
    try {
        const data = await orderDocumentData(params.orderId);
        if (!data) return { ok: false, reason: 'Заказ не найден' };
        if (!data.items.length) return { ok: false, reason: 'В заказе нет позиций — спецификацию составить не из чего' };
        if (!data.seller) return { ok: false, reason: 'Не знаем реквизиты продавца: выберите юрлицо в заказе' };

        const invoice = await buildOrderDocumentPdf(data, 'invoice');
        const contract = await buildContractPdf({
            title: params.contractTitle,
            bodyText: params.contractText,
            signing: {
                signerName: data.signerName,
                signerTitle: data.signerTitle,
                signatureImage: data.signatureImage,
                sealImage: data.sellerHasSeal ? data.sealImage : null,
                buyerName: data.payerSignerName || data.payerName || null,
            },
        });
        const specification = await buildSpecificationPdf(specificationFrom(data));

        /**
         * Страница о компании идёт сразу за счётом — так её ставила RetailCRM
         * (эталон, лист 2). Не нашлась — комплект всё равно собираем.
         */
        const about = KP_ABOUT_PAGE_PDF_BASE64 ? [Buffer.from(KP_ABOUT_PAGE_PDF_BASE64, 'base64')] : [];

        const merged = await mergePdfs([Buffer.from(invoice.content), ...about, contract, specification]);
        const pages = (await PDFDocument.load(merged)).getPageCount();

        const fileName = `Счёт, договор и спецификация №${params.orderNumber}.pdf`;
        const path = `order-files/${safeStorageSegment(params.orderNumber, 40)}/contracts/kit-${params.contractId}.pdf`;

        const upload = await supabase.storage.from(BUCKET).upload(path, new Uint8Array(merged), {
            contentType: 'application/pdf',
            upsert: true,
        });
        if (upload.error) return { ok: false, reason: upload.error.message };

        // Одна запись на комплект: перезобрали — заменили файл, а не завели второй.
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
                size_bytes: merged.length,
                storage_bucket: BUCKET,
                storage_path: path,
                note: 'Счёт, договор и спецификация',
                uploaded_by: params.author ?? null,
            });
        }

        return { ok: true, path, fileName, pages };
    } catch (e: any) {
        console.error('[contract-kit] комплект не собрался:', e?.message || e);
        return { ok: false, reason: String(e?.message || e) };
    }
}
