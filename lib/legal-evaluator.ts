export type LegalRiskScore = 'green' | 'yellow' | 'red';

export type LegalContractIssue = {
    id: string;
    title: string;
    severity: LegalRiskScore;
    evidence: string;
    recommendation: string;
};

export type LegalContractEvaluationResult = {
    risk_score: LegalRiskScore;
    summary: string;
    issues: LegalContractIssue[];
    facts: Record<string, any>;
};

function normalizeWhitespace(value: string) {
    return value.replace(/\u0000/g, ' ').replace(/\s+/g, ' ').trim();
}

function highestSeverity(issues: LegalContractIssue[]): LegalRiskScore {
    if (issues.some((issue) => issue.severity === 'red')) return 'red';
    if (issues.some((issue) => issue.severity === 'yellow')) return 'yellow';
    return 'green';
}

function pushIssue(target: LegalContractIssue[], issue: LegalContractIssue) {
    if (!target.some((item) => item.id === issue.id)) {
        target.push(issue);
    }
}

function collectPenaltyIssues(text: string, issues: LegalContractIssue[], facts: Record<string, any>) {
    const penaltyMatches = Array.from(text.matchAll(/(штраф|неустойк[аиуы]?)[^.\n]{0,120}?(\d{1,2}(?:[.,]\d+)?)\s?%|(\d{1,2}(?:[.,]\d+)?)\s?%[^.\n]{0,120}?(штраф|неустойк[аиуы]?)/gi));
    const percentages = penaltyMatches
        .map((match) => Number.parseFloat(String(match[2] || match[3] || '').replace(',', '.')))
        .filter((value) => Number.isFinite(value));

    if (percentages.length > 0) {
        facts.penalty_percentages = percentages;
        const maxPenalty = Math.max(...percentages);

        if (maxPenalty > 20) {
            pushIssue(issues, {
                id: 'penalty-high',
                title: 'Высокая договорная неустойка',
                severity: 'red',
                evidence: `В тексте найдена неустойка до ${maxPenalty}%`,
                recommendation: 'Проверить предел ответственности и подготовить позицию по снижению штрафа.',
            });
        } else if (maxPenalty > 10) {
            pushIssue(issues, {
                id: 'penalty-medium',
                title: 'Повышенная неустойка',
                severity: 'yellow',
                evidence: `В тексте найдена неустойка до ${maxPenalty}%`,
                recommendation: 'Уточнить коммерческую допустимость штрафа и при необходимости вынести на redlines.',
            });
        }
    }

    if (/неограниченн\w+\s+ответственност|без ограничени[яй]\s+ответственност/i.test(text)) {
        pushIssue(issues, {
            id: 'unlimited-liability',
            title: 'Неограниченная ответственность',
            severity: 'red',
            evidence: 'В договоре упоминается неограниченная или не лимитированная ответственность.',
            recommendation: 'Требуется redline по пределу ответственности и ручное согласование юристом.',
        });
    }
}

function collectJurisdictionIssues(text: string, issues: LegalContractIssue[]) {
    if (/по месту нахождени[яю]\s+истца|по выбору\s+истца/i.test(text)) {
        pushIssue(issues, {
            id: 'plaintiff-jurisdiction',
            title: 'Односторонняя подсудность',
            severity: 'red',
            evidence: 'Подсудность определяется по месту истца или по его выбору.',
            recommendation: 'Вынести пункт в протокол разногласий и передать юристу.',
        });
    }

    if (/иностранн\w+[^.\n]{0,80}суд|суд[^.\n]{0,80}иностранн\w+|foreign court/i.test(text)) {
        pushIssue(issues, {
            id: 'foreign-jurisdiction',
            title: 'Иностранная подсудность',
            severity: 'red',
            evidence: 'В тексте обнаружена иностранная юрисдикция или суд вне базового шаблона.',
            recommendation: 'Требуется ручной legal review до согласования договора.',
        });
    }

    if (/арбитражн\w+[^.\n]{0,120}(санкт-петербург|екатеринбург|казан|новосибирск|самар|нижний новгород)/i.test(text)) {
        pushIssue(issues, {
            id: 'non-standard-arbitration',
            title: 'Нестандартный арбитраж',
            severity: 'yellow',
            evidence: 'В договоре найден арбитраж вне типового маршрута согласования.',
            recommendation: 'Проверить допустимость подсудности и зафиксировать позицию компании.',
        });
    }
}

function collectOperationalIssues(text: string, issues: LegalContractIssue[]) {
    if (/односторонн\w+[^.\n]{0,120}(отказ|изменен|расторжен)/i.test(text)) {
        pushIssue(issues, {
            id: 'unilateral-change',
            title: 'Одностороннее изменение условий',
            severity: 'yellow',
            evidence: 'В тексте есть право одной стороны в одностороннем порядке менять или прекращать обязательства.',
            recommendation: 'Проверить симметричность условий и при необходимости вынести в redlines.',
        });
    }

    if (/автоматическ\w+\s+пролонгац/i.test(text)) {
        pushIssue(issues, {
            id: 'auto-renewal',
            title: 'Автоматическая пролонгация',
            severity: 'yellow',
            evidence: 'Договор содержит автоматическую пролонгацию.',
            recommendation: 'Уточнить порядок отказа от продления и внутренние лимиты согласования.',
        });
    }

    if (/персональн\w+\s+данн/i.test(text)) {
        pushIssue(issues, {
            id: 'personal-data',
            title: 'Упоминаются персональные данные',
            severity: 'yellow',
            evidence: 'В договоре есть положения о персональных данных.',
            recommendation: 'Проверить наличие нужных приложений и согласований по privacy.',
        });
    }
}

export function evaluateLegalContractText(text: string): LegalContractEvaluationResult {
    const normalized = normalizeWhitespace(text);
    const issues: LegalContractIssue[] = [];
    const facts: Record<string, any> = {
        text_length: normalized.length,
        mentions_personal_data: /персональн\w+\s+данн/i.test(normalized),
        mentions_nda: /конфиденц|nda|non[-\s]?disclosure/i.test(normalized),
    };

    collectPenaltyIssues(normalized, issues, facts);
    collectJurisdictionIssues(normalized, issues);
    collectOperationalIssues(normalized, issues);

    const riskScore = highestSeverity(issues);
    const summary = issues.length === 0
        ? 'Критичных red flag по базовым правилам не найдено. Нужна дополнительная проверка деталей вручную при нетиповом шаблоне.'
        : `${issues.length} флаг(ов): ${issues.map((issue) => issue.title).slice(0, 3).join('; ')}.`;

    return {
        risk_score: riskScore,
        summary,
        issues,
        facts,
    };
}