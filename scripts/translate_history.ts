import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';
import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

async function translateText(text: string) {
    if (!text || text.trim() === '') return text;

    // Quick check if text likely contains English (directions or AI reasoning)
    if (!/[a-zA-Z]/.test(text)) return text;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: "Translate the following CRM violation detail to Russian. Keep numbers and technical IDs as is. Translate 'incoming' to 'входящий', 'outgoing' to 'исходящий'. Output ONLY the translated text."
                },
                { role: "user", content: text }
            ],
            temperature: 0,
        });
        return response.choices[0].message.content?.trim() || text;
    } catch (e) {
        console.error('Translation failed for:', text, e);
        return text;
    }
}

async function main() {
    console.log('Fetching violations to translate...');
    const { data: violations, error } = await supabase
        .from('okk_violations')
        .select('id, details')
        .order('violation_time', { ascending: false });

    if (error) {
        console.error('Error fetching violations:', error);
        return;
    }

    console.log(`Found ${violations.length} violations. Processing...`);

    let updated = 0;
    for (const v of violations) {
        const translated = await translateText(v.details);
        if (translated !== v.details) {
            const { error: updError } = await supabase
                .from('okk_violations')
                .update({ details: translated })
                .eq('id', v.id);

            if (updError) {
                console.error(`Error updating violation ${v.id}:`, updError);
            } else {
                updated++;
                if (updated % 10 === 0) console.log(`Translated ${updated} records...`);
            }
        }
    }

    console.log(`Done! Translated ${updated} records.`);
}

main();
