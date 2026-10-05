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
    Image,
} from '@react-pdf/renderer';
import path from 'path';
import { BRAND, LOGO_DATA_URL } from '@/lib/brand';

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
    /** Цена до скидки и сумма скидки по строке — колонка «Скидка» в КП. */
    initial_price?: number;
    discount?: number;
    /** Фото товара с его карточки на сайте. */
    image?: string | null;
}

export interface ProposalData {
    title: string;
    intro?: string;
    items: ProposalItem[];
    discount_pct: number;
    discount_amount?: number;
    shipping_note?: string | null;
    seller_phone?: string | null;
    seller_email?: string | null;
    seller_site?: string | null;
    valid_until?: string; // ISO date
    client_name?: string;
    client_company?: string;
    /**
     * Дальше — то же, что уже показывает счёт. КП без реквизитов продавца,
     * НДС, сроков, доставки и подписей клиент не принимает к рассмотрению
     * (замечания Евгении 05.10.2026).
     */
    vat_pct?: number;
    seller_name?: string;
    seller_inn?: string;
    seller_kpp?: string;
    seller_ogrn?: string;
    seller_bank?: string;
    seller_bik?: string;
    seller_ks?: string;
    seller_rs?: string;
    seller_address?: string;
    seller_full_name?: string | null;
    seller_seal_place?: string | null;
    seller_has_seal?: boolean;
    seal_image?: string | null;
    signature_image?: string | null;
    signer_name?: string | null;
    signer_title?: string | null;
    manager_name?: string | null;
    production_days?: number | null;
    /** Срок словами: «30 календарных дней». */
    production_term?: string | null;
    shipping_terms?: string | null;
    /** Сколько дней действительно предложение. */
    valid_days?: number | null;
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
    const subtotal = data.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const discountAmt = data.items.reduce((sum, item) => sum + Number(item.discount || 0), 0)
        || Math.round(subtotal * ((data.discount_pct || 0) / 100));
    const total = data.items.reduce((sum, item) => sum + Number(item.discount || 0), 0) > 0
        ? subtotal
        : subtotal - discountAmt;
    const vatPct = Number(data.vat_pct ?? 0);
    const vatAmt = vatPct > 0 ? Math.round(total * (vatPct / 100) / (1 + vatPct / 100)) : 0;

    const today = new Date().toLocaleDateString('ru-RU');
    // Срок действия: сколько дней сказал менеджер в заказе. Клиент должен
    // видеть дату, а не считать её сам.
    const validDays = Number(data.valid_days || 0);
    const validUntil = data.valid_until
        ? new Date(data.valid_until).toLocaleDateString('ru-RU')
        : validDays > 0
            ? new Date(Date.now() + validDays * 24 * 60 * 60 * 1000).toLocaleDateString('ru-RU')
            : null;

    const seller = {
        name: data.seller_name || 'ООО «ЗМК»',
        inn: data.seller_inn || '—',
        kpp: data.seller_kpp || '—',
        bank: data.seller_bank || '—',
        bik: data.seller_bik || '—',
        ks: data.seller_ks || '—',
        rs: data.seller_rs || '—',
        address: data.seller_address || '—',
    };

