import React from 'react';
import {
    Document,
    Page,
    Text,
    View,
    StyleSheet,
    pdf,
    Font,
    Svg,
    Circle,
    G,
} from '@react-pdf/renderer';
import path from 'path';

/**
 * Шрифт с кириллицей. Стандартный Helvetica русских букв не знает: 30.09.2026
 * счёт и КП вышли набором кракозябр вместо названий товаров и реквизитов.
 * PT Sans лежит в public/fonts и покрывает кириллицу.
 */
const FONT_FAMILY = 'PTSans';
let fontsRegistered = false;

function ensureFonts() {
    if (fontsRegistered) {
        return;
    }
    try {
        Font.register({
            family: FONT_FAMILY,
            fonts: [
                { src: path.join(process.cwd(), 'public/fonts/PTSans-Regular.ttf'), fontWeight: 'normal' },
                { src: path.join(process.cwd(), 'public/fonts/PTSans-Bold.ttf'), fontWeight: 'bold' },
            ],
        });
        fontsRegistered = true;
    } catch (error) {
        // Без шрифта документ всё равно соберётся, но по-русски читаться не будет —
        // поэтому говорим об этом в логе громко.
        console.error('[pdf] Не удалось подключить шрифт с кириллицей:', error);
    }
}

export interface ProposalItem {
    name: string;
    description?: string;
    quantity: number;
    price: number;
    unit?: string;
}

export interface ProposalData {
    title: string;
    intro?: string;
    items: ProposalItem[];
    discount_pct: number;
    valid_until?: string; // ISO date
    client_name?: string;
    client_company?: string;
}

// ── Стили ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
    page: {
        fontFamily: FONT_FAMILY,
        fontSize: 10,
        paddingTop: 40,
        paddingBottom: 50,
        paddingHorizontal: 40,
        color: '#1e293b',
        backgroundColor: '#ffffff',
    },
    // Шапка
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 24,
        paddingBottom: 16,
        borderBottomWidth: 2,
        borderBottomColor: '#10b981',
    },
    headerLeft: { flexDirection: 'column' },
    companyName: { fontSize: 16, fontFamily: FONT_FAMILY, fontWeight: 'bold', color: '#0f172a' },
    companyTagline: { fontSize: 9, color: '#64748b', marginTop: 2 },
    headerRight: { alignItems: 'flex-end' },
    docLabel: { fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 },
    docDate: { fontSize: 9, color: '#64748b', marginTop: 2 },

    // Заголовок
    titleBlock: { marginBottom: 20 },
    title: { fontSize: 18, fontFamily: FONT_FAMILY, fontWeight: 'bold', color: '#0f172a', marginBottom: 6 },
    clientInfo: { fontSize: 10, color: '#475569' },

    // Введение
    intro: {
        fontSize: 10,
        color: '#475569',
        lineHeight: 1.6,
        marginBottom: 20,
        padding: 12,
        backgroundColor: '#f0fdf4',
        borderLeftWidth: 3,
        borderLeftColor: '#10b981',
    },

    // Таблица позиций
    table: { marginBottom: 20 },
    tableHeader: {
        flexDirection: 'row',
        backgroundColor: '#0f172a',
        padding: '8 10',
        borderRadius: 4,
    },
    tableHeaderText: { fontSize: 8, color: '#ffffff', fontFamily: FONT_FAMILY, fontWeight: 'bold', textTransform: 'uppercase' },
    tableRow: {
        flexDirection: 'row',
        borderBottomWidth: 1,
        borderBottomColor: '#f1f5f9',
        padding: '8 10',
    },
    tableRowAlt: { backgroundColor: '#f8fafc' },
    colNum:   { width: '5%' },
    colName:  { width: '40%' },
    colQty:   { width: '10%', textAlign: 'right' },
    colUnit:  { width: '10%', textAlign: 'center' },
    colPrice: { width: '17%', textAlign: 'right' },
    colTotal: { width: '18%', textAlign: 'right' },
    cellText: { fontSize: 9, color: '#1e293b' },
    cellTextGray: { fontSize: 8, color: '#94a3b8', marginTop: 2 },

    // Итог
    totalsBlock: {
        alignSelf: 'flex-end',
        width: '45%',
        marginBottom: 24,
    },
    totalRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: 4,
        borderBottomWidth: 1,
        borderBottomColor: '#f1f5f9',
    },
    totalLabel: { fontSize: 9, color: '#64748b' },
    totalValue: { fontSize: 9, color: '#1e293b' },
    grandTotalRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 6,
        padding: '8 10',
        backgroundColor: '#0f172a',
        borderRadius: 4,
    },
    grandTotalLabel: { fontSize: 10, color: '#ffffff', fontFamily: FONT_FAMILY, fontWeight: 'bold' },
    grandTotalValue: { fontSize: 12, color: '#10b981', fontFamily: FONT_FAMILY, fontWeight: 'bold' },

    // Условия
    conditions: {
        marginBottom: 24,
        padding: 12,
        backgroundColor: '#f8fafc',
        borderRadius: 6,
    },
    conditionsTitle: { fontSize: 9, fontFamily: FONT_FAMILY, fontWeight: 'bold', color: '#475569', marginBottom: 6, textTransform: 'uppercase' },
    conditionRow: { flexDirection: 'row', marginBottom: 3 },
    conditionBullet: { fontSize: 9, color: '#10b981', marginRight: 6 },
    conditionText: { fontSize: 9, color: '#475569', flex: 1 },

    // Подпись
    footer: {
        position: 'absolute',
        bottom: 30,
        left: 40,
        right: 40,
        flexDirection: 'row',
        justifyContent: 'space-between',
        borderTopWidth: 1,
        borderTopColor: '#e2e8f0',
        paddingTop: 10,
    },
    footerText: { fontSize: 8, color: '#94a3b8' },
});

