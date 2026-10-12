/**
 * Фамилия, имя и отчество в родительном падеже.
 *
 * В договоре нужны оба падежа: в преамбуле — «в лице Директора Шуняевой
 * Фаузили Рифовны», а в строке подписи — «Директор: ______ / Шуняева Фаузиля
 * Рифовна /». Менеджеры вписывали в карточку сразу родительный, чтобы
 * преамбула читалась, и тогда подпись выходила с чужим падежом (Лена
 * Парфёнова 12.10.2026).
 *
 * Поэтому в карточке храним именительный — как человека зовут, — а родительный
 * получаем здесь.
 *
 * Правила покрывают обычные русские ФИО. Нерусские и несклоняемые фамилии
 * (Шевченко, Дюма, Ким) остаются как есть: лучше не склонять, чем склонять
 * неправильно. Уже записанное в родительном падеже проходит насквозь — его
 * окончания правила не трогают.
 */

/**
 * Женщина это или мужчина — по отчеству, самому надёжному признаку.
 * Родительный падеж отчества («Рифовны») узнаём тоже: в карточках встречается
 * и он.
 */
function isFemale(patronymic: string): boolean {
    return /(вна|чна|вны|чны)$/i.test(patronymic);
}

/**
 * «Ы» или «И» в окончании: после шипящих и заднеязычных пишется «и» —
 * «Ольга → Ольги», а не «Ольгы».
 */
function endingAfter(stem: string): string {
    return /[гкхжшщч]$/i.test(stem) ? 'и' : 'ы';
}

function surnameToGenitive(surname: string, female: boolean): string {
    // Несклоняемые: -ко, -ук, -их, -ых, -енко, иностранные на гласную.
    if (/(ко|ук|их|ых|е|и|о|у|ы|э|ю)$/i.test(surname)) return surname;

    if (/(ов|ёв|ев|ин|ын)$/i.test(surname)) return female ? `${surname}ой` : `${surname}а`;
    if (/(ова|ёва|ева|ина|ына)$/i.test(surname)) return `${surname.slice(0, -1)}ой`;
    if (/(ский|цкий|ный|ий|ый)$/i.test(surname)) return `${surname.slice(0, -2)}ого`;
    if (/(ская|цкая|ная|ая)$/i.test(surname)) return `${surname.slice(0, -2)}ой`;
    if (/(ь)$/i.test(surname)) return female ? surname : `${surname.slice(0, -1)}я`;
    if (/(а|я)$/i.test(surname)) {
        const stem = surname.slice(0, -1);
        return `${stem}${/я$/i.test(surname) ? 'и' : endingAfter(stem)}`;
    }

    // Фамилия на согласную: у мужчины склоняется, у женщины — нет.
    return female ? surname : `${surname}а`;
}

function firstNameToGenitive(name: string, female: boolean): string {
    if (/(ия|ья)$/i.test(name)) return `${name.slice(0, -1)}и`;
    if (/я$/i.test(name)) return `${name.slice(0, -1)}и`;
    if (/а$/i.test(name)) {
        const stem = name.slice(0, -1);
        return `${stem}${endingAfter(stem)}`;
    }
    if (/й$/i.test(name)) return `${name.slice(0, -1)}я`;
    if (/ь$/i.test(name)) return female ? `${name.slice(0, -1)}и` : `${name.slice(0, -1)}я`;
    if (female) return name;
    return `${name}а`;
}

function patronymicToGenitive(patronymic: string): string {
    if (/(вич|ич)$/i.test(patronymic)) return `${patronymic}а`;
    if (/(вна|чна)$/i.test(patronymic)) return `${patronymic.slice(0, -1)}ы`;
    // Уже родительный — второй раз не склоняем.
    if (/(вны|чны|вича|ича)$/i.test(patronymic)) return patronymic;
    return patronymic;
}

/** «Шуняева Фаузиля Рифовна» → «Шуняевой Фаузили Рифовны». */
export function toGenitive(fullName: string | null | undefined): string {
    const parts = String(fullName ?? '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '';

    const [surname, first, patronymic] = parts;
    const female = isFemale(patronymic ?? '');

    const out = [surnameToGenitive(surname, female)];
    if (first) out.push(firstNameToGenitive(first, female));
    if (patronymic) out.push(patronymicToGenitive(patronymic));

    // Остальное (вторые имена, приставки) оставляем как есть.
    return [...out, ...parts.slice(3)].join(' ');
}

/**
 * Должность в родительном падеже: «в лице Директора», «в лице Генерального
 * директора». Без этого преамбула читалась «в лице Директор Мироновой».
 *
 * Прилагательные в должности склоняем по окончанию, существительные — по
 * обычному мужскому правилу. Чего не узнали — оставляем как есть.
 */
export function titleToGenitive(title: string | null | undefined): string {
    const words = String(title ?? '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '';

    return words
        .map((word) => {
            if (/^(ип|оао|ооо|зао|пао)$/i.test(word)) return word;
            if (/(ый|ий)$/i.test(word)) return `${word.slice(0, -2)}ого`;
            if (/(ая)$/i.test(word)) return `${word.slice(0, -2)}ой`;
            // Уже родительный — второй раз не склоняем.
            if (/(ого|ой|а|я)$/i.test(word)) return word;
            if (/(ор|ель|ик|ник|ент|ор|арь)$/i.test(word)) return `${word}а`;
            return word;
        })
        .join(' ');
}
