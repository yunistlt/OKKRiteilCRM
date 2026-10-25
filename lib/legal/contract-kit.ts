import { createHash } from 'crypto';
import { PDFDocument } from 'pdf-lib';
import { supabase } from '@/utils/supabase';
import { orderDocumentData, type OrderDocumentData } from '@/lib/own-crm/documents';
import { buildOrderDocumentPdf } from '@/lib/own-crm/order-document-pdf';
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

/**
 * Положить готовый PDF в файлы заказа.
 *
 * В пути — отпечаток содержимого: пересобрали после правки состава, получили
 * другой документ — он ложится рядом, а не затирает прежний (решение владельца
 * 14.10.2026: файлы не должны перетираться). Тот же документ, собранный
 * повторно, остаётся одним файлом.
 */
async function keepInOrderFiles(params: {
    orderNumber: string;
    pdf: Buffer;
    fileName: string;
    note: string;
    pathPrefix: string;
    author?: string | null;
}): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
    const stamp = createHash('sha256').update(params.pdf).digest('hex').slice(0, 8);
    const path = `order-files/${safeStorageSegment(params.orderNumber, 40)}/contracts/${params.pathPrefix}-${stamp}.pdf`;

    const upload = await supabase.storage.from(BUCKET).upload(path, new Uint8Array(params.pdf), {
        contentType: 'application/pdf',
        upsert: true,
    });
    if (upload.error) return { ok: false, reason: upload.error.message };

    // Одна запись на ЭТОТ файл: тот же второй раз не заводим.
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
            file_name: params.fileName,
            content_type: 'application/pdf',
            size_bytes: params.pdf.length,
            storage_bucket: BUCKET,
            storage_path: path,
            note: params.note,
            uploaded_by: params.author ?? null,
        });
    }

    return { ok: true, path };
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
            // Банк покупателя — из его карточки: раньше тут стояли пустые поля,
            // и в спецификации у покупателя были только ИНН и КПП.
            bank: data.payerBank,
            bik: data.payerBik,
            rs: data.payerRs,
            ks: data.payerKs,
            address: data.payerAddress,
            signerTitle: data.payerSignerTitle,
            signerName: data.payerSignerName,
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
         * Страницы «о компании» здесь нет намеренно.
         *
         * Она уместна в коммерческом предложении, где мы себя представляем. В
         * комплекте на подпись — счёт, договор и спецификация — реклама лишняя
         * (Лена Парфёнова 12.10.2026: «тут это ни к чему, нужно рекламу
         * убрать»).
         */
        const merged = await mergePdfs([Buffer.from(invoice.content), contract, specification]);
        const pages = (await PDFDocument.load(merged)).getPageCount();

        /**
         * В пути — отпечаток содержимого: пересобрали после правки состава,
         * получили другой комплект — он ложится рядом, а не затирает прежний
         * (решение владельца 14.10.2026: файлы не должны перетираться). Тот же
         * самый комплект, собранный повторно, остаётся одним файлом.
         */
        const fileName = `Счёт, договор и спецификация №${params.orderNumber}.pdf`;
        const kept = await keepInOrderFiles({
            orderNumber: params.orderNumber,
            pdf: merged,
            fileName,
            note: 'Счёт, договор и спецификация',
            pathPrefix: `kit-${params.contractId}`,
            author: params.author,
        });
        if (!kept.ok) return { ok: false, reason: kept.reason };

        /**
         * Спецификация ещё и отдельным файлом.
         *
         * Просьба Ирины Гордеевой 20.10.2026: «можно сделать отдельно файл
         * спецификации? это нужно, чтобы сразу отправить клиенту спецификацию
         * без счёта и договора в одном файле». Собирается она здесь же и из
         * тех же данных — второй раз ничего не считаем, просто кладём рядом.
         * Комплект остаётся как был: кому нужен один PDF на подпись, берёт
         * его.
         */
        await keepInOrderFiles({
            orderNumber: params.orderNumber,
            pdf: specification,
            fileName: `Спецификация №${params.orderNumber}.pdf`,
            note: 'Спецификация к договору — отдельным файлом',
            pathPrefix: `specification-${params.contractId}`,
            author: params.author,
        });

        return { ok: true, path: kept.path, fileName, pages };
    } catch (e: any) {
        console.error('[contract-kit] комплект не собрался:', e?.message || e);
        return { ok: false, reason: String(e?.message || e) };
    }
}
