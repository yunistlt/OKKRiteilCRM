/**
 * Разбор разметки в ответах Тамары.
 *
 * Она отвечает разметкой — заголовки, таблицы, выделения, — а показывалось это
 * сырым текстом: строки из палок и звёздочек, по которым нельзя прочитать
 * таблицу из пяти строк. Читать такое владелец не станет, а значит и числа, ради
 * которых всё делалось, до него не дойдут.
 *
 * Разбор отделён от отрисовки намеренно: это чистая функция, её можно проверить
 * тестом без браузера и React. Компонент (app/shtab/Rich.tsx) только раскладывает
 * готовые блоки по разметке.
 *
 * Библиотеку Markdown не берём: нужен разбор пяти конструкций, которые реально
 * встречаются в её ответах, а не поддержка всего формата.
 */

export type InlineNode =
    | { kind: 'text'; text: string }
    | { kind: 'bold'; text: string }
    | { kind: 'code'; text: string }
    | { kind: 'link'; text: string; href: string };

export type Block =
    | { kind: 'paragraph'; content: InlineNode[] }
    | { kind: 'heading'; level: number; content: InlineNode[] }
    | { kind: 'rule' }
    | { kind: 'pre'; text: string }
    | { kind: 'list'; items: Array<{ marker: string; content: InlineNode[] }> }
    | {
          kind: 'table';
          head: InlineNode[][];
          rows: InlineNode[][][];
          /** Выравнивание по столбцам: правое ставится двоеточием в разделителе. */
          align: Array<'left' | 'right'>;
      }
    | { kind: 'chart'; title?: string; unit?: string; data: Array<{ label: string; value: number }> };

/** Жирный, `код` и ссылки внутри строки. */
export function parseInline(text: string): InlineNode[] {
    const out: InlineNode[] = [];
    // Все три вида разметки разбираются за один проход: отдельными проходами
    // «**сумма `x`**» разбиралось наполовину.
    const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
    let last = 0;
    let m: RegExpExecArray | null;

    while ((m = re.exec(text)) !== null) {
        if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
        const piece = m[0];

        if (piece.startsWith('**')) {
            out.push({ kind: 'bold', text: piece.slice(2, -2) });
        } else if (piece.startsWith('`')) {
            out.push({ kind: 'code', text: piece.slice(1, -1) });
        } else {
            out.push({
                kind: 'link',
                text: piece.slice(1, piece.indexOf(']')),
                href: piece.slice(piece.indexOf('(') + 1, -1),
            });
        }
        last = m.index + piece.length;
    }
    if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
    return out;
}

/** Строка таблицы: «| a | b |» → ['a','b']. */
function cells(line: string): string[] {
    return line
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((c) => c.trim());
}

const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
/** Разделитель шапки: |---|---:| */
const isTableDivider = (line: string) => /^\s*\|[\s:|-]+\|\s*$/.test(line) && line.includes('-');

export function parseRich(source: string): Block[] {
    const lines = String(source ?? '').split('\n');
    const blocks: Block[] = [];
    let paragraph: string[] = [];

    const flush = () => {
        if (paragraph.length === 0) return;
        blocks.push({ kind: 'paragraph', content: parseInline(paragraph.join('\n')) });
        paragraph = [];
    };

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];

        // Блок кода. Особый случай — ```chart: внутри описание графика, и
        // показывать его исходником бессмысленно.
        if (/^\s*```/.test(line)) {
            flush();
            const lang = line.replace(/```/, '').trim().toLowerCase();
            const body: string[] = [];
            i += 1;
            while (i < lines.length && !/^\s*```/.test(lines[i])) {
                body.push(lines[i]);
                i += 1;
            }
            const text = body.join('\n');

            if (lang === 'chart') {
                try {
                    const spec = JSON.parse(text);
                    const data = (spec?.data ?? [])
                        .map((d: any) => ({ label: String(d?.label ?? ''), value: Number(d?.value) }))
                        .filter((d: any) => Number.isFinite(d.value));
                    if (data.length > 0) {
                        blocks.push({ kind: 'chart', title: spec?.title, unit: spec?.unit, data });
                        continue;
                    }
                } catch {
                    // Сломанный график показываем исходником: пропав молча, он
                    // оставит владельца в уверенности, что данных не было.
                }
            }
            blocks.push({ kind: 'pre', text });
            continue;
        }

        // Таблица.
        if (isTableRow(line) && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
            flush();
            const head = cells(line).map(parseInline);
            const align = cells(lines[i + 1]).map((c) => (c.endsWith(':') ? 'right' : 'left')) as Array<'left' | 'right'>;
            i += 2;
            const rows: InlineNode[][][] = [];
            while (i < lines.length && isTableRow(lines[i])) {
                rows.push(cells(lines[i]).map(parseInline));
                i += 1;
            }
            i -= 1;
            blocks.push({ kind: 'table', head, rows, align });
            continue;
        }

        const heading = /^(#{1,4})\s+(.*)$/.exec(line);
        if (heading) {
            flush();
            blocks.push({ kind: 'heading', level: heading[1].length, content: parseInline(heading[2]) });
            continue;
        }

        if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
            flush();
            blocks.push({ kind: 'rule' });
            continue;
        }

        // Список — маркированный и нумерованный.
        if (/^\s*[-—•]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
            flush();
            const items: Array<{ marker: string; content: InlineNode[] }> = [];
            let j = i;
            while (j < lines.length) {
                const b = /^\s*[-—•]\s+(.*)$/.exec(lines[j]);
                const n = /^\s*(\d+)[.)]\s+(.*)$/.exec(lines[j]);
                if (b) items.push({ marker: '—', content: parseInline(b[1]) });
                else if (n) items.push({ marker: `${n[1]}.`, content: parseInline(n[2]) });
                else break;
                j += 1;
            }
            i = j - 1;
            blocks.push({ kind: 'list', items });
            continue;
        }

        if (line.trim() === '') {
            flush();
            continue;
        }
        paragraph.push(line);
    }
    flush();

    return blocks;
}

/** Плоский текст блоков — для проверок и для копирования. */
export function inlineText(nodes: InlineNode[]): string {
    return nodes.map((n) => n.text).join('');
}
