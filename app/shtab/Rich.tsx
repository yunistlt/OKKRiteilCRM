'use client';

import React from 'react';
import { parseRich, type Block, type InlineNode } from '@/lib/shtab/rich-parse';
import { formatIntRu } from '@/lib/format';

/**
 * Отрисовка разметки в ответах Тамары.
 *
 * Разбор живёт отдельно (lib/shtab/rich-parse.ts) и покрыт тестами; здесь только
 * раскладка готовых блоков. Чужой HTML в страницу не вставляется — строятся
 * React-элементы, поэтому разметка из ответа модели ничего сломать не может.
 *
 * Стиль — по golds/: таблицы живут по GOLD_UI_TABLES (липкая шапка, чередование
 * строк, подсветка под курсором, ячейки 12/16, без внешней рамки), остальное —
 * по GOLD_DESIGN_UX: плоско, без скруглений и теней, плотно. Числа выводятся
 * через lib/format — разряды у больших чисел это закон, а не оформление.
 */

function Inline({ nodes }: { nodes: InlineNode[] }) {
    return (
        <>
            {nodes.map((n, i) => {
                if (n.kind === 'bold') return <b key={i}>{n.text}</b>;
                if (n.kind === 'code')
                    return (
                        <code className="rich-code" key={i}>
                            {n.text}
                        </code>
                    );
                if (n.kind === 'link') {
                    // Ссылка на документ — не строка текста, а действие: её
                    // ищут глазами, чтобы скачать. Обычная подчёркнутая ссылка
                    // в потоке текста теряется, и владелец пишет «не вижу».
                    const isDoc = /^\/api\/shtab\/doc\//.test(n.href);
                    return (
                        <a
                            className={isDoc ? 'rich-doc' : 'rich-link'}
                            href={n.href}
                            target="_blank"
                            rel="noreferrer"
                            key={i}
                        >
                            {isDoc ? `📄 ${n.text} — открыть PDF` : n.text}
                        </a>
                    );
                }
                return <React.Fragment key={i}>{n.text}</React.Fragment>;
            })}
        </>
    );
}

/**
 * Столбчатый график.
 *
 * Свой SVG-подобный вывод на div'ах, как Sparkline рядом: библиотека ради пяти
 * полосок — лишние полмегабайта в странице, которую открывают с телефона.
 */
function Chart({ block }: { block: Extract<Block, { kind: 'chart' }> }) {
    const max = Math.max(...block.data.map((d) => d.value), 0) || 1;

    return (
        <div className="rich-chart">
            {block.title ? <div className="rich-chart-title">{block.title}</div> : null}
            {block.data.map((d, i) => (
                <div className="rich-bar-row" key={`${d.label}-${i}`}>
                    <div className="rich-bar-label" title={d.label}>
                        {d.label}
                    </div>
                    <div className="rich-bar-track">
                        {/* Ненулевую величину всегда видно хотя бы полоской в
                            процент: иначе «мало» неотличимо от «ничего». */}
                        <div className="rich-bar-fill" style={{ width: `${Math.max(1, (d.value / max) * 100)}%` }} />
                    </div>
                    <div className="rich-bar-value">
                        {formatIntRu(d.value)}
                        {block.unit ? ` ${block.unit}` : ''}
                    </div>
                </div>
            ))}
        </div>
    );
}

export default function Rich({ text }: { text: string }) {
    const blocks = parseRich(text);

    return (
        <div className="rich">
            {blocks.map((b, i) => {
                if (b.kind === 'heading') {
                    return (
                        <div className={`rich-h rich-h${Math.min(b.level, 3)}`} key={i}>
                            <Inline nodes={b.content} />
                        </div>
                    );
                }
                if (b.kind === 'rule') return <hr className="rich-hr" key={i} />;
                if (b.kind === 'pre')
                    return (
                        <pre className="rich-pre" key={i}>
                            {b.text}
                        </pre>
                    );
                if (b.kind === 'chart') return <Chart block={b} key={i} />;
                if (b.kind === 'list') {
                    return (
                        <div className="rich-list" key={i}>
                            {b.items.map((it, ii) => (
                                <div className="rich-li" key={ii}>
                                    <span className="rich-li-marker">{it.marker}</span>
                                    <span>
                                        <Inline nodes={it.content} />
                                    </span>
                                </div>
                            ))}
                        </div>
                    );
                }
                if (b.kind === 'table') {
                    return (
                        // Широкая таблица прокручивается внутри себя: страница
                        // из-за неё ездить вбок не должна.
                        <div className="rich-table-wrap" key={i}>
                            <table className="rich-table">
                                <thead>
                                    <tr>
                                        {b.head.map((h, hi) => (
                                            <th key={hi} style={{ textAlign: b.align[hi] === 'right' ? 'right' : 'left' }}>
                                                <Inline nodes={h} />
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {b.rows.map((r, ri) => (
                                        <tr key={ri}>
                                            {r.map((c, ci) => (
                                                <td
                                                    key={ci}
                                                    style={{ textAlign: b.align[ci] === 'right' ? 'right' : 'left' }}
                                                >
                                                    <Inline nodes={c} />
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    );
                }
                return (
                    <p className="rich-p" key={i}>
                        <Inline nodes={b.content} />
                    </p>
                );
            })}
        </div>
    );
}
