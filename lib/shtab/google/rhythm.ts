// Ритм управления: какие планёрки заводятся и с какой повесткой.
//
// Ритм ставится весь сразу — ежедневная, недельная, месячная, квартальная.
// Каждая заводится ПОВТОРЯЮЩИМСЯ событием с устойчивым идентификатором, и это
// главное свойство: повторный прогон задания не задваивает встречи, а обновляет
// повестку у той же самой.
//
// Второе свойство, ради которого всё затевалось: встречи не двигаются. Слот
// подбирается один раз при настройке, дальше Тамара только обновляет повестку.
// Отменённая дважды встреча перестаёт существовать, и помощник, вежливо
// переносящий планёрку при каждом конфликте, разрушает ровно то, ради чего она
// заведена. При конфликте мы сообщаем о нём владельцу, а не решаем за него.

export type RhythmCode = 'daily' | 'weekly' | 'monthly' | 'quarterly';

export type RhythmMeeting = {
    code: RhythmCode;
    title: string;
    /** Сколько длится, минут. */
    minutes: number;
    /** Повторение в формате RFC 5545, как его понимает Google Calendar. */
    rrule: string;
    /** Постоянная часть повестки. Числа программ добавляются к ней заданием. */
    agenda: string;
};

export const RHYTHM: RhythmMeeting[] = [
    {
        code: 'daily',
        title: 'Ежедневная планёрка',
        minutes: 15,
        rrule: 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
        agenda:
            'Пятнадцать минут стоя. Один вопрос: что застряло со вчера и кому нужна помощь. Не отчёт о работе — застрявшее не должно лежать неделю.',
    },
    {
        code: 'weekly',
        title: 'Недельная планёрка по программам',
        minutes: 60,
        rrule: 'RRULE:FREQ=WEEKLY;BYDAY=MO',
        agenda:
            'Проход по производственным задачам всех программ: где расходимся с числом и почему. Разбираем отклонения, а не всё подряд. Один-два вопроса доводим до решения — это полезнее, чем коснуться восьми.',
    },
    {
        code: 'monthly',
        title: 'Месячный разбор области',
        minutes: 240,
        rrule: 'RRULE:FREQ=MONTHLY;BYDAY=1MO',
        agenda:
            'Полдня на область целиком: как устроена работа, а не что горит сейчас. Смотрим, не вернулись ли закрытые минусы — если вернулись, причина найдена неверно, и разбор надо делать заново, а не давить сильнее.',
    },
    {
        code: 'quarterly',
        title: 'Квартальная сессия',
        minutes: 480,
        rrule: 'RRULE:FREQ=MONTHLY;BYMONTH=1,4,7,10;BYMONTHDAY=1',
        agenda:
            'День на итоги квартала и выбор приоритета следующего. Один приоритет, а не список: приоритет, который невозможно назвать без списка, — это отсутствие приоритета.',
    },
];

/**
 * Устойчивый идентификатор события.
 *
 * Google требует, чтобы iCalUID был уникален в календаре, и по нему же находит
 * событие при повторной записи. Идентификатор собирается из кода ритма и
 * идентификатора календаря — без даты, потому что событие повторяющееся: дата
 * сделала бы каждый прогон новой встречей.
 */
export function rhythmUid(code: RhythmCode, calendarId: string): string {
    const salt = calendarId.replace(/[^a-z0-9]/gi, '').slice(0, 24).toLowerCase();
    return `shtab-${code}-${salt}@zmk`;
}

/** Повестка события: постоянная часть плюс срез по программам. */
export function renderAgenda(meeting: RhythmMeeting, programLines: readonly string[]): string {
    const lines = [meeting.agenda];
    if (meeting.code === 'weekly' || meeting.code === 'monthly') {
        lines.push('', 'Программы и их числа:');
        lines.push(
            ...(programLines.length > 0
                ? programLines.map((l) => `— ${l}`)
                : ['— программ пока нет; завести их можно в Штабе, вкладка «Программы»']),
        );
    }
    lines.push('', 'Собрано Штабом. Повестка обновляется еженедельно.');
    return lines.join('\n');
}

/**
 * Первый слот встречи: дата и время начала.
 *
 * Считается от понедельника недели, чтобы недельная планёрка попала сразу после
 * понедельничной сводки Тамары, а прочие встали в тот же ритм. Часы задаются
 * настройкой при подключении — здесь только правило, куда встреча относится.
 */
export function firstSlot(code: RhythmCode, weekStartIso: string, hour: number, minute = 0): string {
    const [y, m, d] = weekStartIso.split('-').map(Number);
    const at = new Date(Date.UTC(y, m - 1, d, hour, minute, 0));

    if (code === 'monthly') {
        // Первый понедельник месяца, к которому относится эта неделя.
        const first = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
        const shift = (8 - first.getUTCDay()) % 7; // 0 → воскресенье, нужен понедельник
        first.setUTCDate(1 + shift);
        first.setUTCHours(hour, minute, 0, 0);
        return first.toISOString();
    }
    if (code === 'quarterly') {
        const month = Math.floor(at.getUTCMonth() / 3) * 3;
        return new Date(Date.UTC(at.getUTCFullYear(), month, 1, hour, minute, 0)).toISOString();
    }
    return at.toISOString();
}
