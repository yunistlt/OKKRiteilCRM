import { describe, expect, it } from 'vitest';
import {
    FALLBACK_AREA,
    checkGoal,
    checkResourceName,
    checkSituation,
    checkWhy,
    guessArea,
} from '@/lib/shtab/checks';
import { buildStrategyDraft } from '@/lib/shtab/strategy';
import { topArea } from '@/lib/shtab/types';
import type { ShtabArea, ShtabMinus } from '@/lib/shtab/types';

describe('checkWhy', () => {
    it('ловит причину вне организации — на ней стратегия встанет', () => {
        for (const text of [
            'Поставщики срывают сроки поставки комплектующих уже третий месяц',
            'Кризис на рынке, заказчики придерживают бюджеты до конца года',
            'Конкуренты демпингуют и забирают наши заявки',
        ]) {
            expect(checkWhy(text)?.kind).toBe('bad');
        }
    });

    it('короткое «почему» помечает как ярлык', () => {
        expect(checkWhy('нет людей')?.kind).toBe('warn');
    });

    it('развёрнутую внутреннюю причину пропускает', () => {
        const text = 'Нет правила, кто передаёт заказ на окраску, поэтому он лежит между участками';
        expect(checkWhy(text)?.kind).toBe('ok');
    });

    it('на пустом поле молчит', () => {
        expect(checkWhy('')).toBeNull();
        expect(checkWhy('   ')).toBeNull();
    });
});

describe('checkSituation', () => {
    it('заголовок отличает от развёрнутой ситуации', () => {
        expect(checkSituation('Срыв сроков')?.kind).toBe('warn');
        expect(
            checkSituation('Заказы простаивают перед окраской по два дня, отгрузка съезжает, клиент звонит сам')
                ?.kind,
        ).toBe('ok');
    });
});

describe('checkResourceName', () => {
    it('обобщённые ресурсы не пропускает', () => {
        for (const text of ['деньги', 'Сотрудники', 'оборудование', 'станок']) {
            expect(checkResourceName(text)?.kind).toBe('bad');
        }
    });

    it('одно слово — тоже обобщение', () => {
        expect(checkResourceName('автопогрузчик')?.kind).toBe('bad');
    });

    it('конкретный ресурс пропускает молча', () => {
        expect(checkResourceName('180 тыс. руб. на вторую камеру полимеризации')).toBeNull();
        expect(checkResourceName('сотрудники, обученные приёмке по чертежу')).toBeNull();
    });
});

describe('checkGoal', () => {
    it('без позитивной части цель неполна', () => {
        expect(checkGoal('устранить простой перед окраской', '')?.kind).toBe('bad');
    });

    it('без части про улаживание — предупреждение', () => {
        expect(checkGoal('', 'выйти на вторую смену')?.kind).toBe('warn');
    });

    it('обе части — цель принята', () => {
        expect(checkGoal('устранить простой', 'выйти на вторую смену')?.kind).toBe('ok');
    });

    it('пока оба поля пусты, не придирается', () => {
        expect(checkGoal('', '')).toBeNull();
    });
});

describe('guessArea', () => {
    it('возвращает код области, а не подпись', () => {
        expect(guessArea('заказы простаивают перед окраской')).toBe('production');
        expect(guessArea('дебиторка растёт третий месяц')).toBe('finance');
        expect(guessArea('менеджеры не дожимают заявки')).toBe('sales');
        expect(guessArea('нет реестра договоров, юрист теряет претензии')).toBe('legal');
    });

    it('на непонятный текст отдаёт область по умолчанию', () => {
        expect(guessArea('что-то идёт не так вообще везде')).toBe(FALLBACK_AREA);
        expect(guessArea('')).toBe(FALLBACK_AREA);
    });

    it('короткая примета не ловит чужое слово', () => {
        // «ии» сидит внутри «претензии», «тб» — внутри «отбраковка»,
        // «чек» — внутри «чеканка». Подстрочный поиск уводил такие минусы
        // не в ту область.
        expect(guessArea('юрист не успевает по претензии')).toBe('legal');
        expect(guessArea('копии актов теряются')).toBe(FALLBACK_AREA);
        expect(guessArea('линии простаивают')).toBe(FALLBACK_AREA);
    });

    it('аббревиатуры распознаёт как отдельные слова', () => {
        expect(guessArea('нарушения ТБ на участке')).toBe('production');
        expect(guessArea('КД приходит с ошибками')).toBe('engineering');
        expect(guessArea('НДС не бьётся с первичкой')).toBe('accounting');
    });
});

describe('topArea', () => {
    const areas: ShtabArea[] = [
        { code: 'production', title: 'Производство', ordinal: 1 },
        { code: 'finance', title: 'Финансы', ordinal: 3 },
        { code: 'hr', title: 'HR', ordinal: 2 },
    ];
    const minus = (area: string, done = false): ShtabMinus => ({
        id: Math.random(),
        text: 'x',
        area_code: area,
        source: 'owner',
        occurred_on: '2026-08-25',
        done,
    });

    it('приоритет — область с наибольшим числом ОТКРЫТЫХ минусов', () => {
        const result = topArea(areas, [
            minus('production'),
            minus('production', true),
            minus('finance'),
            minus('finance'),
        ]);
        expect(result.area?.code).toBe('finance');
        expect(result.count).toBe(2);
        expect(result.counts.production).toBe(1);
    });

    it('при равенстве порядок не прыгает — выигрывает меньший ordinal', () => {
        const result = topArea(areas, [minus('production'), minus('hr')]);
        expect(result.area?.code).toBe('production');
    });

    it('минус из неизвестной области счёт не ломает', () => {
        const result = topArea(areas, [minus('production'), minus('несуществующая')]);
        expect(result.count).toBe(1);
    });
});

describe('buildStrategyDraft', () => {
    it('нумерует шаги в порядке очереди и подставляет доступные ресурсы', () => {
        const draft = buildStrategyDraft(
            [
                { ordinal: 0, missing: 'Вторая камера полимеризации', available: ['180 тыс. руб. резерва'] },
                { ordinal: 1, missing: 'Обученный оператор', available: ['мастер участка', 'курс поставщика'] },
            ],
            'Простой перед окраской устранён',
            'Выйти на вторую смену',
        );
        expect(draft).toContain('1. Сначала обеспечить: Вторая камера полимеризации.');
        expect(draft).toContain('2. Затем обеспечить: Обученный оператор.');
        expect(draft).toContain('мастер участка; курс поставщика');
        expect(draft).toContain('чтобы выйти на вторую смену');
    });

    it('незакрытый ресурс отмечает прямо в тексте — там план и рвётся', () => {
        const draft = buildStrategyDraft(
            [{ ordinal: 0, missing: 'Печь', available: [] }],
            'Цель',
            '',
        );
        expect(draft).toContain('ВНИМАНИЕ');
    });

    it('на пустой карте черновика нет', () => {
        expect(buildStrategyDraft([], 'Цель', 'Рост')).toBe('');
    });
});
