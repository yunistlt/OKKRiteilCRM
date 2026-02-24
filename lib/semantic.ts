
// ОТВЕТСТВЕННЫЙ: АННА (Бизнес-аналитик) — Семантическая проверка текста и выявление смыслов.
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

export async function generateHumanNotification(managerName: string, orderId: string, ruleName: string, details: string, points: number): Promise<string> {
    const systemPrompt = `
You are a caring but strict Head of Quality Control.
Your task is to write a single short, human-like Telegram message to a manager about a violation they committed.

Requirements:
1. Address the manager by name kindly/friendly (e.g., "${managerName}, привет!", "${managerName}, обрати внимание"). If the name is unknown or empty, use a polite gender-neutral fallback like "Коллега".
2. Clearly state the order number: #${orderId}.
3. Explain the violation simply and naturally based on the rule name ("${ruleName}") and details ("${details}"). No technical jargon. Make it sound like a human noticed it.
4. Mention the penalty: -${points} points.
5. Add a motivational or educational ending (e.g., "Такие нарушения снижают общий рейтинг отдела. Пожалуйста, будь внимательнее в будущем").
6. The tone must be empathetic but firm. NEVER BE ROBOTIC. 
7. DO NOT use Markdown bolding/italics excessively. Keep it clean.
8. VARY YOUR RESPONSES. Do not use the exact same template every time. Change the opening, the phrasing, and the closing.

Example 1:
"Оль, по заказу №45818 я нашла нарушение. Ты перевела в статус 'Заявка квалифицирована', но не заполнила данные клиента. Обрати, пожалуйста, на это внимание. Списано 10 баллов. Такие ситуации снижают рейтинг всего отдела."

Example 2:
"Саша, привет! Посмотрела заказ №1234. Вижу, что сделка висит без звонка слишком долго. Пришлось списать 5 баллов. Давай не забывать про регламент, чтобы мы держали качество на высоте!"

Generate the message now for manager "${managerName}" regarding order "${orderId}".
    `;

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `Rule: ${ruleName}\nDetails: ${details}\nPoints: ${points}` }
            ],
            temperature: 0.7, // Higher temperature for variety
        });

        const content = completion.choices[0].message.content;
        if (!content) throw new Error('No content from LLM');

        return content.trim();
    } catch (e) {
        console.error('Human Notification Generation Error:', e);
        // Fallback to strict template if AI fails
        return `⚠️ Коллега, зафиксировано нарушение по заказу #${orderId}.\nПравило: ${ruleName}\nПодробности: ${details}\nШтраф: ${points} баллов.`;
    }
}
