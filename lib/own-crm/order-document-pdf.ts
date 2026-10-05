/**
 * Сборка КП и счёта по заказу — одно место на весь проект.
 *
 * Документ нужен и кнопкой в карточке, и вложением к письму. Пока сборка жила
 * внутри маршрута, письмо прикладывало PDF так: браузер скачивал документ и
 * отправлял его обратно строкой base64. Вместе с паспортами и сертификатами
 * тело запроса упиралось в лимит, и менеджер получал «Unexpected token 'R'»
 * (Ирина 02.10.2026). Теперь письмо собирает документ на сервере.
 */
import { orderDocumentData, type OrderDocumentData } from '@/lib/own-crm/documents';
import { generateInvoicePDF, generateProposalPDF } from '@/lib/pdf-generator';
import { KP_ABOUT_PAGE_PDF_BASE64 } from '@/lib/own-crm/kp-about-page';
import { PDFDocument } from 'pdf-lib';

/**
 * Поставить перед КП страницу «Компания в цифрах» (владелец 05.10.2026).
 * Она идёт ПЕРВОЙ, как в прежнем КП RetailCRM: клиент сначала видит, с кем
 * имеет дело, и только потом цены.
 *
 * Не приклеилась — отдаём предложение как есть: КП без рекламной страницы
 * остаётся рабочим документом, а без цен и реквизитов — нет.
 */
async function withAboutPage(pdf: Uint8Array): Promise<Uint8Array> {
    try {
        const about = await PDFDocument.load(Buffer.from(KP_ABOUT_PAGE_PDF_BASE64, 'base64'));
        const proposal = await PDFDocument.load(pdf);
        const pages = await about.copyPages(proposal, proposal.getPageIndices());
        for (const page of pages) about.addPage(page);
        return await about.save();
    } catch (e: any) {
        console.warn('[КП] страница о компании не приклеилась:', e?.message);
        return pdf;
    }
}

export type OrderDocumentKind = 'proposal' | 'invoice';

export type BuiltOrderDocument = {
    fileName: string;
    content: Buffer;
    contentType: 'application/pdf';
};

/** Данные заказа для документа. Null — заказ не найден. */
export async function loadOrderDocumentData(
    orderId: number,
    sellerCode?: string | null,
): Promise<OrderDocumentData | null> {
    return orderDocumentData(orderId, sellerCode ?? null);
}

/** Собирает PDF из уже прочитанных данных заказа. */
export async function buildOrderDocumentPdf(
    data: OrderDocumentData,
    kind: OrderDocumentKind,
): Promise<BuiltOrderDocument> {
    const items = data.items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        initial_price: item.initialPrice,
        discount: item.discount,
        image: item.image,
    }));

    const pdf = kind === 'invoice'
        ? await generateInvoicePDF({
            invoice_number: data.orderNumber,
            title: `Счёт по заказу №${data.orderNumber}`,
            items,
            discount_pct: 0,
            vat_pct: data.vatPercent,
            payer_company: data.payerCompany || undefined,
            payer_name: data.payerName || undefined,
            payer_inn: data.payerInn || undefined,
            payer_kpp: data.payerKpp || undefined,
            payer_address: data.payerAddress || undefined,
            seller_name: data.seller?.name,
            seller_inn: data.seller?.inn,
            seller_kpp: data.seller?.kpp,
            seller_bank: data.seller?.bank,
            seller_bik: data.seller?.bik,
            seller_ks: data.seller?.ks,
            seller_rs: data.seller?.rs,
            seller_address: data.seller?.address,
            seller_ogrn: data.seller?.ogrn,
            seller_full_name: data.sellerFullName,
            seller_seal_place: data.sellerSealPlace,
            seller_has_seal: data.sellerHasSeal,
            seal_image: data.sealImage,
            signature_image: data.signatureImage,
            manager_name: data.managerName,
            production_days: data.productionDays,
            production_term: data.productionTerm,
            shipping_terms: data.shippingTerms,
            signer_name: data.signerName,
            signer_title: data.signerTitle,
        })
        : await generateProposalPDF({
            // КП показывает то же, что счёт: кто продаёт, НДС, скидку, сроки,
            // доставку, подписи и печать (замечания Евгении 05.10.2026).
            title: `Коммерческое предложение № ${data.orderNumber}`,
            items,
            discount_pct: 0,
            client_company: data.payerCompany || undefined,
            client_name: data.payerName || undefined,
            vat_pct: data.vatPercent,
            seller_name: data.seller?.name,
            seller_inn: data.seller?.inn,
            seller_kpp: data.seller?.kpp,
            seller_bank: data.seller?.bank,
            seller_bik: data.seller?.bik,
            seller_ks: data.seller?.ks,
            seller_rs: data.seller?.rs,
            seller_address: data.seller?.address,
            seller_ogrn: data.seller?.ogrn,
            seller_full_name: data.sellerFullName,
            seller_seal_place: data.sellerSealPlace,
            seller_has_seal: data.sellerHasSeal,
            seal_image: data.sealImage,
            signature_image: data.signatureImage,
            manager_name: data.managerName,
            production_days: data.productionDays,
            production_term: data.productionTerm,
            shipping_terms: data.shippingTerms,
            signer_name: data.signerName,
            signer_title: data.signerTitle,
            valid_days: data.validDays,
        });

    const content = kind === 'proposal' ? await withAboutPage(pdf) : pdf;

    return {
        fileName: kind === 'invoice' ? `Счёт №${data.orderNumber}.pdf` : `КП №${data.orderNumber}.pdf`,
        content: Buffer.from(content),
        contentType: 'application/pdf',
    };
}