// ── Форматирование числа ─────────────────────────────────────────────────────
function formatMoney(n: number): string {
    return n.toLocaleString('ru-RU') + ' ₽';
}

// ── Компонент PDF ─────────────────────────────────────────────────────────────
function ProposalPDF({ data }: { data: ProposalData }) {
    const subtotal = data.items.reduce((s, i) => s + i.price * i.quantity, 0);
    const discountAmt = Math.round(subtotal * (data.discount_pct / 100));
    const total = subtotal - discountAmt;
    const today = new Date().toLocaleDateString('ru-RU');
    const validUntil = data.valid_until
        ? new Date(data.valid_until).toLocaleDateString('ru-RU')
        : null;

    return (
        <Document>
            <Page size="A4" style={styles.page}>
                {/* Шапка */}
                <View style={styles.header}>
                    <View style={styles.headerLeft}>
                        <Text style={styles.companyName}>ЗМК — Завод Металлоконструкций</Text>
                        <Text style={styles.companyTagline}>zmktlt.ru • Промышленное оборудование</Text>
                    </View>
                    <View style={styles.headerRight}>
                        <Text style={styles.docLabel}>Коммерческое предложение</Text>
                        <Text style={styles.docDate}>Дата: {today}</Text>
                        {validUntil && <Text style={styles.docDate}>Действует до: {validUntil}</Text>}
                    </View>
                </View>

                {/* Заголовок */}
                <View style={styles.titleBlock}>
                    <Text style={styles.title}>{data.title}</Text>
                    {(data.client_name || data.client_company) && (
                        <Text style={styles.clientInfo}>
                            Для: {[data.client_company, data.client_name].filter(Boolean).join(' — ')}
                        </Text>
                    )}
                </View>

                {/* Введение */}
                {data.intro && <Text style={styles.intro}>{data.intro}</Text>}

                {/* Таблица */}
                <View style={styles.table}>
                    <View style={styles.tableHeader}>
                        <Text style={[styles.tableHeaderText, styles.colNum]}>№</Text>
                        <Text style={[styles.tableHeaderText, styles.colName]}>Наименование</Text>
                        <Text style={[styles.tableHeaderText, styles.colQty]}>Кол-во</Text>
                        <Text style={[styles.tableHeaderText, styles.colUnit]}>Ед.</Text>
                        <Text style={[styles.tableHeaderText, styles.colPrice]}>Цена, ₽</Text>
                        <Text style={[styles.tableHeaderText, styles.colTotal]}>Сумма, ₽</Text>
                    </View>
                    {data.items.map((item, idx) => (
                        <View key={idx} style={[styles.tableRow, idx % 2 === 1 ? styles.tableRowAlt : {}]}>
                            <Text style={[styles.cellText, styles.colNum]}>{idx + 1}</Text>
                            <View style={styles.colName}>
                                <Text style={styles.cellText}>{item.name}</Text>
                                {item.description && <Text style={styles.cellTextGray}>{item.description}</Text>}
                            </View>
                            <Text style={[styles.cellText, styles.colQty]}>{item.quantity}</Text>
                            <Text style={[styles.cellText, styles.colUnit]}>{item.unit || 'шт.'}</Text>
                            <Text style={[styles.cellText, styles.colPrice]}>{formatMoney(item.price)}</Text>
                            <Text style={[styles.cellText, styles.colTotal]}>{formatMoney(item.price * item.quantity)}</Text>
                        </View>
                    ))}
                </View>

                {/* Итоги */}
                <View style={styles.totalsBlock}>
                    <View style={styles.totalRow}>
                        <Text style={styles.totalLabel}>Подытог</Text>
                        <Text style={styles.totalValue}>{formatMoney(subtotal)}</Text>
                    </View>
                    {data.discount_pct > 0 && (
                        <View style={styles.totalRow}>
                            <Text style={styles.totalLabel}>Скидка {data.discount_pct}%</Text>
                            <Text style={[styles.totalValue, { color: '#ef4444' }]}>−{formatMoney(discountAmt)}</Text>
                        </View>
                    )}
                    <View style={styles.grandTotalRow}>
                        <Text style={styles.grandTotalLabel}>Итого с НДС</Text>
                        <Text style={styles.grandTotalValue}>{formatMoney(total)}</Text>
                    </View>
                </View>

                {/* Условия */}
                <View style={styles.conditions}>
                    <Text style={styles.conditionsTitle}>Условия предложения</Text>
                    {[
                        'Цены указаны с учётом НДС',
                        'Срок изготовления уточняется при заказе',
                        'Доставка по России — по тарифам перевозчика',
                        'Бесплатная онлайн-настройка и запуск оборудования',
                        'Гарантия 12 месяцев с момента поставки',
                    ].map((c, i) => (
                        <View key={i} style={styles.conditionRow}>
                            <Text style={styles.conditionBullet}>•</Text>
                            <Text style={styles.conditionText}>{c}</Text>
                        </View>
                    ))}
                </View>

                {/* Подпись */}
                <View style={styles.footer} fixed>
                    <Text style={styles.footerText}>ЗМК • zmktlt.ru • Подготовлено автоматически</Text>
                    <Text style={styles.footerText}>
                        {validUntil ? `Предложение действует до ${validUntil}` : today}
                    </Text>
                </View>
            </Page>
        </Document>
    );
}