    return (
        <Document>
            <Page size="A4" style={invStyles.page}>
                <View style={invStyles.topBorder} />
                <Image src={LOGO_DATA_URL} style={invStyles.logo} />

                {/* Шапка: кто предлагает. Без реквизитов продавца КП не примут. */}
                <View style={invStyles.headerRow}>
                    <View style={invStyles.sellerBlock}>
                        <Text style={invStyles.lg}>{data.title}</Text>
                        <Text style={[invStyles.sm, { marginBottom: 4 }]}>от {today}</Text>
                        <Text style={[invStyles.sm, invStyles.bold]}>{seller.name}</Text>
                        <Text style={invStyles.sm}>
                            ИНН: {seller.inn}  КПП: {seller.kpp}{data.seller_ogrn ? `  ОГРН: ${data.seller_ogrn}` : ''}
                        </Text>
                        <Text style={invStyles.sm}>{seller.address}</Text>
                        {/* Контакты компании: счёт должен выглядеть документом,
                            а не запиской (Лена Парфёнова 05.10.2026). */}
                        {(data.seller_phone || data.seller_email || data.seller_site) && (
                            <Text style={invStyles.sm}>
                                {[data.seller_phone, data.seller_email, data.seller_site].filter(Boolean).join(' · ')}
                            </Text>
                        )}
                        <Text style={invStyles.sm}>Р/с {seller.rs}  К/с {seller.ks}  БИК {seller.bik}</Text>
                        <Text style={invStyles.sm}>Банк: {seller.bank}</Text>
                    </View>
                    <View style={invStyles.invoiceMeta}>
                        <Text style={[invStyles.sm, { marginBottom: 2 }]}>Дата: {today}</Text>
                        {validUntil && (
                            <Text style={[invStyles.sm, { color: '#ef4444' }]}>Действует до: {validUntil}</Text>
                        )}
                        <Text style={[invStyles.sm, { marginTop: 8 }]}>zmktlt.ru</Text>
                    </View>
                </View>

                {/* Кому */}
                {(data.client_company || data.client_name) && (
                    <View style={invStyles.payerBox}>
                        <Text style={invStyles.payerTitle}>Для кого</Text>
                        {data.client_company && (
                            <View style={invStyles.payerRow}>
                                <Text style={invStyles.payerLabel}>Организация</Text>
                                <Text style={[invStyles.payerValue, invStyles.bold]}>{data.client_company}</Text>
                            </View>
                        )}
                        {data.client_name && (
                            <View style={invStyles.payerRow}>
                                <Text style={invStyles.payerLabel}>Контакт</Text>
                                <Text style={invStyles.payerValue}>{data.client_name}</Text>
                            </View>
                        )}
                    </View>
                )}

                {data.intro ? <Text style={[invStyles.sm, { marginBottom: 6 }]}>{data.intro}</Text> : null}

                {/* Позиции: с фото товара и колонкой скидки, как в прежнем КП. */}
                <View style={invStyles.tblHeader}>
                    <Text style={[invStyles.tblHeaderText, invStyles.cNum]}>№</Text>
                    <Text style={[invStyles.tblHeaderText, { width: 54 }]}>Фото</Text>
                    <Text style={[invStyles.tblHeaderText, invStyles.cName]}>Наименование</Text>
                    <Text style={[invStyles.tblHeaderText, invStyles.cQty]}>Кол-во</Text>
                    <Text style={[invStyles.tblHeaderText, invStyles.cPrice]}>Цена, ₽</Text>
                    <Text style={[invStyles.tblHeaderText, invStyles.cTotal]}>Сумма, ₽</Text>
                    <Text style={[invStyles.tblHeaderText, invStyles.cTotal]}>Скидка, ₽</Text>
                </View>
                {data.items.map((item, idx) => (
                    <View key={idx} style={[invStyles.tblRow, idx % 2 === 1 ? invStyles.tblAlt : {}]} wrap={false}>
                        <Text style={[invStyles.cell, invStyles.cNum]}>{idx + 1}</Text>
                        <View style={{ width: 54 }}>
                            {item.image ? (
                                <Image src={item.image} style={{ width: 48, height: 48, objectFit: 'contain' }} />
                            ) : null}
                        </View>
                        <View style={invStyles.cName}>
                            <Text style={invStyles.cell}>{item.name}</Text>
                            {item.description && <Text style={invStyles.cellGray}>{item.description}</Text>}
                        </View>
                        <Text style={[invStyles.cell, invStyles.cQty]}>{item.quantity} {item.unit || 'шт.'}</Text>
                        <Text style={[invStyles.cell, invStyles.cPrice]}>{formatMoney(item.price)}</Text>
                        <Text style={[invStyles.cell, invStyles.cTotal]}>{formatMoney(item.price * item.quantity)}</Text>
                        <Text style={[invStyles.cell, invStyles.cTotal]}>
                            {item.discount ? formatMoney(item.discount) : '—'}
                        </Text>
                    </View>
                ))}

                {/* Итоги */}
                <View style={invStyles.totals}>
                    {discountAmt > 0 && (
                        <View style={invStyles.totRow}>
                            <Text style={invStyles.totLabel}>Сумма скидки</Text>
                            <Text style={[invStyles.totVal, { color: '#ef4444' }]}>{formatMoney(discountAmt)}</Text>
                        </View>
                    )}
                    {vatPct > 0 && (
                        <View style={invStyles.totRow}>
                            <Text style={invStyles.totLabel}>В том числе НДС {vatPct}%</Text>
                            <Text style={invStyles.totVal}>{formatMoney(vatAmt)}</Text>
                        </View>
                    )}
                    <View style={invStyles.grandRow}>
                        <Text style={invStyles.grandLabel}>Итого</Text>
                        <Text style={invStyles.grandVal}>{formatMoney(total)}</Text>
                    </View>
                </View>

                {/* Сроки и получение — те же, что в счёте. */}
                {data.production_term || data.production_days ? (
                    <Text style={[invStyles.sm, { marginBottom: 4 }]}>
                        Срок изготовления: {data.production_term || `${data.production_days} дн.`}
                    </Text>
                ) : null}
                {data.shipping_terms ? (
                    <Text style={[invStyles.sm, { marginBottom: 4 }]}>
                        Условия получения: {data.shipping_terms}
                    </Text>
                ) : null}
                <Text style={[invStyles.sm, { marginBottom: 16 }]}>
                    {validDays > 0
                        ? `Указанная стоимость действительна в течение ${validDays} дн.${validUntil ? ` — до ${validUntil}` : ''}`
                        : 'Срок действия предложения уточняйте у менеджера'}
                </Text>

                {/* Подписи и печать */}
                <View style={invStyles.signBlock}>
                    <View style={invStyles.signCol}>
                        <Text style={invStyles.signLabel}>{data.signer_title || 'Руководитель'}</Text>
                        {data.signature_image ? (
                            <Image src={data.signature_image} style={{ width: 110, height: 28, objectFit: 'contain' }} />
                        ) : null}
                        <View style={invStyles.signLine} />
                        <Text style={invStyles.signName}>{data.signer_name || '____________________'}</Text>
                    </View>
                    <View style={invStyles.signCol}>
                        <Text style={invStyles.signLabel}>Менеджер</Text>
                        <View style={invStyles.signLine} />
                        <Text style={invStyles.signName}>{data.manager_name || '____________________'}</Text>
                    </View>
                    {data.seal_image ? (
                        <View style={invStyles.sealCol}>
                            <Image src={data.seal_image} style={{ width: 110, height: 110, objectFit: 'contain' }} />
                        </View>
                    ) : data.seller_has_seal === false ? null : (
                        <View style={invStyles.sealCol}>
                            <OrganizationSeal
                                fullName={data.seller_full_name || seller.name}
                                shortName={sealShortName(seller.name)}
                                inn={seller.inn}
                                kpp={seller.kpp}
                                ogrn={data.seller_ogrn}
                                place={data.seller_seal_place || sealPlace(seller.address)}
                            />
                        </View>
                    )}
                </View>

                <View style={invStyles.footer} fixed>
                    <Text style={invStyles.footerText}>{seller.name} • zmktlt.ru</Text>
                    <Text style={invStyles.footerText}>{today}</Text>
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
    /** Разовая скидка суммой, если её задали рублями, а не процентом. */
    discount_amount?: number;
    /** Контакты продавца в шапке документа. */
    seller_phone?: string | null;
    seller_email?: string | null;
    seller_site?: string | null;
    /** Что сказать про отгрузку: габариты, состав, особенности. */
    shipping_note?: string | null;
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
    /** Полное наименование продавца — по кольцу печати. */
    seller_full_name?: string | null;
    /** Страна, регион и город — по нижней дуге печати. */
    seller_seal_place?: string | null;
    /** Ставить ли печать: ИП работает без печати, только подпись. */
    seller_has_seal?: boolean;
    /** Настоящий оттиск печати (data URI). Если есть — ставим его, а не рисунок. */
    seal_image?: string | null;
    /** Подпись руководителя (data URI). */
    signature_image?: string | null;
    /** Менеджер заказа — вторая подпись в счёте. */
    manager_name?: string | null;
    /** Срок изготовления в днях — из заказа. */
    production_term?: string | null;
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
    // Фирменная полоса — синяя, как шапка сайта (брендирование документов,
    // решение владельца 05.10.2026).
    topBorder: { height: 4, backgroundColor: BRAND.blue, marginBottom: 12 },
    logo: { width: 150, height: 47, objectFit: 'contain', marginBottom: 10 },
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
    signLabel: { fontSize: 8, color: '#94a3b8', marginBottom: 6 },
    signLine: { borderBottomWidth: 1, borderBottomColor: '#94a3b8', marginBottom: 4 },
    signName: { fontSize: 8, color: '#475569' },
    footer: { position: 'absolute', bottom: 28, left: 40, right: 40, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 8, flexDirection: 'row', justifyContent: 'space-between' },
    footerText: { fontSize: 7.5, color: '#94a3b8' },
});

