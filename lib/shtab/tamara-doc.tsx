import React from 'react';
import path from 'path';
import { Document, Font, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer';
import { parseRich, type Block, type InlineNode } from '@/lib/shtab/rich-parse';

/**
 * Документ от Тамары: её ответ, собранный в PDF.
 *
 * На просьбу «сделай это красивым PDF» она честно отвечала, что файлов делать
 * не умеет, и предлагала скопировать текст в Word. Теперь умеет — из той же
 * разметки, которой отвечает в разговоре: таблицы остаются таблицами, заголовки
 * заголовками.
 *
 * ШРИФТ. Встроенный в генератор Helvetica кириллицы не содержит, и кодировка у
 * него WinAnsi: русский текст вышел бы набором пустых мест, причём молча — файл
 * собрался бы, открылся и оказался нечитаемым. Поэтому PT Sans лежит в
 * репозитории и регистрируется явно; он же встраивается в файл, так что документ
 * читается на любой машине.
 */

let fontsReady = false;

function ensureFonts() {
    if (fontsReady) return;
    // process.cwd() на Vercel — корень проекта; файлы лежат в public и едут
    // вместе со сборкой.
    const dir = path.join(process.cwd(), 'public', 'fonts');
    Font.register({
        family: 'PT Sans',
        fonts: [
            { src: path.join(dir, 'PTSans-Regular.ttf') },
            { src: path.join(dir, 'PTSans-Bold.ttf'), fontWeight: 700 },
        ],
    });
    // Переносы слов генератор расставляет сам и делает это по-английски: русские
    // слова он рвёт как попало. Отключаем — лучше неровный правый край.
    Font.registerHyphenationCallback((word) => [word]);
    fontsReady = true;
}

const S = StyleSheet.create({
    page: {
        fontFamily: 'PT Sans',
        fontSize: 10.5,
        lineHeight: 1.5,
        paddingTop: 48,
        paddingBottom: 56,
        paddingHorizontal: 48,
        color: '#1b1b1b',
        backgroundColor: '#ffffff',
    },
    title: { fontSize: 20, fontWeight: 700, marginBottom: 4 },
    subtitle: { fontSize: 9.5, color: '#767676', marginBottom: 20 },
    // Линия под шапкой — единственное украшение: документ управленческий, и
    // рамки с заливками в нём только мешают читать.
    titleRule: { borderBottomWidth: 2, borderBottomColor: '#1b1b1b', marginBottom: 20 },

    h1: { fontSize: 14, fontWeight: 700, marginTop: 16, marginBottom: 6 },
    h2: { fontSize: 12.5, fontWeight: 700, marginTop: 14, marginBottom: 5 },
    h3: { fontSize: 11, fontWeight: 700, marginTop: 12, marginBottom: 4, color: '#3f3f3f' },

    p: { marginBottom: 7 },
    rule: { borderBottomWidth: 1, borderBottomColor: '#dcdcdc', marginVertical: 12 },

    listRow: { flexDirection: 'row', marginBottom: 3 },
    listMarker: { width: 16, color: '#767676' },

    pre: {
        // Тем же шрифтом, что и всё: моноширинный встроенный кириллицы не знает.
        fontSize: 9,
        backgroundColor: '#f4f4f4',
        borderWidth: 1,
        borderColor: '#e2e2e2',
        padding: 8,
        marginVertical: 8,
    },

    table: { marginVertical: 10, borderWidth: 1, borderColor: '#d8d8d8' },
    tr: { flexDirection: 'row' },
    trAlt: { flexDirection: 'row', backgroundColor: '#f7f7f7' },
    th: {
        backgroundColor: '#1b1b1b',
        color: '#ffffff',
        fontSize: 8.5,
        fontWeight: 700,
        padding: 6,
        textTransform: 'uppercase',
    },
    td: { padding: 6, fontSize: 10, borderTopWidth: 1, borderTopColor: '#e6e6e6' },

    chartRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
    chartLabel: { width: '28%', fontSize: 9.5, color: '#3f3f3f' },
    chartTrack: { flex: 1, height: 10, backgroundColor: '#efefef', borderWidth: 1, borderColor: '#e2e2e2' },
    chartFill: { height: '100%', backgroundColor: '#2b4c7e' },
    chartValue: { width: '18%', textAlign: 'right', fontSize: 9.5 },
    chartTitle: { fontSize: 9, color: '#767676', textTransform: 'uppercase', marginBottom: 6, marginTop: 10 },

    footer: {
        position: 'absolute',
        bottom: 28,
        left: 48,
        right: 48,
        fontSize: 8.5,
        color: '#8a8a8a',
        flexDirection: 'row',
        justifyContent: 'space-between',
        borderTopWidth: 1,
        borderTopColor: '#e6e6e6',
        paddingTop: 6,
    },
});

/** Текст с выделениями: жирное остаётся жирным, код — моноширинным. */
function Inline({ nodes }: { nodes: InlineNode[] }) {
    return (
        <>
            {nodes.map((n, i) => {
                if (n.kind === 'bold') return <Text key={i} style={{ fontWeight: 700 }}>{n.text}</Text>;
                // Код выделяем цветом, а не моноширинным шрифтом: встроенный
                // Courier кириллицы не знает, и русское слово в обратных
                // кавычках стало бы пустым местом — молча, как и всё в PDF.
                if (n.kind === 'code')
                    return (
                        <Text key={i} style={{ color: '#2b4c7e', fontSize: 10 }}>
                            {n.text}
                        </Text>
                    );
                return <Text key={i}>{n.text}</Text>;
            })}
        </>
    );
}

function flat(nodes: InlineNode[]): string {
    return nodes.map((n) => n.text).join('');
}

function Blocks({ blocks }: { blocks: Block[] }) {
    return (
        <>
            {blocks.map((b, i) => {
                if (b.kind === 'heading') {
                    const style = b.level <= 1 ? S.h1 : b.level === 2 ? S.h2 : S.h3;
                    return (
                        <Text key={i} style={style}>
                            {flat(b.content)}
                        </Text>
                    );
                }
                if (b.kind === 'rule') return <View key={i} style={S.rule} />;
                if (b.kind === 'pre')
                    return (
                        <Text key={i} style={S.pre}>
                            {b.text}
                        </Text>
                    );
                if (b.kind === 'list') {
                    return (
                        <View key={i} style={{ marginBottom: 7 }}>
                            {b.items.map((it, ii) => (
                                <View key={ii} style={S.listRow}>
                                    <Text style={S.listMarker}>{it.marker}</Text>
                                    <Text style={{ flex: 1 }}>
                                        <Inline nodes={it.content} />
                                    </Text>
                                </View>
                            ))}
                        </View>
                    );
                }
                if (b.kind === 'chart') {
                    const max = Math.max(...b.data.map((d) => d.value), 0) || 1;
                    return (
                        <View key={i} wrap={false}>
                            {b.title ? <Text style={S.chartTitle}>{b.title}</Text> : null}
                            {b.data.map((d, di) => (
                                <View key={di} style={S.chartRow}>
                                    <Text style={S.chartLabel}>{d.label}</Text>
                                    <View style={S.chartTrack}>
                                        <View style={[S.chartFill, { width: `${Math.max(1, (d.value / max) * 100)}%` }]} />
                                    </View>
                                    <Text style={S.chartValue}>
                                        {Math.round(d.value).toLocaleString('ru-RU')}
                                        {b.unit ? ` ${b.unit}` : ''}
                                    </Text>
                                </View>
                            ))}
                        </View>
                    );
                }
                if (b.kind === 'table') {
                    const width = `${100 / Math.max(1, b.head.length)}%`;
                    return (
                        <View key={i} style={S.table}>
                            {/* Шапка повторяется на каждой странице: таблица на
                                две страницы без неё нечитаема. */}
                            <View style={S.tr} fixed>
                                {b.head.map((h, hi) => (
                                    <Text
                                        key={hi}
                                        style={[S.th, { width, textAlign: b.align[hi] === 'right' ? 'right' : 'left' }]}
                                    >
                                        {flat(h)}
                                    </Text>
                                ))}
                            </View>
                            {b.rows.map((r, ri) => (
                                <View key={ri} style={ri % 2 ? S.trAlt : S.tr} wrap={false}>
                                    {r.map((c, ci) => (
                                        <Text
                                            key={ci}
                                            style={[
                                                S.td,
                                                { width, textAlign: b.align[ci] === 'right' ? 'right' : 'left' },
                                            ]}
                                        >
                                            <Inline nodes={c} />
                                        </Text>
                                    ))}
                                </View>
                            ))}
                        </View>
                    );
                }
                return (
                    <Text key={i} style={S.p}>
                        <Inline nodes={b.content} />
                    </Text>
                );
            })}
        </>
    );
}

export type DocInput = {
    title: string;
    /** Подзаголовок: обычно период или пояснение, о чём документ. */
    subtitle?: string;
    /** Тело — та же разметка, которой она отвечает в разговоре. */
    body: string;
};

/** Собрать PDF. Возвращает готовые байты — их отдают в ответе или шлют в телеграм. */
export async function buildPdf(input: DocInput): Promise<Buffer> {
    ensureFonts();
    const blocks = parseRich(input.body);
    const today = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

    const doc = (
        <Document title={input.title} author="Тамара, наставник">
            <Page size="A4" style={S.page}>
                <Text style={S.title}>{input.title}</Text>
                {input.subtitle ? <Text style={S.subtitle}>{input.subtitle}</Text> : null}
                <View style={S.titleRule} />

                <Blocks blocks={blocks} />

                {/* Кто и когда собрал — на каждой странице: документ уносят из
                    разговора, и через неделю его происхождение забывается. */}
                <View style={S.footer} fixed>
                    <Text>Тамара, наставник · Центр управления</Text>
                    <Text render={({ pageNumber, totalPages }) => `${today} · ${pageNumber}/${totalPages}`} />
                </View>
            </Page>
        </Document>
    );

    const stream = await pdf(doc).toBuffer();
    const chunks: Buffer[] = [];
    for await (const chunk of stream as any) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
}
