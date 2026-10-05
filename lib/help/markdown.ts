/**
 * Разметка статей справки в HTML.
 *
 * Своя, короткая: в проекте нет markdown-библиотеки, а тянуть её ради справки
 * незачем — нужны заголовки, списки, таблицы, выделение и код. Любой HTML из
 * текста экранируется: статьи правятся людьми, и чужой разметке здесь не место.
 */

const escape = (text: string): string =>
    text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

/** Жирный, курсив, `код` и ссылки — внутри строки. */
function inline(text: string): string {
    return escape(text)
        .replace(/`([^`]+)`/g, '<code class="bg-gray-100 px-1 py-0.5 text-[0.95em]">$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" class="text-blue-700 hover:underline">$1</a>');
}

export function renderHelpMarkdown(markdown: string): string {
    const lines = String(markdown ?? '').replace(/\r\n/g, '\n').split('\n');
    const out: string[] = [];

    let list: 'ul' | 'ol' | null = null;
    let table: string[][] | null = null;
    let paragraph: string[] = [];

    const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
    const closeParagraph = () => {
        if (paragraph.length) {
            out.push(`<p class="my-2 leading-relaxed">${inline(paragraph.join(' '))}</p>`);
            paragraph = [];
        }
    };
    const closeTable = () => {
        if (!table?.length) { table = null; return; }
        const [head, ...body] = table;
        out.push('<table class="my-3 w-full border-collapse text-sm">');
        out.push('<thead><tr>' + head.map((cell) => `<th class="border border-gray-200 bg-gray-50 px-2 py-1 text-left font-semibold">${inline(cell)}</th>`).join('') + '</tr></thead>');
        out.push('<tbody>' + body.map((row) => '<tr>' + row.map((cell) => `<td class="border border-gray-200 px-2 py-1 align-top">${inline(cell)}</td>`).join('') + '</tr>').join('') + '</tbody>');
        out.push('</table>');
        table = null;
    };
    const closeAll = () => { closeParagraph(); closeList(); closeTable(); };

    for (const raw of lines) {
        const line = raw.trimEnd();

        if (!line.trim()) { closeAll(); continue; }

        // Таблица: строки, начинающиеся и заканчивающиеся на «|».
        if (/^\|.*\|$/.test(line.trim())) {
            closeParagraph();
            closeList();
            const cells = line.trim().slice(1, -1).split('|').map((cell) => cell.trim());
            if (cells.every((cell) => /^-{2,}$/.test(cell.replace(/:/g, '')))) continue; // разделитель
            (table ||= []).push(cells);
            continue;
        }
        closeTable();

        const heading = /^(#{1,4})\s+(.*)$/.exec(line);
        if (heading) {
            closeAll();
            const level = heading[1].length;
            const size = level === 1 ? 'text-xl' : level === 2 ? 'text-lg' : 'text-base';
            out.push(`<h${level + 1} class="mt-5 mb-2 ${size} font-semibold text-gray-900">${inline(heading[2])}</h${level + 1}>`);
            continue;
        }

        const bullet = /^[-*]\s+(.*)$/.exec(line.trim());
        if (bullet) {
            closeParagraph();
            if (list !== 'ul') { closeList(); out.push('<ul class="my-2 list-disc space-y-1 pl-5">'); list = 'ul'; }
            out.push(`<li>${inline(bullet[1])}</li>`);
            continue;
        }

        const numbered = /^\d+[.)]\s+(.*)$/.exec(line.trim());
        if (numbered) {
            closeParagraph();
            if (list !== 'ol') { closeList(); out.push('<ol class="my-2 list-decimal space-y-1 pl-5">'); list = 'ol'; }
            out.push(`<li>${inline(numbered[1])}</li>`);
            continue;
        }

        closeList();
        paragraph.push(line.trim());
    }

    closeAll();
    return out.join('\n');
}
