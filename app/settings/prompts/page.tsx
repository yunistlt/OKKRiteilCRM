'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Loader2, Save, Play } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

interface AiPrompt {
    key: string;
    description: string;
    system_prompt: string;
    model: string;
    updated_at: string;
}

export default function AiPromptsPage() {
    const [prompts, setPrompts] = useState<AiPrompt[]>([]);
    const [loading, setLoading] = useState(true);
    const [testing, setTesting] = useState(false);
    const { toast } = useToast();

    // Fetch prompts on load
    useEffect(() => {
        fetchPrompts();
    }, []);

    const fetchPrompts = async () => {
        try {
            const res = await fetch('/api/settings/prompts');
            const data = await res.json();
            if (Array.isArray(data)) {
                setPrompts(data);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (prompt: AiPrompt) => {
        try {
            const res = await fetch('/api/settings/prompts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(prompt)
            });
            if (!res.ok) throw new Error('Failed to save');

            toast({
                title: "Сохранено",
                description: `Промпт ${prompt.key} обновлен`,
            });
            fetchPrompts(); // Refresh to get correct updated_at
        } catch (e) {
            toast({
                title: "Ошибка",
                description: "Не удалось сохранить промпт",
                variant: "destructive"
            });
        }
    };

    const updatePromptText = (key: string, text: string) => {
        setPrompts(prompts.map(p => p.key === key ? { ...p, system_prompt: text } : p));
    };

    if (loading) return <div className="flex justify-center p-10"><Loader2 className="animate-spin h-8 w-8" /></div>;

    return (
        <div className="container mx-auto py-10 space-y-8">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Настройки ИИ (AI Settings)</h1>
                    <p className="text-muted-foreground">Управление системными промптами и логикой агентов.</p>
                </div>
            </div>

            <div className="grid gap-6">
                {prompts.map((prompt) => (
                    <Card key={prompt.key}>
                        <CardHeader>
                            <CardTitle className="flex justify-between items-center">
                                <span>{prompt.description || prompt.key}</span>
                                <span className="text-xs font-mono bg-muted p-1 rounded">{prompt.model}</span>
                            </CardTitle>
                            <CardDescription className="font-mono text-xs text-muted-foreground">
                                KEY: {prompt.key} | Last Updated: {new Date(prompt.updated_at).toLocaleString('ru-RU')}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-2">
                                <label className="text-sm font-medium">System Prompt</label>
                                <Textarea
                                    className="min-h-[300px] font-mono text-sm leading-relaxed"
                                    value={prompt.system_prompt}
                                    onChange={(e) => updatePromptText(prompt.key, e.target.value)}
                                />
                            </div>
                            <div className="flex justify-end space-x-2">
                                <Button onClick={() => handleSave(prompt)} className="flex items-center gap-2">
                                    <Save className="h-4 w-4" /> Сохранить
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                ))}

                {prompts.length === 0 && (
                    <div className="text-center p-10 border rounded-lg border-dashed">
                        Нет доступных промптов в базе данных. Проверьте миграции.
                    </div>
                )}
            </div>
        </div>
    );
}
