
import OpenAI from 'openai';

let _openai: OpenAI | null = null;
function getOpenAI() {
    if (!_openai) {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY is not set in environment variables');
        }
        _openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }
    return _openai;
}

export interface ChecklistItem {
    description: string;
    weight: number;
}

export interface ChecklistSection {
    section: string;
    items: ChecklistItem[];
}

export interface QCItemResult {
    description: string;
    weight: number;
    score: number; // Actual points awarded (0 or weight)
    status: 'pass' | 'fail' | 'partial';
    reasoning: string;
}

export interface QCSectionResult {
    section: string;
    items: QCItemResult[];
    sectionScore: number;
    sectionMaxScore: number;
}

export interface QualityControlResult {
    totalScore: number;
    maxScore: number;
    sections: QCSectionResult[];
    summary: string;
    is_violation: boolean;
}

export interface EvidenceInteraction {
    type: 'call' | 'comment' | 'field_change';
    timestamp: string;
    content: string;
    metadata?: any;
}

export interface EvidenceContext {
    orderId: number;
    status: string;
    interactions: EvidenceInteraction[];
    customerOrdersCount?: number;
}

export async function getSystemPrompt(key: string, defaultPrompt: string): Promise<{ prompt: string; model: string }> {
    try {
        const { supabase } = await import('@/utils/supabase');
        const { data } = await supabase
            .from('ai_prompts')
            .select('system_prompt, model')
            .eq('key', key)
            .eq('is_active', true)
            .single();

        if (data) {
            return { prompt: data.system_prompt, model: data.model || 'gpt-4o-mini' };
        }
    } catch (e) {
        console.warn(`[AI Settings] Failed to fetch prompt for ${key}, using default.`);
    }
    return { prompt: defaultPrompt, model: 'gpt-4o-mini' };
}

export async function evaluateChecklist(transcript: string, checklist: ChecklistSection[]): Promise<QualityControlResult> {
    if (!transcript || transcript.length < 50) {
        return {
            totalScore: 0,
            maxScore: 100,
            sections: [],
            summary: "Transcript too short or empty.",
            is_violation: true
        };
    }

    const DEFAULT_SYSTEM_PROMPT = `
You are an expert Quality Assurance Specialist for a sales department.
Your task is to audit a sales call transcript against a strict Quality Control Checklist.

INPUT:
1. Call Transcript.
2. Structure of Sections and Criteria (Items) with weights.

INSTRUCTIONS:
- Analyze the entire transcript.
- For EACH item in the checklist, determine if the manager met the criteria.
- Assign the full weight if met, 0 if missed. Partial scores are allowed ONLY if explicitly stated, otherwise binary.
- Provide a brief reasoning (in Russian) for each decision, citing specific quotes if possible.
- Calculate the total score.

OUTPUT JSON FORMAT:
{
  "summary": "Brief summary of the call quality in Russian.",
  "sections": [
    {
      "section": "Name of section",
      "items": [
        {
          "description": "Criteria description",
          "weight": 10,
          "score": 10, // Actual score awarded
          "status": "pass", // "pass" or "fail"
          "reasoning": "Reasoning in Russian"
        }
      ]
    }
  ]
}

CRITICAL:
- Be objective.
- If the transcript creates ambiguity, give the benefit of the doubt to the manager unless the criteria is "Explicitly ask X".
- Output strict JSON.
`;

    // Fetch dynamic prompt
    const { prompt: systemPrompt, model } = await getSystemPrompt('qc_checklist_audit', DEFAULT_SYSTEM_PROMPT);

    try {
        const openai = getOpenAI();
        const completion = await openai.chat.completions.create({
            model: model,
            messages: [
                { role: "system", content: systemPrompt },
                {
                    role: "user",
                    content: `TRANSCRIPT:\n${transcript}\n\nCHECKLIST STRUCTURE:\n${JSON.stringify(checklist, null, 2)}`
                }
            ],
            response_format: { type: "json_object" },
            temperature: 0.1,
        });

        const content = completion.choices[0].message.content;
        if (!content) throw new Error('No content from LLM');

        const result = JSON.parse(content);

        // Post-process to calculate totals strictly (trust but verify LLM math)
        let totalScore = 0;
        let maxScore = 0;
        const processedSections: QCSectionResult[] = [];

        for (const section of (result.sections || [])) {
            let sectionScore = 0;
            let sectionMax = 0;
            const items: QCItemResult[] = [];

            for (const item of (section.items || [])) {
                sectionScore += item.score;
                sectionMax += item.weight;
                items.push(item);
            }

            processedSections.push({
                section: section.section,
                items,
                sectionScore,
                sectionMaxScore: sectionMax
            });

            totalScore += sectionScore;
            maxScore += sectionMax;
        }

        // If maxScore is 0 (empty checklist?), avoid NaN
        if (maxScore === 0) maxScore = 100;

        return {
            totalScore,
            maxScore,
            sections: processedSections,
            summary: result.summary,
            is_violation: totalScore < 100 // Any deduction is technically a "violation" of perfect process
        };

    } catch (e) {
        console.error('QC Evaluation Error:', e);
        return {
            totalScore: 0,
            maxScore: 100,
            sections: [],
            summary: "Error during AI evaluation.",
            is_violation: true
        };
    }
}

