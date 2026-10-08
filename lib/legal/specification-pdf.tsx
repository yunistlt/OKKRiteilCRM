import React from 'react';
import { Document, Page, Text, View, StyleSheet, pdf, Font, Image } from '@react-pdf/renderer';
import path from 'path';

/**
 * Спецификация к договору купли-продажи.
 *
 * Повторяет лист, который выдавала RetailCRM (эталон — заказ 54729): состав,
 * итоги, срок действия цены, способ получения, реквизиты обеих сторон, подпись
 * и печать продавца, пустое место под подпись покупателя.
 *
 * Спецификация — не украшение: по договору (п. 1.2 и 2.1) именно в ней
 * согласуются оборудование и цена, без неё договор беспредметный.
 */
const FONT_FAMILY = 'PTSans';
let fontsRegistered = false;

function ensureFonts() {
    if (fontsRegistered) return;
    try {
        Font.register({
            family: FONT_FAMILY,
            fonts: [
                { src: path.join(process.cwd(), 'public/fonts/PTSans-Regular.ttf'), fontWeight: 'normal' },
                { src: path.join(process.cwd(), 'public/fonts/PTSans-Bold.ttf'), fontWeight: 'bold' },
            ],
        });
        fontsRegistered = true;
    } catch {
        // Без шрифта всё равно соберём: лучше латиница, чем пустая кнопка.
    }
}

const styles = StyleSheet.create({
    page: { fontFamily: FONT_FAMILY, fontSize: 9.5, lineHeight: 1.4, padding: 40, color: '#111' },
    title: { fontSize: 12, fontWeight: 'bold', textAlign: 'center', marginBottom: 4 },
    date: { fontSize: 9.5, textAlign: 'right', marginBottom: 10 },

    table: { borderWidth: 0.8, borderColor: '#1d4ed8', marginBottom: 8 },
    row: { flexDirection: 'row', borderBottomWidth: 0.8, borderBottomColor: '#1d4ed8' },
    rowLast: { flexDirection: 'row' },
    th: { fontWeight: 'bold', fontSize: 9, padding: 3, textAlign: 'center', borderRightWidth: 0.8, borderRightColor: '#1d4ed8' },
    td: { fontSize: 9, padding: 3, borderRightWidth: 0.8, borderRightColor: '#1d4ed8' },
    num: { width: '5%' },
    name: { width: '60%' },
    qty: { width: '9%', textAlign: 'right' },
    price: { width: '13%', textAlign: 'right' },
    sum: { width: '13%', textAlign: 'right', borderRightWidth: 0 },
    totalLabel: { width: '82%', textAlign: 'right', fontSize: 9, padding: 3, borderRightWidth: 0.8, borderRightColor: '#1d4ed8' },
    totalValue: { width: '18%', textAlign: 'right', fontSize: 9, padding: 3 },

    note: { marginTop: 6 },
    center: { textAlign: 'center', fontWeight: 'bold', marginTop: 8, marginBottom: 6 },
    party: { marginTop: 14 },
    partyLine: { marginBottom: 1 },

    signBlock: { marginTop: 14, position: 'relative' },
    signRow: { flexDirection: 'row', alignItems: 'flex-end' },
    signLabel: { width: 110 },
    signLine: { width: 190, borderBottomWidth: 0.8, borderBottomColor: '#111', height: 12 },
    signName: { marginLeft: 8 },
    /** Подпись и печать — те же картинки, что на счёте и договоре. */
    signImage: { position: 'absolute', left: 112, top: -20, width: 130, height: 38, objectFit: 'contain' },
    sealImage: { position: 'absolute', left: 232, top: -22, width: 92, height: 92, objectFit: 'contain', opacity: 0.8 },

    hr: { borderBottomWidth: 0.8, borderBottomColor: '#111', marginVertical: 12 },
});

export type SpecificationItem = {
    name: string;
    quantity: number;
    price: number;
    sum: number;
};

export type SpecificationData = {
    orderNumber: string;
    date: string;
    items: SpecificationItem[];
    discount: number;
    vatAmount: number | null;
    vatPercent: number | null;
    total: number;
    /** «Самовывоз», «Доставка до терминала» — как в заказе. */
    delivery: string | null;
    deliveryNote: string | null;
    /** Сколько действует цена, дней. */
    priceValidDays: number;
    seller: {
        name: string;
        inn: string | null;
        kpp: string | null;
        bank: string | null;
        bik: string | null;
        rs: string | null;
        ks: string | null;
        address: string | null;
        signerName: string | null;
        signerTitle: string | null;
        signatureImage: string | null;
        sealImage: string | null;
    };
    buyer: {
        name: string | null;
        inn: string | null;
        kpp: string | null;
        bank: string | null;
        bik: string | null;
        rs: string | null;
        ks: string | null;
        address: string | null;
        signerTitle: string | null;
    };
};

/** Деньги по-русски: 228 214,40. Закон проекта о разрядах. */
const money = (value: number): string => new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
}).format(Number.isFinite(value) ? value : 0);

