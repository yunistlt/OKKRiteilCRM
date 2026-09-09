'use client';

import { xmr } from '@/lib/shtab/xmr';
import type { VerdictKind } from '@/lib/shtab/xmr';

const W = 130;
const H = 40;
const P = 4;

const STROKE: Record<VerdictKind, string> = {
    signal: 'var(--signal)',
    noise: 'var(--calm)',
    thin: 'var(--ink-3)',
};

/**
 * Ряд с полосой контрольных границ. Полоса важнее самой линии: без неё владелец
 * читает любой зубец как событие. Пока точек мало (вердикт thin), границы не
 * рисуются — они ещё ничего не значат.
 */
export default function Sparkline({ data, kind }: { data: number[]; kind: VerdictKind }) {
    if (data.length < 2) return null;

    const limits = xmr(data);
    let lo = Math.min(limits.lo, ...data);
    let hi = Math.max(limits.hi, ...data);
    const pad = (hi - lo) * 0.12 || 1;
    lo -= pad;
    hi += pad;

    const x = (i: number) => P + (i * (W - 2 * P)) / (data.length - 1);
    const y = (v: number) => H - P - ((v - lo) * (H - 2 * P)) / (hi - lo);
    const points = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const color = STROKE[kind];

    return (
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="динамика">
            {kind !== 'thin' && (
                <>
                    <rect
                        x={P}
                        y={y(limits.hi)}
                        width={W - 2 * P}
                        height={Math.max(0, y(limits.lo) - y(limits.hi))}
                        fill="var(--line)"
                        opacity=".5"
                    />
                    <line
                        x1={P}
                        y1={y(limits.cl)}
                        x2={W - P}
                        y2={y(limits.cl)}
                        stroke="var(--line-2)"
                        strokeDasharray="3 3"
                    />
                </>
            )}
            <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
            <circle cx={x(data.length - 1)} cy={y(data[data.length - 1])} r="3" fill={color} />
        </svg>
    );
}