export async function evaluateStageChecklist(context: EvidenceContext, checklist: ChecklistSection[]): Promise<QualityControlResult> {
    const interactions = context.interactions || [];
    const hasCalls = interactions.some(i => i.type === 'call');

    if (interactions.length === 0 || !hasCalls) {
        return {
            totalScore: 100, // Pass by default if no data to judge
            maxScore: 100,
            sections: [],
            summary: "Нет звонков для анализа качества квалификации на этой стадии. Проверка пропущена.",
            is_violation: false
        };
    }

    const DEFAULT_STAGE_SYSTEM_PROMPT = `
You are an expert Sales Quality Auditor.
Your task is to audit an order's progress during a specific status stage against a Quality Control Checklist.

INPUT:
1. Evidence Context: A chronological list of interactions (calls, manager comments, field changes).
2. Structure of Sections and Criteria (Items) with weights.

INSTRUCTIONS:
- Analyze ALL interactions as a single cohesive context.
- A criteria is considered MET if it was fulfilled in ANY of the interactions (e.g., if LPR was identified in Call 1, it's a "pass" even if not mentioned in Call 2).
- Manager comments in CRM are strong evidence of documentation.
- **IMPORTANT**: Reference the \`customerOrdersCount\` field in the context. If the rule prompt specifies to audit only the first or second order, and \`customerOrdersCount\` is greater than that number, you should mark all criteria as passed/ignored and mention this in the summary.
- For EACH item in the checklist, determine if the manager met the criteria across the entire stage.
- Assign the full weight if met, 0 if missed.
- Provide a brief reasoning (in Russian) for each decision, mentioning which interaction provided the evidence.
- Calculate the total score.

OUTPUT JSON FORMAT:
{
  "summary": "Brief summary of the stage quality in Russian.",
  "sections": [
    {
      "section": "Name of section",
      "items": [
        {
          "description": "Criteria description",
          "weight": 10,
          "score": 10,
          "status": "pass",
          "reasoning": "Reasoning in Russian"
        }
      ]
    }
  ]
}
`;

    const { prompt: systemPrompt, model } = await getSystemPrompt('qc_stage_audit', DEFAULT_STAGE_SYSTEM_PROMPT);

    try {
        const openai = getOpenAI();
        const completion = await openai.chat.completions.create({
            model: model,
            messages: [
                { role: "system", content: systemPrompt },
                {
                    role: "user",
                    content: `EVIDENCE CONTEXT:\n${JSON.stringify(context, null, 2)}\n\nCHECKLIST STRUCTURE:\n${JSON.stringify(checklist, null, 2)}`
                }
            ],
            response_format: { type: "json_object" },
            temperature: 0.1,
        });

        const content = completion.choices[0].message.content;
        if (!content) throw new Error('No content from LLM');

        const result = JSON.parse(content);

        // Reuse point calculation logic
        let totalScore = 0;
        let maxScore = 0;
        const processedSections: QCSectionResult[] = [];

        for (const section of (result.sections || [])) {
            let sectionScore = 0;
            let sectionMax = 0;
            const items: QCItemResult[] = [];

            for (const item of (section.items || [])) {
                sectionScore += item.score;
                sectionMax += item.weight;
                items.push(item);
            }

            processedSections.push({
                section: section.section,
                items,
                sectionScore,
                sectionMaxScore: sectionMax
            });

            totalScore += sectionScore;
            maxScore += sectionMax;
        }

        if (maxScore === 0) maxScore = 100;

        return {
            totalScore,
            maxScore,
            sections: processedSections,
            summary: result.summary,
            is_violation: totalScore < 100
        };

    } catch (e) {
        console.error('Stage QC Evaluation Error:', e);
        return {
            totalScore: 0,
            maxScore: 100,
            sections: [],
            summary: "Error during Stage AI evaluation.",
            is_violation: true
        };
    }
}
