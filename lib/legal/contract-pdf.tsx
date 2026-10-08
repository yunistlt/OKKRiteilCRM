import React from 'react';
import { Document, Page, Text, View, StyleSheet, pdf, Font, Image } from '@react-pdf/renderer';
import path from 'path';

/**
 * Договор файлом.
 *
 * До этого договор жил только текстом в базе: менеджер нажимал «Составить
 * договор», видел замечания ИИ-юрисконсульта — и всё, самого договора не было
 * (вопрос менеджера 08.10.2026: «а где у нас сами договора? где взять файл?»).
 *
 * Шрифт с кириллицей обязателен: стандартный Helvetica русских букв не знает,
 * и 30.09.2026 счёт уже выходил набором кракозябр. PT Sans лежит в
 * public/fonts и покрывает кириллицу.
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
    page: { fontFamily: FONT_FAMILY, fontSize: 10, lineHeight: 1.45, paddingTop: 36, paddingBottom: 66, paddingHorizontal: 44, color: '#111' },
    title: { fontSize: 13, fontWeight: 'bold', marginBottom: 12, textAlign: 'center' },
    heading: { fontSize: 11, fontWeight: 'bold', marginTop: 10, marginBottom: 4 },
    paragraph: { marginBottom: 6, textAlign: 'justify' },
    footer: { position: 'absolute', bottom: 20, left: 44, right: 44, fontSize: 8, color: '#777', textAlign: 'center' },
    signRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 24 },
    signCol: { width: '46%' },
    signLabel: { fontSize: 9, color: '#555', marginBottom: 18 },
    signLine: { borderBottomWidth: 1, borderBottomColor: '#111', marginTop: 2 },
    signName: { fontSize: 9, marginTop: 3 },
    sealWrap: { position: 'relative' },
    /**
     * Постраничная подпись: её ставят на каждом листе, чтобы лист нельзя было
     * подменить (требование владельца 08.10.2026). Высота блока учтена в
     * нижнем поле страницы — иначе текст налезает на подпись.
     */
    pageSign: { position: 'absolute', bottom: 34, left: 44, right: 44, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
    pageSignCol: { width: '45%', flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
    pageSignLabel: { fontSize: 8, color: '#555' },
    pageSignLine: { flexGrow: 1, borderBottomWidth: 0.7, borderBottomColor: '#555', height: 12 },
    seal: { position: 'absolute', left: 60, top: -46, width: 92, height: 92, objectFit: 'contain', opacity: 0.9 },
});

/** Подпись и печать продавца: те же картинки, что на счёте. */
export type ContractSigning = {
    signerName?: string | null;
    signerTitle?: string | null;
    signatureImage?: string | null;
    sealImage?: string | null;
    buyerName?: string | null;
};

/** Строка договора: заголовок раздела или обычный абзац. */
function isHeading(line: string): boolean {
    const text = line.trim();
    if (!text || text.length > 80) return false;
    // «1. ПРЕДМЕТ ДОГОВОРА», «РЕКВИЗИТЫ СТОРОН» — заголовки набраны прописными.
    return text === text.toUpperCase() && /[А-ЯЁ]/.test(text);
}

export async function buildContractPdf(params: {
    title: string;
    bodyText: string;
    signing?: ContractSigning | null;
}): Promise<Buffer> {
    ensureFonts();

    const lines = String(params.bodyText ?? '').split('\n');
    const signing = params.signing ?? null;

    const doc = (
        <Document title={params.title}>
            <Page size="A4" style={styles.page}>
                <Text style={styles.title}>{params.title}</Text>
                {lines.map((line, i) => {
                    const text = line.trim();
                    if (!text) return <View key={i} style={{ height: 5 }} />;
                    return (
                        <Text key={i} style={isHeading(text) ? styles.heading : styles.paragraph}>
                            {text}
                        </Text>
                    );
                })}
                {/* Подпись и печать — требование владельца 08.10.2026: договор
                    уходит клиенту подписанным, как и счёт. Картинки те же, из
                    карточки нашего юрлица; нет картинки — остаётся линия для
                    подписи от руки. Блок не разрывается между страницами:
                    печать на пустом листе выглядит браком. */}
                <View style={styles.signRow} wrap={false}>
                    <View style={styles.signCol}>
                        <Text style={styles.signLabel}>Продавец{signing?.signerTitle ? `, ${signing.signerTitle}` : ''}</Text>
                        <View style={styles.sealWrap}>
                            {signing?.signatureImage ? (
                                <Image src={signing.signatureImage} style={{ width: 110, height: 28, objectFit: 'contain' }} />
                            ) : null}
                            {signing?.sealImage ? <Image src={signing.sealImage} style={styles.seal} /> : null}
                        </View>
                        <View style={styles.signLine} />
                        <Text style={styles.signName}>{signing?.signerName || '____________________'}</Text>
                    </View>
                    <View style={styles.signCol}>
                        <Text style={styles.signLabel}>Покупатель</Text>
                        <View style={{ height: 28 }} />
                        <View style={styles.signLine} />
                        <Text style={styles.signName}>{signing?.buyerName || '____________________'}</Text>
                    </View>
                </View>

                {/* Подпись на КАЖДОЙ странице: лист без подписи можно заменить,
                    поэтому стороны парафируют каждый. Картинка подписи
                    продавца подставляется автоматически, покупатель
                    расписывается от руки. */}
                <View style={styles.pageSign} fixed>
                    <View style={styles.pageSignCol}>
                        <Text style={styles.pageSignLabel}>Продавец</Text>
                        {signing?.signatureImage ? (
                            <Image src={signing.signatureImage} style={{ width: 54, height: 16, objectFit: 'contain' }} />
                        ) : null}
                        <View style={styles.pageSignLine} />
                    </View>
                    <View style={styles.pageSignCol}>
                        <Text style={styles.pageSignLabel}>Покупатель</Text>
                        <View style={styles.pageSignLine} />
                    </View>
                </View>

                <Text
                    style={styles.footer}
                    render={({ pageNumber, totalPages }) => `${pageNumber} из ${totalPages}`}
                    fixed
                />
            </Page>
        </Document>
    );

    const instance = pdf(doc as any);
    const blob = await instance.toBlob();
    return Buffer.from(await blob.arrayBuffer());
}
