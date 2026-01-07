
import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export interface SemanticResult {
    is_violation: boolean;
    evidence: string | null;
    confidence: number;
    reasoning: string;
}

export async function analyzeTranscript(transcript: string, rulePrompt: string): Promise<SemanticResult> {
    if (!transcript || transcript.length < 10) {
        return { is_violation: false, evidence: null, confidence: 0, reasoning: 'Transcript too short' };
    }

    // System Prompt for the Analyzer
    const systemPrompt = `
You are an AI Quality Assurance Manager for a Sales Department.
Your task is to analyze a call transcript and check for specific violations based on a Rule Definition.

Input:
1. Rule Definition (what strictly constitutes a violation).
2. Call Transcript.

Output JSON (Strictly in Russian language):
{
  "is_violation": boolean, // TRUE если правило нарушено, FALSE в противном случае.
  "evidence": string, // Цитата из текста, подтверждающая нарушение (на языке оригинала).
  "confidence": number, // от 0.0 до 1.0
  "reasoning": string // Краткое объяснение на РУССКОМ языке
}

CRITICAL: All reasoning, explanations and summary fields MUST BE IN RUSSIAN.
Be strict. If the transcript is ambiguous, bias towards NO violation (innocent until proven guilty) unless the rule says "Ensure X happened".
    `;

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini", // Efficient model for analysis
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `RULE: ${rulePrompt}\n\nTRANSCRIPT:\n${transcript}` }
            ],
            response_format: { type: "json_object" },
            temperature: 0.1,
        });

        const content = completion.choices[0].message.content;
        if (!content) throw new Error('No content from LLM');

        const result = JSON.parse(content);
        return {
            is_violation: result.is_violation,
            evidence: result.evidence,
            confidence: result.confidence,
            reasoning: result.reasoning
        };

    } catch (e) {
        console.error('Semantic Analysis Error:', e);
        return { is_violation: false, evidence: null, confidence: 0, reasoning: 'Error' };
    }
}
