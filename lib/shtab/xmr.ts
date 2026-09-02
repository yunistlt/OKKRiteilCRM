// Карта индивидуальных значений (XmR, она же контрольная карта Шухарта).
//
// Методичка «Альянс Стратег» требует смотреть статистики еженедельно, но не даёт
// правила, как отличить сигнал от обычного колебания. Без такого правила владелец
// дёргается на каждое движение вниз и перестаёт замечать настоящие сдвиги.
// XmR закрывает этот пробел: границы считаются из самого ряда, а не назначаются.
//
// cl  = среднее ряда
// mR̄  = среднее модулей разностей соседних точек
// границы = cl ± 2.66 · mR̄
//
// Коэффициент 2.66 — стандартный для карт индивидуальных значений: он выводится
// из 3/d₂ при подгруппе размера 2 (d₂ = 1.128).

export type XmrLimits = {
    /** центральная линия — среднее ряда */
    cl: number;
    /** нижняя граница */
    lo: number;
    /** верхняя граница */
    hi: number;
    /** число точек */
    n: number;
};

export type VerdictKind = 'thin' | 'signal' | 'noise';

export type Verdict = {
    kind: VerdictKind;
    /** подпись для интерфейса */
    title: string;
};

/** Меньше этого числа точек границы считать бессмысленно — они пляшут от каждой новой. */
export const MIN_POINTS = 12;

/** Длина серии по одну сторону от центральной линии, которая уже считается сигналом. */
export const RUN_LENGTH = 8;

const SIGMA_FACTOR = 2.66;

export function xmr(data: readonly number[]): XmrLimits {
    const n = data.length;
    if (n === 0) return { cl: 0, lo: 0, hi: 0, n: 0 };

    const cl = data.reduce((sum, v) => sum + v, 0) / n;
    if (n === 1) return { cl, lo: cl, hi: cl, n };

    let movingRange = 0;
    for (let i = 1; i < n; i++) movingRange += Math.abs(data[i] - data[i - 1]);
    const spread = SIGMA_FACTOR * (movingRange / (n - 1));

    return { cl, lo: cl - spread, hi: cl + spread, n };
}

/**
 * Вердикт по ряду: стоит ли вообще на него реагировать.
 *
 * «Сигнал» ставится по двум правилам Шухарта–Уилера, которых достаточно для
 * недельных статистик: последняя точка вышла за границы, либо восемь последних
 * точек подряд легли по одну сторону от центральной линии. Второе правило ловит
 * медленный дрейф, который по границам не виден.
 */
export function verdict(data: readonly number[]): Verdict {
    const limits = xmr(data);
    if (limits.n < MIN_POINTS) return { kind: 'thin', title: 'данных мало' };

    const last = data[data.length - 1];
    if (last > limits.hi || last < limits.lo) return { kind: 'signal', title: 'сигнал' };

    // Точки ровно на центральной линии не относятся ни к одной стороне: они не
    // продолжают серию и не рвут её. Без этого правила идеально ровный ряд —
    // например двенадцать недель подряд без единой рекламации — давал бы «сигнал»,
    // потому что все точки формально лежали бы по одну сторону от собственного
    // среднего. Ровный ряд — это предел стабильности, а не повод дёргаться.
    if (last !== limits.cl) {
        const lastBelow = last < limits.cl;
        let run = 0;
        for (let i = data.length - 1; i >= 0; i--) {
            if (data[i] === limits.cl) continue;
            if (data[i] < limits.cl !== lastBelow) break;
            run++;
        }
        if (run >= RUN_LENGTH) return { kind: 'signal', title: 'сигнал · серия' };
    }

    return { kind: 'noise', title: 'шум' };
}
