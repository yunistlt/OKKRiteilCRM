// ОТВЕТСТВЕННЫЙ: ИГОРЬ (Диспетчер) — Логирование активности агентов и мониторинг здоровья системы.
import { supabase } from '@/utils/supabase';

export type AgentId = 'anna' | 'maxim' | 'igor' | 'semen';
export type AgentStatus = 'idle' | 'working' | 'busy' | 'offline';

export async function logAgentActivity(agentId: AgentId, status: AgentStatus, taskDescription: string) {
    const info: Record<AgentId, { name: string; role: string }> = {
        anna: { name: 'Анна', role: 'Бизнес-аналитик' },
        maxim: { name: 'Максим', role: 'Аудитор' },
        semen: { name: 'Семён', role: 'Архивариус' },
        igor: { name: 'Игорь', role: 'Диспетчер' }
    };

    try {
        const { error } = await supabase
            .from('okk_agent_status')
            .upsert({
                agent_id: agentId,
                name: info[agentId].name,
                role: info[agentId].role,
                status: status,
                current_task: taskDescription,
                last_active_at: new Date().toISOString()
            }, { onConflict: 'agent_id' });

        if (error) {
            console.warn(`[AgentLogger] Failed to update status for ${agentId}:`, error.message);
        }
    } catch (e) {
        // Fail silently to not break main business logic
        console.error(`[AgentLogger] Critical error for ${agentId}:`, e);
    }
}