function SpecificationPage({ data }: { data: SpecificationData }) {
    const seller = data.seller;
    const buyer = data.buyer;

    return (
        <Document title={`Спецификация к договору №${data.orderNumber}`}>
            <Page size="A4" style={styles.page}>
                <Text style={styles.title}>СПЕЦИФИКАЦИЯ ДОГОВОРУ КУПЛИ-ПРОДАЖИ № {data.orderNumber}</Text>
                <Text style={styles.date}>{data.date}</Text>

                <View style={styles.table}>
                    <View style={styles.row}>
                        <Text style={[styles.th, styles.num]}>№</Text>
                        <Text style={[styles.th, styles.name]}>Наименование товара</Text>
                        <Text style={[styles.th, styles.qty]}>Кол-во</Text>
                        <Text style={[styles.th, styles.price]}>Цена, руб</Text>
                        <Text style={[styles.th, styles.sum, { borderRightWidth: 0 }]}>Сумма, руб</Text>
                    </View>

                    {data.items.map((item, index) => (
                        <View key={index} style={styles.row}>
                            <Text style={[styles.td, styles.num]}>{index + 1}</Text>
                            <Text style={[styles.td, styles.name]}>{item.name}</Text>
                            <Text style={[styles.td, styles.qty]}>{item.quantity}</Text>
                            <Text style={[styles.td, styles.price]}>{money(item.price)}</Text>
                            <Text style={[styles.td, styles.sum]}>{money(item.sum)}</Text>
                        </View>
                    ))}

                    <View style={styles.row}>
                        <Text style={styles.totalLabel}>Сумма скидки:</Text>
                        <Text style={styles.totalValue}>{money(data.discount)}</Text>
                    </View>
                    {data.vatAmount !== null && (
                        <View style={styles.row}>
                            <Text style={styles.totalLabel}>В том числе НДС {data.vatPercent ?? 0}%:</Text>
                            <Text style={styles.totalValue}>{money(data.vatAmount)}</Text>
                        </View>
                    )}
                    <View style={styles.rowLast}>
                        <Text style={styles.totalLabel}>Итого:</Text>
                        <Text style={styles.totalValue}>{money(data.total)}</Text>
                    </View>
                </View>

                <Text>Указанная стоимость действительна в течение {data.priceValidDays} банковских дней.</Text>

                {data.delivery && <Text style={styles.center}>Способ получения: {data.delivery}</Text>}
                {data.deliveryNote && <Text style={styles.note}>Дополнительная информация: {data.deliveryNote}</Text>}

                <View style={styles.party}>
                    <Text style={styles.partyLine}>Продавец: {seller.name}</Text>
                    {seller.bank && <Text style={styles.partyLine}>Банк: {seller.bank}{seller.bik ? ` БИК: ${seller.bik}` : ''}</Text>}
                    <Text style={styles.partyLine}>
                        ИНН: {seller.inn || '—'}{seller.kpp ? ` КПП: ${seller.kpp}` : ''}
                    </Text>
                    {seller.rs && <Text style={styles.partyLine}>Расчётный счёт: {seller.rs}{seller.ks ? ` Корр. счёт: ${seller.ks}` : ''}</Text>}
                    {seller.address && <Text style={styles.partyLine}>Адрес: {seller.address}</Text>}
                </View>

                <View style={styles.signBlock}>
                    <View style={styles.signRow}>
                        <Text style={styles.signLabel}>{seller.signerTitle || 'Руководитель организации'}:</Text>
                        <View style={styles.signLine} />
                        <Text style={styles.signName}>/ {seller.signerName || '—'} /</Text>
                    </View>
                    {/* Подпись и печать ставятся сюда же, как на счёте: клиент
                        получает подписанный документ, а не бланк. */}
                    {seller.signatureImage && <Image src={seller.signatureImage} style={styles.signImage} />}
                    {seller.sealImage && <Image src={seller.sealImage} style={styles.sealImage} />}
                </View>

                <View style={{ height: 70 }} />
                <View style={styles.hr} />

                <View>
                    <Text style={styles.partyLine}>
                        Покупатель: {buyer.name || ''}{buyer.inn ? ` ИНН: ${buyer.inn}` : ''}{buyer.kpp ? ` КПП: ${buyer.kpp}` : ''}
                    </Text>
                    {buyer.bank && <Text style={styles.partyLine}>Банк: {buyer.bank}{buyer.bik ? ` БИК: ${buyer.bik}` : ''}</Text>}
                    {buyer.rs && <Text style={styles.partyLine}>Расчётный счёт: {buyer.rs}{buyer.ks ? ` Корр. счёт: ${buyer.ks}` : ''}</Text>}
                    {buyer.address && <Text style={styles.partyLine}>Адрес: {buyer.address}</Text>}
                </View>

                {/* Покупатель подписывает от руки — его подписи у нас нет и быть не должно. */}
                <View style={[styles.signRow, { marginTop: 34 }]}>
                    <Text style={styles.signLabel}>Руководитель организации:</Text>
                    <View style={styles.signLine} />
                    <Text style={styles.signName}>/{buyer.signerTitle || ''}/</Text>
                </View>
            </Page>
        </Document>
    );
}

export async function buildSpecificationPdf(data: SpecificationData): Promise<Buffer> {
    ensureFonts();
    const doc = React.createElement(SpecificationPage, { data });
    const blob = await pdf(doc as any).toBlob();
    return Buffer.from(await blob.arrayBuffer());
}