function InvoicePDF({ data }: { data: InvoiceData }) {
    const subtotal = data.items.reduce((s, i) => s + i.price * i.quantity, 0);
    // Скидку задают и рублями, и процентом — считаем то, что задали.
    const discountAmt = Number(data.discount_amount) > 0
        ? Number(data.discount_amount)
        : Math.round(subtotal * ((data.discount_pct || 0) / 100));
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
                {/* Логотип ЗМК: документ должен быть узнаваем с первого взгляда. */}
                <Image src={LOGO_DATA_URL} style={invStyles.logo} />

                {/* Шапка: продавец + мета */}
                <View style={invStyles.headerRow}>
                    <View style={invStyles.sellerBlock}>
                        <Text style={invStyles.lg}>Счёт на оплату № {data.invoice_number}</Text>
                        <Text style={[invStyles.sm, { marginBottom: 4 }]}>от {today}</Text>
                        <Text style={[invStyles.sm, invStyles.bold]}>{seller.name}</Text>
                        <Text style={invStyles.sm}>ИНН: {seller.inn}  КПП: {seller.kpp}</Text>
                        <Text style={invStyles.sm}>{seller.address}</Text>
                        {/* Контакты компании: без них счёт выглядит запиской, а
                            не документом (Лена Парфёнова 05.10.2026). */}
                        {(data.seller_phone || data.seller_email || data.seller_site) && (
                            <Text style={invStyles.sm}>
                                {[data.seller_phone, data.seller_email, data.seller_site].filter(Boolean).join(' · ')}
                            </Text>
                        )}
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
                    {discountAmt > 0 && (
                        <View style={invStyles.totRow}>
                            <Text style={invStyles.totLabel}>
                                Скидка{data.discount_pct > 0 ? ` ${data.discount_pct}%` : ''}
                            </Text>
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
                {data.production_term || data.production_days ? (
                    <Text style={[invStyles.sm, { marginBottom: 4 }]}>
                        Срок изготовления: {data.production_term || `${data.production_days} дн.`}
                    </Text>
                ) : null}
                {data.shipping_terms ? (
                    <Text style={[invStyles.sm, { marginBottom: data.shipping_note ? 4 : 16 }]}>
                        Условия получения: {data.shipping_terms}
                    </Text>
                ) : null}
                {/* Габариты и состав — менеджер пишет их в заказе; раньше их
                    приходилось вписывать в адрес получения (Лена 05.10.2026). */}
                {data.shipping_note ? (
                    <Text style={[invStyles.sm, { marginBottom: 16 }]}>
                        По отгрузке: {data.shipping_note}
                    </Text>
                ) : null}

                {/* Подпись */}
                <View style={invStyles.signBlock}>
                    <View style={invStyles.signCol}>
                        <Text style={invStyles.signLabel}>{data.signer_title || 'Руководитель'}</Text>
                        {/* Подпись — картинкой над линией, если загружена. */}
                        {data.signature_image ? (
                            <Image src={data.signature_image} style={{ width: 110, height: 28, objectFit: 'contain' }} />
                        ) : null}
                        <View style={invStyles.signLine} />
                        <Text style={invStyles.signName}>{data.signer_name || '____________________'}</Text>
                    </View>
                    <View style={invStyles.signCol}>
                        <Text style={invStyles.signLabel}>Менеджер</Text>
                        <View style={invStyles.signLine} />
                        <Text style={invStyles.signName}>{data.manager_name || '____________________'}</Text>
                    </View>
                    {/* Печать организации — своя на каждое юрлицо, рисуется по
                        его реквизитам (решение владельца 02.10.2026). */}
                    {/* Печать: настоящий оттиск, если загружен в настройках
                        юрлица; иначе рисунок по реквизитам. У ИП печати нет
                        вовсе (указание владельца 02.10.2026). */}
                    {data.seal_image ? (
                        <View style={invStyles.sealCol}>
                            <Image src={data.seal_image} style={{ width: 110, height: 110, objectFit: 'contain' }} />
                        </View>
                    ) : data.seller_has_seal === false ? null : (
                        <View style={invStyles.sealCol}>
                            <OrganizationSeal
                                fullName={data.seller_full_name || seller.name}
                                shortName={sealShortName(seller.name)}
                                inn={seller.inn}
                                kpp={seller.kpp}
                                ogrn={data.seller_ogrn}
                                place={data.seller_seal_place || sealPlace(seller.address)}
                            />
                        </View>
                    )}
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
 * Печать организации — своя на каждое юрлицо, рисуется по её реквизитам.
 *
 * Решение владельца 02.10.2026: печати делаем сами. Образец — настоящая печать
 * ЗМК: по внешнему кольцу полное наименование, по нижней дуге — страна, область
 * и город, в середине короткое имя крупно, под ним ОГРН и ИНН/КПП.
 *
 * Две вещи, на которых первый вариант выглядел неправильно и обе здесь учтены:
 * буквы нижней дуги надо доворачивать на 180°, иначе текст внизу стоит вверх
 * ногами; и шаг между буквами считается от длины строки, иначе короткое
 * название растягивается на весь круг, а длинное наезжает само на себя.
 *
 * Это печать для документов, а не гербовая: она удостоверяет счёт, подпись
 * руководителя рядом остаётся за человеком.
 */
function OrganizationSeal({ fullName, shortName, inn, kpp, ogrn, place }: {
    fullName: string;
    shortName?: string;
    inn?: string;
    kpp?: string;
    ogrn?: string;
    /** «Российская Федерация, Самарская область, Тольятти». */
    place?: string;
}) {
    const size = 150;
    const center = size / 2;
    const ink = '#2347c5';

    /**
     * Текст по дуге. `startDeg` — где начинается (0 — верх, по часовой),
     * `flip` — для нижней дуги: буквы доворачиваются, чтобы читались снизу.
     */
    const arc = (text: string, radius: number, fontSize: number, centerDeg: number, flip: boolean, maxSweep = 160) => {
        const letters = Array.from(text);
        if (!letters.length) return null;

        // Ширина буквы в градусах — от её физической ширины на этом радиусе.
        // Если строка в отведённый сектор не влезает, уменьшаем шрифт: иначе
        // буквы идут по кругу больше оборота и наезжают друг на друга (так и
        // вышло в первом варианте — владелец это увидел 02.10.2026).
        let size = fontSize;
        let stepDeg = ((size * 0.62) / (2 * Math.PI * radius)) * 360;
        while (stepDeg * letters.length > maxSweep && size > 2.2) {
            size -= 0.2;
            stepDeg = ((size * 0.62) / (2 * Math.PI * radius)) * 360;
        }
        const fit = size;

        const sweep = stepDeg * letters.length;
        const first = centerDeg - sweep / 2 + stepDeg / 2;

        return letters.map((letter, index) => {
            const angle = first + stepDeg * index;
            const y = flip ? center + radius : center - radius;
            const spin = flip ? 180 : 0;

            return (
                <G key={`${radius}-${centerDeg}-${index}`} transform={`rotate(${angle} ${center} ${center})`}>
                    <G transform={`rotate(${spin} ${center} ${y})`}>
                        <Text
                            x={center}
                            y={y + fit * 0.35}
                            style={{ fontFamily: FONT_FAMILY, fontSize: fit, fill: ink }}
                            textAnchor="middle"
                        >
                            {letter}
                        </Text>
                    </G>
                </G>
            );
        });
    };

    const name = fullName.toUpperCase();
    const nameSize = name.length > 70 ? 4.2 : name.length > 50 ? 5 : 6;
    const placeText = (place || '').toUpperCase();

    return (
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            {/* Кольца: толстое внешнее и два тонких, как на настоящей печати. */}
            <Circle cx={center} cy={center} r={72} stroke={ink} strokeWidth={2.6} fill="none" />
            <Circle cx={center} cy={center} r={65} stroke={ink} strokeWidth={0.7} fill="none" />
            <Circle cx={center} cy={center} r={40} stroke={ink} strokeWidth={0.7} fill="none" />

            {/* Наименование — сверху, место — снизу. */}
            {arc(name, 58, nameSize, 0, false, 230)}
            {placeText ? arc(placeText, 50, 4.4, 180, true, 150) : null}

            {/* Середина: короткое имя крупно, под ним реквизиты. */}
            <Text
                x={center}
                y={center + 1}
                style={{ fontFamily: FONT_FAMILY, fontSize: 14, fill: ink }}
                textAnchor="middle"
            >
                {(shortName || '').toUpperCase()}
            </Text>
            {ogrn ? (
                <Text x={center} y={center + 12} style={{ fontFamily: FONT_FAMILY, fontSize: 4.4, fill: ink }} textAnchor="middle">
                    ОГРН {ogrn}
                </Text>
            ) : null}
            {inn ? (
                <Text x={center} y={center + 19} style={{ fontFamily: FONT_FAMILY, fontSize: 4.4, fill: ink }} textAnchor="middle">
                    ИНН {inn}{kpp ? `  КПП ${kpp}` : ''}
                </Text>
            ) : null}
            <Text x={center} y={center - 12} style={{ fontFamily: FONT_FAMILY, fontSize: 4.6, fill: ink }} textAnchor="middle">
                ДЛЯ ДОКУМЕНТОВ
            </Text>
        </Svg>
    );
}

/**
 * Место на печати из юридического адреса: «445028, Самарская обл.,
 * г. Тольятти, ул. …» → «Российская Федерация, Самарская область, Тольятти».
 */
export function sealPlace(address?: string): string | undefined {
    if (!address) return undefined;

    const region = /([А-ЯЁ][а-яё-]+(?:ая|ий|ой))\s*(?:обл\.?|область|край|респ\.?|республика)/i.exec(address);
    const city = /(?:^|,\s*)(?:г\.?|город)\s*([А-ЯЁ][а-яё-]+)/.exec(address);

    const parts = ['Российская Федерация'];
    if (region) parts.push(`${region[1]} область`);
    if (city) parts.push(city[1]);
    return parts.join(', ');
}

/** Короткое имя для середины печати: «ООО "ПОБТ"» → «ПОБТ». */
export function sealShortName(name?: string): string {
    if (!name) return '';
    const quoted = /[«"]([^»"]+)[»"]/.exec(name);
    if (quoted) return quoted[1];
    return name.replace(/^(ООО|АО|НАО|ЗАО|ПАО|ИП)\s*/i, '').trim();
}

export async function generateInvoicePDF(data: InvoiceData): Promise<Buffer> {
    ensureFonts();
    const doc = React.createElement(InvoicePDF, { data });
    const instance = pdf(doc as any);
    const blob = await instance.toBlob();
    const arrayBuffer = await blob.arrayBuffer();
    return Buffer.from(arrayBuffer);
}
