import type { ShtabResource } from './types';

// Черновик стратегии из карты ресурсов.
//
// Это именно черновик — пункты в порядке очереди, а не стратегия. Методичка
// требует, чтобы стратегия была написана повествованием и в повелительном
// наклонении: исполнитель должен прочитать один раз и не прийти с вопросами.
// Сборка нужна, чтобы владелец не начинал с чистого листа и ничего не забыл.

const LEAD = ['сначала', 'затем', 'далее', 'после этого', 'параллельно', 'в завершение'];

function lower1(s: string): string {
    return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function trimDot(s: string): string {
    return s.trim().replace(/\.$/, '');
}

export function buildStrategyDraft(
    resources: readonly ShtabResource[],
    goalFix: string,
    goalGrow: string,
): string {
    if (resources.length === 0) return '';

    let out = `Для того чтобы ${lower1(trimDot(goalFix))}, действовать так.\n\n`;

    resources.forEach((c, i) => {
        const lead = LEAD[Math.min(i, LEAD.length - 1)];
        out += `${i + 1}. ${lead.charAt(0).toUpperCase()}${lead.slice(1)} обеспечить: ${trimDot(c.missing)}.`;
        out += c.available.length
            ? ` Для этого использовать: ${c.available.join('; ')}.`
            : ' ВНИМАНИЕ: доступных ресурсов не найдено — здесь стратегия встанет.';
        out += '\n\n';
    });

    if (goalGrow.trim()) {
        out += `Параллельно, чтобы ${lower1(trimDot(goalGrow))}, закрепить достигнутое в правилах работы и вернуться к этому на следующем разборе.\n`;
    }
    return out;
}

export const STRATEGY_DRAFT_NOTE = {
    say: 'Черновик собран. Это пункты, а не стратегия. Перепиши его рассказом, в повелительном наклонении: две трети вопросов, с которыми к тебе придут, снимаются формулировкой, а не разговором.',
    why: 'Пишем подробно, чтобы человек, ничего об этом не знающий, прочитал и понял с первого раза.',
};
