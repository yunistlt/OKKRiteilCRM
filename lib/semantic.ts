
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

export async function analyzeText(text: string, rulePrompt: string, contextDescription: string = 'Text Content'): Promise<SemanticResult> {
    if (!text || text.length < 2) {
        return { is_violation: false, evidence: null, confidence: 0, reasoning: 'Текст слишком короткий для анализа' };
    }

    // System Prompt for the Analyzer
    const systemPrompt = `
You are an AI Quality Assurance Auditor.
Your task is to analyze a text input (${contextDescription}) and check for specific violations based on a Rule Definition.

Input:
1. Rule Definition (what strictly constitutes a violation).
2. Input Text (${contextDescription}).

Output JSON (Strictly in Russian language):
{
  "is_violation": boolean, // TRUE если правило нарушено, FALSE в противном случае.
  "evidence": string, // Цитата из текста, подтверждающая нарушение (на языке оригинала) или NULL если текста нет.
  "confidence": number, // от 0.0 до 1.0
  "reasoning": string // Краткое объяснение на РУССКОМ языке
}

CRITICAL: All reasoning, explanations and summary fields MUST BE IN RUSSIAN.
Be strict. If the text is ambiguous, bias towards NO violation (innocent until proven guilty) unless the rule says "Ensure X happened".
    `;

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini", // Efficient model for analysis
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `RULE: ${rulePrompt}\n\nINPUT TEXT:\n${text}` }
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
        return { is_violation: false, evidence: null, confidence: 0, reasoning: 'Ошибка во время AI анализа. Проверьте логи.' };
    }
}

export async function analyzeTranscript(transcript: string, rulePrompt: string): Promise<SemanticResult> {
    return analyzeText(transcript, rulePrompt, 'Call Transcript');
}
