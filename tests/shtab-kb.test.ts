import { describe, expect, it } from 'vitest';
import { KB_TYPES, SHTAB_KB_SEED, formatShtabKbForEmbedding } from '@/lib/shtab/kb-content';
import { duplicateSlugs, kbFingerprint } from '@/lib/shtab/kb-seed';

describe('содержание базы знаний', () => {
    it('slug уникальны — иначе ON CONFLICT молча съел бы статью', () => {
        expect(duplicateSlugs(SHTAB_KB_SEED.map((r) => r.slug))).toEqual([]);
    });

    it('slug пригодны для ссылок: латиница, цифры и дефис', () => {
        for (const row of SHTAB_KB_SEED) {
            expect(row.slug, row.slug).toMatch(/^[a-z0-9-]+$/);
        }
    });

    it('у каждой статьи назван источник', () => {
        // Тамара обязана говорить, откуда мысль. Пустой источник означал бы,
        // что она выдаёт чужое за своё, а проверить это владелец не сможет.
        for (const row of SHTAB_KB_SEED) {
            expect(row.sourceRef.trim().length, row.slug).toBeGreaterThan(0);
        }
    });

    it('тип из разрешённых — тот же список, что в CHECK миграции', () => {
        for (const row of SHTAB_KB_SEED) {
            expect(KB_TYPES as readonly string[], row.slug).toContain(row.type);
        }
    });

    it('статьи содержательны, а не заглушки', () => {
        for (const row of SHTAB_KB_SEED) {
            expect(row.title.trim().length, row.slug).toBeGreaterThan(5);
            expect(row.content.trim().length, row.slug).toBeGreaterThan(300);
            expect(row.tags.length, row.slug).toBeGreaterThan(0);
        }
    });

    it('заполнены все засеваемые разделы', () => {
        // Объявленный, но пустой вид — это либо забытые статьи, либо лишняя
        // строка в CHECK миграции. Исключение одно: 'company' не засевается
        // никогда, такие записи заводит сама Тамара через shtab_remember, когда
        // выяснит факт у владельца.
        const types = new Set(SHTAB_KB_SEED.map((r) => r.type));
        const seeded = KB_TYPES.filter((t) => t !== 'company');
        expect(types).toEqual(new Set(seeded));
    });

    it('фактов о компании в сиде нет', () => {
        // Засеянный факт о цехе — это факт, придуманный мной, а не сказанный
        // владельцем, и отличить одно от другого потом будет нечем.
        expect(SHTAB_KB_SEED.filter((r) => r.type === 'company')).toHaveLength(0);
    });

    it('ремесло покрывает рабочие задачи наших программ', () => {
        // Этими статьями консультант ЦехУспеха помогает начальнику цеха по
        // существу. Пропала статья — помощь превращается в напоминание.
        const slugs = new Set(SHTAB_KB_SEED.filter((r) => r.type === 'craft').map((r) => r.slug));
        for (const need of [
            'craft-uzkoe-mesto',
            'craft-zamer-propusknoy',
            'craft-grafik-to',
            'craft-marshrut-zagotovki',
            'craft-reglament',
            'craft-nastavnichestvo',
        ]) {
            expect(slugs, need).toContain(need);
        }
    });

    it('методичка «Альянс Стратег» покрыта по шагам разбора', () => {
        // Если из методички выпадет шаг, Тамара перестанет о нём напоминать,
        // и разбор молча поедет мимо порядка.
        const slugs = new Set(SHTAB_KB_SEED.map((r) => r.slug));
        for (const step of [
            'as-minus',
            'as-prioritet',
            'as-situaciya',
            'as-pochemu',
            'as-cel',
            'as-resursy',
            'as-strategiya',
            'as-proekt',
            'as-post',
            'as-statistika',
            'as-poryadok-razbora',
        ]) {
            expect(slugs, step).toContain(step);
        }
    });

    it('слой программ покрыт: блоки, программа и все пять типов задач', () => {
        // Без этих статей Тамара доведёт разбор до стратегии и остановится —
        // ровно там, где система обрывалась до сих пор.
        const slugs = new Set(SHTAB_KB_SEED.map((r) => r.slug));
        for (const step of [
            'as-logicheskiy-blok',
            'as-programma',
            'as-obratnyy-otschet',
            'as-glavnaya-zadacha',
            'as-pervoocherednye-zadachi',
            'as-rabochie-zadachi',
            'as-proizvodstvennye-zadachi',
            'as-zhiznenno-vazhnye-zadachi',
            'as-uslovnye-zadachi',
            'as-poryadok-zapuska',
        ]) {
            expect(slugs, step).toContain(step);
        }
    });

    it('статья про стратегию не ведёт сразу к проектам', () => {
        // Пропущенный слой программ — это пропущенные производственные задачи.
        const strat = SHTAB_KB_SEED.find((r) => r.slug === 'as-strategiya');
        expect(strat?.content).toMatch(/логическ|программ/i);
    });

    it('в знаниях нет фактов о компании — они приходят только из инструментов', () => {
        // Число, попавшее в базу знаний, Тамара повторит как своё, и проверить
        // его будет негде: у статьи нет ни даты, ни источника в данных.
        const suspicious = /\b(ЗМК|Тольятти|ЦехУспех|выручка составила|рублей в месяц)\b/i;
        for (const row of SHTAB_KB_SEED) {
            expect(suspicious.test(row.content), `${row.slug}: похоже на факт о компании`).toBe(false);
        }
    });
});

describe('текст для эмбеддинга', () => {
    it('включает заголовок и теги, а не только содержание', () => {
        const row = SHTAB_KB_SEED[0];
        const text = formatShtabKbForEmbedding(row);
        expect(text).toContain(row.title);
        expect(text).toContain(row.tags[0]);
        expect(text).toContain(row.content.slice(0, 40));
    });
});

describe('отпечаток текста', () => {
    it('устойчив: тот же текст — тот же отпечаток', () => {
        expect(kbFingerprint('привет')).toBe(kbFingerprint('привет'));
    });

    it('меняется от правки — иначе изменённая статья не доехала бы до базы', () => {
        expect(kbFingerprint('привет')).not.toBe(kbFingerprint('привет!'));
    });

    it('различает статьи, отличающиеся только тегами', () => {
        const a = { ...SHTAB_KB_SEED[0], tags: ['один'] };
        const b = { ...SHTAB_KB_SEED[0], tags: ['два'] };
        expect(kbFingerprint(formatShtabKbForEmbedding(a))).not.toBe(kbFingerprint(formatShtabKbForEmbedding(b)));
    });
});

describe('duplicateSlugs', () => {
    it('находит повторы и не выдумывает их', () => {
        expect(duplicateSlugs(['a', 'b', 'c'])).toEqual([]);
        expect(duplicateSlugs(['a', 'b', 'a'])).toEqual(['a']);
        expect(duplicateSlugs(['a', 'a', 'a'])).toEqual(['a']);
        expect(duplicateSlugs(['a', 'b', 'a', 'b'])).toEqual(['a', 'b']);
    });
});
