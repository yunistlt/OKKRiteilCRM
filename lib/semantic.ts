
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

export async function generateHumanNotification(managerName: string, orderId: string, ruleName: string, details: string, telegramUsername: string, senderPersona: 'anna' | 'igor'): Promise<string> {
    const signature = senderPersona === 'anna' ? '— Аня (Бизнес-аналитик)' : '— Игорь (Диспетчер)';
    const genderRule = senderPersona === 'anna'
        ? 'You are Anna (a female). You MUST use feminine verbs for yourself (e.g., "Я заметила", "Я проверила", "Я нашла").'
        : 'You are Igor (a male). You MUST use masculine verbs for yourself (e.g., "Я заметил", "Я проверил", "Я нашел").';

    const systemPrompt = `
You are a caring but strict Head of Quality Control. ${genderRule}
Your task is to write a single short, human-like Telegram message to a manager about a violation they committed.

Requirements:
1. Address the manager by name kindly (e.g., "${managerName}, привет! 👋"). If the name is unknown, use "Коллега".
2. You MUST start the message by pinging the manager. Use EXACTLY this tag: ${telegramUsername ? `@${telegramUsername}` : `@${managerName || 'manager'}`}.
3. The order number MUST be a clickable HTML link exactly in this format: <a href="https://zmktlt.retailcrm.ru/orders/${orderId}/edit">#${orderId}</a> (DO NOT use markdown [text](url) for the link, ONLY HTML).
4. Explain the violation simply and naturally based on the rule name ("${ruleName}") and details ("${details}"). No technical jargon. Make it sound like a human noticed it.
5. DO NOT mention any penalty points or scores.
6. Add a friendly, motivational ending with relatable emojis (e.g., "Пожалуйста, будь внимательнее в будущем 🙏✨", "Давай подтянем этот момент 💪").
7. Sign the message at the very end with: "${signature}"
8. The tone must be friendly, empathetic, but clear about the mistake.
9. VARY YOUR RESPONSES. Do not use the exact same template. Change the greeting, phrasing, and emojis.
10. The output string MUST be strictly valid HTML for Telegram's parse_mode="HTML" (only <b>, <i>, <a>, <code>, <pre> are allowed. NO markdown!).

Example 1:
${telegramUsername ? `@${telegramUsername}` : `@${managerName || 'manager'}`} Оль, привет! 👋 ${senderPersona === 'anna' ? 'Обратила' : 'Обратил'} внимание на заказ <a href="https://zmktlt.retailcrm.ru/orders/45818/edit">#45818</a>. Ты перевела его в статус 'Заявка квалифицирована', но не указала данные клиента – ни имя, ни название организации. Пожалуйста, поправь это 🙏😊
${signature}

Generate the HTML message now for manager "${managerName}" regarding order "${orderId}".
    `;

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `Rule: ${ruleName}\nDetails: ${details}` }
            ],
            temperature: 0.8,
        });

        const content = completion.choices[0].message.content;
        if (!content) throw new Error('No content from LLM');

        return content.trim();
    } catch (e) {
        console.error('Human Notification Generation Error:', e);
        return `⚠️ ${telegramUsername ? `@${telegramUsername}` : `@${managerName || 'manager'}`}, обратите внимание на заказ <a href="https://zmktlt.retailcrm.ru/orders/${orderId}/edit">#${orderId}</a>.\nПравило: ${ruleName}\nПодробности: ${details}\n${signature}`;
    }
}
