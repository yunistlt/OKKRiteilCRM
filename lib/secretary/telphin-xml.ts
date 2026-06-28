// Построение XML-ответа для узла «Интерактивная обработка» (Call Interactive) Телфина.
// Контракт: ответ — <Response> с действиями. До 10 действий; hangup/SimpleTransfer/TTS —
// терминальные (после них остальные действия игнорируются), поэтому TTS/Transfer ставим последними.

const VOICE = process.env.TELPHIN_TTS_VOICE || 'alena';
const LANG = process.env.TELPHIN_TTS_LANG || 'ru-RU';
const TTS_SPEED = process.env.TELPHIN_TTS_SPEED || '1.0';

function esc(value: string): string {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Записать значение в переменную схемы (например добавочный для перевода). */
export function xmlSetVar(name: string, value: string): string {
    return `  <SetVar name="${esc(name)}">${esc(value)}</SetVar>`;
}

/** Перевод звонка напрямую из ответа (терминальное действие). */
export function xmlSimpleTransfer(destination: string, timeout = 20): string {
    return `  <SimpleTransfer final="no" timeout="${timeout}">${esc(destination)}</SimpleTransfer>`;
}

/** Озвучить текст синтезом речи (терминальное действие — ставить последним). */
export function xmlTTS(text: string): string {
    return `  <TTS lang="${LANG}" voice="${VOICE}" speed="${TTS_SPEED}" play_now="true" save_to_var="false">${esc(text)}</TTS>`;
}

/** Собрать финальный XML-ответ. */
export function buildResponse(actions: string[]): string {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n${actions.join('\n')}\n</Response>`;
}
