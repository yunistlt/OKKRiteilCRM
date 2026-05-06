import React from 'react';
import {
    Document,
    Page,
    Text,
    View,
    StyleSheet,
    pdf,
    Font,
} from '@react-pdf/renderer';

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
        fontFamily: 'Helvetica',
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
    companyName: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: '#0f172a' },
    companyTagline: { fontSize: 9, color: '#64748b', marginTop: 2 },
    headerRight: { alignItems: 'flex-end' },
    docLabel: { fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 },
    docDate: { fontSize: 9, color: '#64748b', marginTop: 2 },

    // Заголовок
    titleBlock: { marginBottom: 20 },
    title: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: '#0f172a', marginBottom: 6 },
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
    tableHeaderText: { fontSize: 8, color: '#ffffff', fontFamily: 'Helvetica-Bold', textTransform: 'uppercase' },
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
    grandTotalLabel: { fontSize: 10, color: '#ffffff', fontFamily: 'Helvetica-Bold' },
    grandTotalValue: { fontSize: 12, color: '#10b981', fontFamily: 'Helvetica-Bold' },

    // Условия
    conditions: {
        marginBottom: 24,
        padding: 12,
        backgroundColor: '#f8fafc',
        borderRadius: 6,
    },
    conditionsTitle: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#475569', marginBottom: 6, textTransform: 'uppercase' },
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
    const doc = React.createElement(ProposalPDF, { data });
    const instance = pdf(doc as any);
    const blob = await instance.toBlob();
    const arrayBuffer = await blob.arrayBuffer();
    return Buffer.from(arrayBuffer);
}
