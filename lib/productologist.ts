import { supabase } from '@/utils/supabase';
import OpenAI from 'openai';

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
    if (!_openai) {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) throw new Error('OPENAI_API_KEY is missing in env');
        _openai = new OpenAI({ apiKey });
    }
    return _openai;
}

export interface ProductKnowledge {
    sku?: string;
    name: string;
    category: string;
    description: string;
    tech_specs: Record<string, any>;
    source_url: string;
    use_cases: string[];
    solved_tasks: string[];
    pain_points: string[];
}

export class Productologist {
    
    static async findUnstudiedProducts(limit = 10): Promise<string[]> {
        const { data: orders, error } = await supabase
            .from('orders')
            .select('raw_payload')
            .order('created_at', { ascending: false })
            .limit(100);

        if (error) {
            console.error('[Elena] DB Error fetching orders:', error);
            return [];
        }

        const uniqueNames = new Set<string>();
        orders?.forEach(o => {
            (o.raw_payload.items || []).forEach((item: any) => {
                if (item.offer?.name) uniqueNames.add(item.offer.name);
            });
        });

        const namesArray = Array.from(uniqueNames);
        const { data: existing } = await supabase
            .from('product_knowledge')
            .select('name')
            .in('name', namesArray);

        const existingNames = new Set(existing?.map(e => e.name) || []);
        return namesArray.filter(name => !existingNames.has(name)).slice(0, limit);
    }

    static async studyProduct(name: string): Promise<ProductKnowledge | null> {
        console.log(`[Elena] Studying product: ${name}`);

        const searchUrl = `https://zmktlt.ru/search/?q=${encodeURIComponent(name)}`;
        
        try {
            const res = await fetch(searchUrl);
            if (!res.ok) throw new Error(`Search request failed with status ${res.status}`);
            
            const html = await res.text();

            const completion = await getOpenAI().chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { 
                        role: 'system', 
                        content: `Ты ЕЛЕНА — Продуктолог компании ЗМК. Твое задание — изучить текст страницы и составить ТЕХНИЧЕСКИЙ и МАРКЕТИНГОВЫЙ ПАСПОРТ товара.
                        Определи: 
                        1. Категорию (Шкаф для одежды, Сушильный шкаф, Стеллаж, Верстак и т.д.)
                        2. Технические характеристики (габариты, вес, материал, особенности) в формате JSON.
                        3. Сценарии использования (use_cases) — где и кем применяется.
                        4. Решаемые задачи (solved_tasks) — какую пользу несет.
                        5. Боли клиентов (pain_points) — какие проблемы решаются покупкой этого товара.
                        6. Полное описание.
                        
                        Будь экспертной. Не путай обычные шкафы с сушильными!
                        Ответ верни строго в JSON.`
                    },
                    { role: 'user', content: `Контент страницы для товара "${name}":\n\n${html.substring(0, 10000)}` }
                ],
                response_format: { type: 'json_object' }
            });

            const rawContent = completion.choices[0].message.content;
            if (!rawContent) throw new Error('Empty response from OpenAI');

            const result = JSON.parse(rawContent);

            return {
                name,
                category: result.category || 'Не определено',
                description: result.description || '',
                tech_specs: result.tech_specs || {},
                use_cases: result.use_cases || [],
                solved_tasks: result.solved_tasks || [],
                pain_points: result.pain_points || [],
                source_url: searchUrl 
            };

        } catch (error: any) {
            console.error(`[Elena] Critical error studying "${name}":`, error.message || error);
            return null;
        }
    }

    static async saveToKnowledgeBase(data: ProductKnowledge) {
        try {
            const { error } = await supabase
                .from('product_knowledge')
                .upsert({
                    name: data.name,
                    category: data.category,
                    description: data.description,
                    tech_specs: data.tech_specs,
                    use_cases: data.use_cases,
                    solved_tasks: data.solved_tasks,
                    pain_points: data.pain_points,
                    source_url: data.source_url,
                    last_studied_at: new Date().toISOString()
                }, { onConflict: 'name' });

            if (error) throw error;
        } catch (e: any) {
            console.error(`[Elena] DB Error saving knowledge for "${data.name}":`, e.message || e);
            throw e;
        }
    }

    static async ensureKnowledge(name: string): Promise<void> {
        try {
            const { data: existing } = await supabase
                .from('product_knowledge')
                .select('id')
                .eq('name', name)
                .single();

            if (!existing) {
                const report = await this.studyProduct(name);
                if (report) {
                    await this.saveToKnowledgeBase(report);
                }
            }
        } catch (e: any) {
            console.error(`[Elena] ensureKnowledge failed for "${name}":`, e.message || e);
        }
    }
}
