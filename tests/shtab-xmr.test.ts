import { describe, expect, it } from 'vitest';
import { MIN_POINTS, RUN_LENGTH, verdict, xmr } from '@/lib/shtab/xmr';

const flat = (value: number, n: number) => Array.from({ length: n }, () => value);

describe('xmr', () => {
    it('считает центральную линию и границы по формуле карты индивидуальных значений', () => {
        // Ряд 1,3,1,3…: среднее 2, скользящий размах ровно 2, разброс 2.66·2 = 5.32
        const data = [1, 3, 1, 3, 1, 3];
        const limits = xmr(data);
        expect(limits.cl).toBe(2);
        expect(limits.hi).toBeCloseTo(2 + 5.32, 10);
        expect(limits.lo).toBeCloseTo(2 - 5.32, 10);
        expect(limits.n).toBe(6);
    });

    it('не делит на ноль на вырожденных рядах', () => {
        expect(xmr([])).toEqual({ cl: 0, lo: 0, hi: 0, n: 0 });
        expect(xmr([7])).toEqual({ cl: 7, lo: 7, hi: 7, n: 1 });
    });
});

describe('verdict', () => {
    it('на коротком ряде честно говорит, что данных мало', () => {
        const short = Array.from({ length: MIN_POINTS - 1 }, (_, i) => (i % 2 ? 10 : 1000));
        expect(verdict(short).kind).toBe('thin');
        expect(verdict(short).title).toBe('данных мало');
    });

    it('обычное колебание внутри границ считает шумом', () => {
        const data = [10, 11, 9, 10, 12, 8, 11, 10, 9, 11, 10, 10];
        expect(verdict(data).kind).toBe('noise');
    });

    it('последнюю точку за границей называет сигналом', () => {
        const data = [...flat(10, 11), 40];
        const result = verdict(data);
        expect(result.kind).toBe('signal');
        expect(result.title).toBe('сигнал');
    });

    it('серию по одну сторону от центральной линии называет сигналом · серия', () => {
        // Первые точки задают разброс, дальше ряд уходит вниз и держится там.
        const data = [8, 12, 8, 12, ...flat(9, RUN_LENGTH)];
        expect(data.length).toBeGreaterThanOrEqual(MIN_POINTS);
        const result = verdict(data);
        expect(result.kind).toBe('signal');
        expect(result.title).toBe('сигнал · серия');
    });

    it('серия короче восьми точек сигналом не считается', () => {
        const data = [8, 12, 8, 12, 8, 12, 8, 12, ...flat(9, RUN_LENGTH - 1)];
        expect(verdict(data).kind).toBe('noise');
    });

    it('идеально ровный ряд — это предел стабильности, а не сигнал', () => {
        // Двенадцать недель подряд без единой рекламации. Все точки лежат на
        // центральной линии; наивная проверка серии объявила бы это сигналом.
        expect(verdict(flat(0, MIN_POINTS)).kind).toBe('noise');
        expect(verdict(flat(42, MIN_POINTS + 5)).kind).toBe('noise');
    });
});
