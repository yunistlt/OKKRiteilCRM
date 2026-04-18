import {
    buildFormulaExplanation,
    buildGlossaryAnswer,
    formatConsultantSectionOverview,
    formatCriterionHowToFixText,
    formatCriterionWhyFailText,
    getConsultantCatalog,
} from './okk-consultant';

export type ConsultantKnowledgeSeedRow = {
    slug: string;
    type: string;
    sectionKey: string | null;
    title: string;
    content: string;
    tags: string[];
    sourceRef: string;
    metadata?: Record<string, any>;
};

export function buildConsultantKnowledgeSeedRows(): ConsultantKnowledgeSeedRow[] {
    const catalog = getConsultantCatalog();
    const rows: ConsultantKnowledgeSeedRow[] = [];

    // Source of truth policy: KB rows are materialized from the structured consultant catalog.
    // Avoid hand-editing parallel section prose here, otherwise deterministic answers and fallback KB will drift apart.

    for (const [formulaKey] of Object.entries(catalog.formulas)) {
        rows.push({
            slug: `formula:${formulaKey}`,
            type: 'formula',
            sectionKey: 'quality-dashboard',
            title: formulaKey,
            content: buildFormulaExplanation(formulaKey as keyof typeof catalog.formulas),
            tags: [formulaKey, 'formula', 'score'],
            sourceRef: `formula:${formulaKey}`,
        });
    }

    for (const term of catalog.glossary) {
        rows.push({
            slug: `glossary:${term.key}`,
            type: 'glossary',
            sectionKey: 'quality-dashboard',
            title: term.term,
            content: buildGlossaryAnswer(term),
            tags: [term.key, ...term.aliases],
            sourceRef: `glossary:${term.key}`,
        });
    }

    for (const criterion of catalog.criteria) {
        rows.push({
            slug: `criterion:${criterion.key}`,
            type: 'criterion',
            sectionKey: 'quality-dashboard',
            title: criterion.label,
            content: [
                `Кто проверяет: ${criterion.owner}.`,
                `Группа: ${criterion.group}.`,
                `Как проверяется: ${criterion.howChecked}`,
                `Источники данных: ${criterion.dataSources.join('; ')}.`,
                `Когда это норма: ${criterion.whyPass}`,
                `Когда это провал: ${formatCriterionWhyFailText(criterion.whyFail)}`,
                `Как исправить: ${formatCriterionHowToFixText(criterion.howToFix)}`,
            ].join('\n'),
            tags: [criterion.key, criterion.group, criterion.owner, ...criterion.aliases],
            sourceRef: `criterion:${criterion.key}`,
        });
    }

    for (const section of catalog.sections) {
        rows.push({
            slug: `section:${section.key}`,
            type: 'section_overview',
            sectionKey: section.key,
            title: section.title,
            content: formatConsultantSectionOverview(section),
            tags: [section.key, section.shortTitle, ...section.pathPrefixes],
            sourceRef: `section:${section.key}`,
        });

        for (const entity of section.entities || []) {
            rows.push({
                slug: `section-entity:${section.key}:${entity.key}`,
                type: 'section_entity',
                sectionKey: section.key,
                title: `${section.title}: ${entity.title}`,
                content: entity.answer,
                tags: [section.key, entity.key, ...entity.aliases],
                sourceRef: `section-entity:${section.key}:${entity.key}`,
            });
        }

        for (const mode of section.modes || []) {
            rows.push({
                slug: `section-mode:${section.key}:${mode.key}`,
                type: 'section_mode',
                sectionKey: section.key,
                title: `${section.title}: ${mode.title}`,
                content: mode.answer,
                tags: [section.key, mode.key, ...mode.aliases],
                sourceRef: `section-mode:${section.key}:${mode.key}`,
            });
        }

        for (const topic of section.topics) {
            rows.push({
                slug: `section-topic:${section.key}:${topic.key}`,
                type: 'section_topic',
                sectionKey: section.key,
                title: `${section.title}: ${topic.title}`,
                content: topic.answer,
                tags: [section.key, topic.key, ...topic.aliases],
                sourceRef: `section-topic:${section.key}:${topic.key}`,
            });
        }
    }

    return rows;
}