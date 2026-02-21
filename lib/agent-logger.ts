import { supabase } from '@/utils/supabase';

export type AgentId = 'anna' | 'maxim' | 'igor' | 'semen';
export type AgentStatus = 'idle' | 'working' | 'busy' | 'offline';

export async function logAgentActivity(agentId: AgentId, status: AgentStatus, taskDescription: string) {
    try {
        const { error } = await supabase
            .from('okk_agent_status')
            .upsert({
                agent_id: agentId,
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
