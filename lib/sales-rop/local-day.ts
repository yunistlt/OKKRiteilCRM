/**
 * Сегодня по заводскому времени. Тольятти — UTC+4 (самарское), а не
 * московское: час разницы решает, каким днём датирован план, запущенный ранним
 * утром.
 *
 * Жило в файле крон-маршрута и импортировалось оттуда пятью другими
 * маршрутами. Next это запрещает: в файле маршрута допустимы только его
 * собственные экспорты, и сборка падала с «localToday is not a valid Route
 * export field». Вынесено в библиотеку, поведение не менялось.
 */
export const TSEH_UTC_OFFSET_HOURS = 4;

export function localToday(now = new Date()): string {
    return new Date(now.getTime() + TSEH_UTC_OFFSET_HOURS * 60 * 60 * 1000).toISOString().slice(0, 10);
}