// ── Публичная функция генерации PDF ──────────────────────────────────────────
export async function generateProposalPDF(data: ProposalData): Promise<Buffer> {
    ensureFonts();
    const doc = React.createElement(ProposalPDF, { data });
    const instance = pdf(doc as any);
    const blob = await instance.toBlob();
    const arrayBuffer = await blob.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

// ─────────────────────────────────────────────────────────────────────────────
// СЧЁТ НА ОПЛАТУ (банковский перевод)
// ─────────────────────────────────────────────────────────────────────────────

export interface InvoiceData {
    invoice_number: string;
    title: string;
    items: ProposalItem[];
    discount_pct: number;
    vat_pct: number;           // 20 по умолчанию
    due_date?: string;         // ISO date
    payer_name?: string;
    payer_company?: string;
    payer_inn?: string;
    payer_kpp?: string;
    payer_address?: string;
    // Реквизиты продавца (читаются из env, fallback — placeholder)
    seller_name?: string;
    seller_inn?: string;
    seller_kpp?: string;
    seller_bank?: string;
    seller_bik?: string;
    seller_ks?: string;   // корр. счёт
    seller_rs?: string;   // расч. счёт
    seller_address?: string;
    /** ОГРН продавца — для печати организации. */
    seller_ogrn?: string;
    /** Срок изготовления в днях — из заказа. */
    production_days?: number | null;
    /** Как получает клиент: способ доставки и адрес (при самовывозе — откуда). */
    shipping_terms?: string | null;
    /** Кто подписывает счёт: ФИО и должность из справочника наших юрлиц. */
    signer_name?: string | null;
    signer_title?: string | null;
}

const invStyles = StyleSheet.create({
    page: { fontFamily: FONT_FAMILY, fontSize: 9, padding: 40, color: '#1e293b', backgroundColor: '#fff' },
    // Шапка
    topBorder: { height: 4, backgroundColor: '#0f172a', marginBottom: 16 },
    headerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
    sellerBlock: { width: '55%' },
    invoiceMeta: { width: '40%', alignItems: 'flex-end' },
    bold: { fontFamily: FONT_FAMILY, fontWeight: 'bold' },
    lg: { fontSize: 18, fontFamily: FONT_FAMILY, fontWeight: 'bold', color: '#0f172a', marginBottom: 4 },
    sm: { fontSize: 8, color: '#64748b', lineHeight: 1.4 },
    // Банковские реквизиты
    bankBox: {
        backgroundColor: '#f8fafc',
        border: 1, borderColor: '#e2e8f0', borderRadius: 4,
        padding: 10, marginBottom: 14,
    },
    bankTitle: { fontSize: 8, fontFamily: FONT_FAMILY, fontWeight: 'bold', color: '#475569', textTransform: 'uppercase', marginBottom: 6, letterSpacing: 0.5 },
    bankRow: { flexDirection: 'row', marginBottom: 3 },
    bankLabel: { width: '38%', fontSize: 8, color: '#94a3b8' },
    bankValue: { width: '62%', fontSize: 8, color: '#1e293b', fontFamily: FONT_FAMILY, fontWeight: 'bold' },
    // Плательщик
    payerBox: { border: 1, borderColor: '#e2e8f0', borderRadius: 4, padding: 10, marginBottom: 14 },
    payerTitle: { fontSize: 8, fontFamily: FONT_FAMILY, fontWeight: 'bold', color: '#475569', textTransform: 'uppercase', marginBottom: 6 },
    payerRow: { flexDirection: 'row', marginBottom: 3 },
    payerLabel: { width: '28%', fontSize: 8, color: '#94a3b8' },
    payerValue: { width: '72%', fontSize: 8, color: '#1e293b' },
    // Таблица
    tblHeader: { flexDirection: 'row', backgroundColor: '#0f172a', padding: '6 8', marginBottom: 0 },
    tblHeaderText: { fontSize: 7.5, color: '#fff', fontFamily: FONT_FAMILY, fontWeight: 'bold', textTransform: 'uppercase' },
    tblRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#f1f5f9', padding: '6 8' },
    tblAlt: { backgroundColor: '#f8fafc' },
    cNum: { width: '5%' }, cName: { width: '38%' }, cQty: { width: '9%', textAlign: 'right' },
    cUnit: { width: '9%', textAlign: 'center' }, cPrice: { width: '19%', textAlign: 'right' }, cTotal: { width: '20%', textAlign: 'right' },
    cell: { fontSize: 8.5, color: '#1e293b' },
    cellGray: { fontSize: 7.5, color: '#94a3b8', marginTop: 1 },
    // Итоги
    totals: { alignSelf: 'flex-end', width: '44%', marginTop: 8, marginBottom: 14 },
    totRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
    totLabel: { fontSize: 8.5, color: '#64748b' },
    totVal: { fontSize: 8.5, color: '#1e293b' },
    grandRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5, padding: '7 8', backgroundColor: '#0f172a', borderRadius: 3 },
    grandLabel: { fontSize: 9, color: '#fff', fontFamily: FONT_FAMILY, fontWeight: 'bold' },
    grandVal: { fontSize: 11, color: '#10b981', fontFamily: FONT_FAMILY, fontWeight: 'bold' },
    // Подпись
    signBlock: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 24, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 12 },
    signCol: { width: '32%' },
    sealCol: { width: '30%', alignItems: 'center' },
    signLabel: { fontSize: 8, color: '#94a3b8', marginBottom: 20 },
    signLine: { borderBottomWidth: 1, borderBottomColor: '#94a3b8', marginBottom: 4 },
    signName: { fontSize: 8, color: '#475569' },
    footer: { position: 'absolute', bottom: 28, left: 40, right: 40, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 8, flexDirection: 'row', justifyContent: 'space-between' },
    footerText: { fontSize: 7.5, color: '#94a3b8' },
});

function InvoicePDF({ data }: { data: InvoiceData }) {
    const subtotal = data.items.reduce((s, i) => s + i.price * i.quantity, 0);
    const discountAmt = Math.round(subtotal * ((data.discount_pct || 0) / 100));
    const afterDiscount = subtotal - discountAmt;
    const vatAmt = Math.round(afterDiscount * (data.vat_pct / 100) / (1 + data.vat_pct / 100));
    const total = afterDiscount;

    const today = new Date().toLocaleDateString('ru-RU');
    const dueDate = data.due_date ? new Date(data.due_date).toLocaleDateString('ru-RU') : null;

    // Реквизиты с fallback на env
    const seller = {
        name:    data.seller_name    || process.env.INVOICE_SELLER_NAME    || 'ООО «ЗМК»',
        inn:     data.seller_inn     || process.env.INVOICE_SELLER_INN     || '—',
        kpp:     data.seller_kpp     || process.env.INVOICE_SELLER_KPP     || '—',
        bank:    data.seller_bank    || process.env.INVOICE_SELLER_BANK    || '—',
        bik:     data.seller_bik     || process.env.INVOICE_SELLER_BIK     || '—',
        ks:      data.seller_ks      || process.env.INVOICE_SELLER_KS      || '—',
        rs:      data.seller_rs      || process.env.INVOICE_SELLER_RS      || '—',
        address: data.seller_address || process.env.INVOICE_SELLER_ADDRESS || '—',
    };

    return (
        <Document>
            <Page size="A4" style={invStyles.page}>
                {/* Верхняя полоса */}
                <View style={invStyles.topBorder} />

                {/* Шапка: продавец + мета */}
                <View style={invStyles.headerRow}>
                    <View style={invStyles.sellerBlock}>
                        <Text style={invStyles.lg}>Счёт на оплату № {data.invoice_number}</Text>
                        <Text style={[invStyles.sm, { marginBottom: 4 }]}>от {today}</Text>
                        <Text style={[invStyles.sm, invStyles.bold]}>{seller.name}</Text>
                        <Text style={invStyles.sm}>ИНН: {seller.inn}  КПП: {seller.kpp}</Text>
                        <Text style={invStyles.sm}>{seller.address}</Text>
                    </View>
                    <View style={invStyles.invoiceMeta}>
                        <Text style={[invStyles.sm, { marginBottom: 2 }]}>Дата выставления: {today}</Text>
                        {dueDate && <Text style={[invStyles.sm, { color: '#ef4444' }]}>Срок оплаты: {dueDate}</Text>}
                        <Text style={[invStyles.sm, { marginTop: 8, fontFamily: FONT_FAMILY, fontWeight: 'bold' }]}>Оплата: банковский перевод</Text>
                    </View>
                </View>

                {/* Банковские реквизиты */}
                <View style={invStyles.bankBox}>
                    <Text style={invStyles.bankTitle}>Банковские реквизиты получателя</Text>
                    {[
                        ['Банк',           seller.bank],
                        ['БИК',            seller.bik],
                        ['Корр. счёт',     seller.ks],
                        ['Расч. счёт',     seller.rs],
                        ['Получатель',     seller.name],
                        ['ИНН / КПП',      `${seller.inn} / ${seller.kpp}`],
                    ].map(([label, value], i) => (
                        <View key={i} style={invStyles.bankRow}>
                            <Text style={invStyles.bankLabel}>{label}</Text>
                            <Text style={invStyles.bankValue}>{value}</Text>
                        </View>
                    ))}
                </View>

                {/* Плательщик */}
                {(data.payer_company || data.payer_name) && (
                    <View style={invStyles.payerBox}>
                        <Text style={invStyles.payerTitle}>Плательщик</Text>
                        {data.payer_company && (
                            <View style={invStyles.payerRow}>
                                <Text style={invStyles.payerLabel}>Организация</Text>
                                <Text style={[invStyles.payerValue, invStyles.bold]}>{data.payer_company}</Text>
                            </View>
                        )}
                        {data.payer_name && (
                            <View style={invStyles.payerRow}>
                                <Text style={invStyles.payerLabel}>Контакт</Text>
                                <Text style={invStyles.payerValue}>{data.payer_name}</Text>
                            </View>
                        )}
                        {data.payer_inn && (
                            <View style={invStyles.payerRow}>
                                <Text style={invStyles.payerLabel}>ИНН / КПП</Text>
                                <Text style={invStyles.payerValue}>{data.payer_inn}{data.payer_kpp ? ` / ${data.payer_kpp}` : ''}</Text>
                            </View>
                        )}
                        {data.payer_address && (
                            <View style={invStyles.payerRow}>
                                <Text style={invStyles.payerLabel}>Адрес</Text>
                                <Text style={invStyles.payerValue}>{data.payer_address}</Text>
                            </View>
                        )}
                    </View>
                )}

                {/* Назначение */}
                <Text style={[invStyles.sm, invStyles.bold, { marginBottom: 6 }]}>
                    Назначение: {data.title}
                </Text>

                {/* Таблица позиций */}
                <View style={invStyles.tblHeader}>
                    <Text style={[invStyles.tblHeaderText, invStyles.cNum]}>№</Text>
                    <Text style={[invStyles.tblHeaderText, invStyles.cName]}>Наименование</Text>
                    <Text style={[invStyles.tblHeaderText, invStyles.cQty]}>Кол-во</Text>
                    <Text style={[invStyles.tblHeaderText, invStyles.cUnit]}>Ед.</Text>
                    <Text style={[invStyles.tblHeaderText, invStyles.cPrice]}>Цена, ₽</Text>
                    <Text style={[invStyles.tblHeaderText, invStyles.cTotal]}>Сумма, ₽</Text>
                </View>
                {data.items.map((item, idx) => (
                    <View key={idx} style={[invStyles.tblRow, idx % 2 === 1 ? invStyles.tblAlt : {}]}>
                        <Text style={[invStyles.cell, invStyles.cNum]}>{idx + 1}</Text>
                        <View style={invStyles.cName}>
                            <Text style={invStyles.cell}>{item.name}</Text>
                            {item.description && <Text style={invStyles.cellGray}>{item.description}</Text>}
                        </View>
                        <Text style={[invStyles.cell, invStyles.cQty]}>{item.quantity}</Text>
                        <Text style={[invStyles.cell, invStyles.cUnit]}>{item.unit || 'шт.'}</Text>
                        <Text style={[invStyles.cell, invStyles.cPrice]}>{formatMoney(item.price)}</Text>
                        <Text style={[invStyles.cell, invStyles.cTotal]}>{formatMoney(item.price * item.quantity)}</Text>
                    </View>
                ))}

                {/* Итоги */}
                <View style={invStyles.totals}>
                    <View style={invStyles.totRow}>
                        <Text style={invStyles.totLabel}>Подытог</Text>
                        <Text style={invStyles.totVal}>{formatMoney(subtotal)}</Text>
                    </View>
                    {data.discount_pct > 0 && (
                        <View style={invStyles.totRow}>
                            <Text style={invStyles.totLabel}>Скидка {data.discount_pct}%</Text>
                            <Text style={[invStyles.totVal, { color: '#ef4444' }]}>−{formatMoney(discountAmt)}</Text>
                        </View>
                    )}
                    <View style={invStyles.totRow}>
                        <Text style={invStyles.totLabel}>В т.ч. НДС {data.vat_pct}%</Text>
                        <Text style={invStyles.totVal}>{formatMoney(vatAmt)}</Text>
                    </View>
                    <View style={invStyles.grandRow}>
                        <Text style={invStyles.grandLabel}>Итого к оплате</Text>
                        <Text style={invStyles.grandVal}>{formatMoney(total)}</Text>
                    </View>
                </View>

                {/* Сумма прописью — placeholder */}
                <Text style={[invStyles.sm, { marginBottom: data.production_days || data.shipping_terms ? 6 : 16 }]}>
                    Всего наименований {data.items.length}, на сумму {formatMoney(total)}
                </Text>

                {/* Сроки и получение: без них счёт не отвечает на вопросы клиента
                    «когда» и «откуда забирать» (замечание Евгении 02.10.2026). */}
                {data.production_days ? (
                    <Text style={[invStyles.sm, { marginBottom: 4 }]}>
                        Срок изготовления: {data.production_days} дн.
                    </Text>
                ) : null}
                {data.shipping_terms ? (
                    <Text style={[invStyles.sm, { marginBottom: 16 }]}>
                        Условия получения: {data.shipping_terms}
                    </Text>
                ) : null}

                {/* Подпись */}
                <View style={invStyles.signBlock}>
                    <View style={invStyles.signCol}>
                        <Text style={invStyles.signLabel}>{data.signer_title || 'Руководитель'}</Text>
                        <View style={invStyles.signLine} />
                        <Text style={invStyles.signName}>{data.signer_name || '____________________'}</Text>
                    </View>
                    <View style={invStyles.signCol}>
                        <Text style={invStyles.signLabel}>Главный бухгалтер</Text>
                        <View style={invStyles.signLine} />
                        <Text style={invStyles.signName}>____________________</Text>
                    </View>
                    {/* Печать организации — своя на каждое юрлицо, рисуется по
                        его реквизитам (решение владельца 02.10.2026). */}
                    <View style={invStyles.sealCol}>
                        <OrganizationSeal
                            name={seller.name}
                            inn={seller.inn}
                            kpp={seller.kpp}
                            ogrn={data.seller_ogrn}
                            city={cityFromAddress(seller.address)}
                        />
                    </View>
                </View>

                <View style={invStyles.footer} fixed>
                    <Text style={invStyles.footerText}>ЗМК • zmktlt.ru • Счёт № {data.invoice_number}</Text>
                    <Text style={invStyles.footerText}>{dueDate ? `Срок оплаты: ${dueDate}` : today}</Text>
                </View>
            </Page>
        </Document>
    );
}

/**
 * Печать организации — «для документов», своя на каждое юрлицо.
 *
 * Решение владельца 02.10.2026: печати делаем сами, по кругу — реквизиты
 * организации (ИНН и прочие). Рисуем вектором прямо в PDF: картинок печатей
 * у нас нет, а RetailCRM их через API не отдаёт (проверено 02.10.2026 —
 * справочник магазинов даёт только реквизиты, метода печатных форм нет).
 *
 * Это печать для документов, не гербовая: она удостоверяет счёт, а не
 * подменяет подпись — подпись руководителя рядом остаётся за человеком.
 */
function OrganizationSeal({ name, inn, kpp, ogrn, city }: {
    name: string;
    inn?: string;
    kpp?: string;
    ogrn?: string;
    city?: string;
}) {
    const size = 128;
    const center = size / 2;
    const ink = '#1d4ed8';

    // Текст по окружности: каждая буква — своя, повёрнутая к центру.
    const ring = (text: string, radius: number, fontSize: number, startDeg: number, sweepDeg: number) => {
        const letters = Array.from(text);
        if (!letters.length) return null;
        const step = sweepDeg / Math.max(1, letters.length);

        return letters.map((letter, index) => {
            const angle = startDeg + step * (index + 0.5);
            return (
                <G key={`${radius}-${index}`} transform={`rotate(${angle} ${center} ${center})`}>
                    <Text
                        x={center}
                        y={center - radius}
                        style={{ fontFamily: FONT_FAMILY, fontSize, fill: ink }}
                        textAnchor="middle"
                    >
                        {letter}
                    </Text>
                </G>
            );
        });
    };

    const upper = name.toUpperCase();
    const lower = [inn ? `ИНН ${inn}` : null, kpp ? `КПП ${kpp}` : null].filter(Boolean).join(' · ');

    return (
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <Circle cx={center} cy={center} r={62} stroke={ink} strokeWidth={2} fill="none" />
            <Circle cx={center} cy={center} r={56} stroke={ink} strokeWidth={0.8} fill="none" />
            <Circle cx={center} cy={center} r={34} stroke={ink} strokeWidth={0.8} fill="none" />

            {/* Название — по верхней дуге, реквизиты — по нижней. */}
            {ring(upper, 48, upper.length > 34 ? 5 : 6.5, -110, 220)}
            {ring(lower, 44, 5.5, 110, 140)}

            {/* В центре — то, по чему организацию узнают в документах. */}
            <Text x={center} y={center - 6} style={{ fontFamily: FONT_FAMILY, fontSize: 6, fill: ink }} textAnchor="middle">
                ДЛЯ ДОКУМЕНТОВ
            </Text>
            {ogrn ? (
                <Text x={center} y={center + 4} style={{ fontFamily: FONT_FAMILY, fontSize: 5.5, fill: ink }} textAnchor="middle">
                    ОГРН {ogrn}
                </Text>
            ) : null}
            {city ? (
                <Text x={center} y={center + 14} style={{ fontFamily: FONT_FAMILY, fontSize: 5.5, fill: ink }} textAnchor="middle">
                    {city}
                </Text>
            ) : null}
        </Svg>
    );
}

/** Город из юридического адреса: «445028, Самарская обл., г. Тольятти, …» → «г. Тольятти». */
function cityFromAddress(address?: string): string | undefined {
    if (!address) return undefined;
    const match = /(?:^|,\s*)(?:г\.?|город)\s*([А-ЯЁ][а-яё-]+)/.exec(address);
    return match ? `г. ${match[1]}` : undefined;
}

export async function generateInvoicePDF(data: InvoiceData): Promise<Buffer> {
    ensureFonts();
    const doc = React.createElement(InvoicePDF, { data });
    const instance = pdf(doc as any);
    const blob = await instance.toBlob();
    const arrayBuffer = await blob.arrayBuffer();
    return Buffer.from(arrayBuffer);
}
