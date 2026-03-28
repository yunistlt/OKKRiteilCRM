/**
 * lib/reactivation-db.ts
 * Supabase helpers for AI Reactivation campaigns & outreach logs
 */

import { supabase } from '@/utils/supabase';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface CampaignFilters {
    b2b_only?: boolean;
    months?: number;         // давность последнего заказа
    min_ltv?: number;        // мин. общая сумма (LTV)
    min_orders?: number;     // мин. кол-во заказов
    max_orders?: number;     // макс. кол-во заказов
    min_avg_check?: number;  // мин. средний чек
    max_avg_check?: number;  // макс. средний чек
    statuses?: string[];     // фильтр по статусу заказов
    custom_fields?: Array<{ field: string; value: string }>; // пользовательские поля
}

export interface CampaignSettings {
    victoria_prompt?: string;    // промпт агента-писателя
    reply_prompt?: string;       // промпт агента-ответчика (при on_positive=send_reply)
    email_subject?: string;      // шаблон темы (напр. "Re: Заказ #{{ order_number }}")
    on_positive?: 'create_order' | 'send_reply'; // действие при POSITIVE-ответе
    new_order_status?: string;   // статус нового заказа (напр. "new")
}

export interface ReactivationCampaign {
    id: string;
    title: string;
    status: 'active' | 'paused' | 'completed';
    filters: CampaignFilters;
    settings: CampaignSettings;
    created_at: string;
}

export interface OutreachLog {
    id: string;
    campaign_id: string;
    customer_id: number;
    company_name: string | null;
    customer_email: string | null;
    generated_email: string | null;
    status: 'pending' | 'processing' | 'awaiting_approval' | 'approved' | 'sent' | 'replied' | 'rejected' | 'error';
    justification: string | null;
    client_reply: string | null;
    intent_status: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | null;
    sent_at: string | null;
    opened_at: string | null;
    replied_at: string | null;
    created_at: string;
}

// ─────────────────────────────────────────────
// Campaigns
// ─────────────────────────────────────────────

export async function getCampaigns(): Promise<ReactivationCampaign[]> {
    const { data, error } = await supabase
        .from('ai_reactivation_campaigns')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data ?? [];
}

export async function getCampaignById(id: string): Promise<ReactivationCampaign | null> {
    const { data, error } = await supabase
        .from('ai_reactivation_campaigns')
        .select('*')
        .eq('id', id)
        .single();

    if (error) return null;
    return data;
}

export async function createCampaign(
    title: string,
    filters: CampaignFilters,
    settings: CampaignSettings = {}
): Promise<ReactivationCampaign> {
    const { data, error } = await supabase
        .from('ai_reactivation_campaigns')
        .insert({ title, filters, settings, status: 'active' })
        .select()
        .single();

    if (error) throw error;
    return data;
}

export async function updateCampaignStatus(
    id: string,
    status: ReactivationCampaign['status']
): Promise<void> {
    const { error } = await supabase
        .from('ai_reactivation_campaigns')
        .update({ status })
        .eq('id', id);

    if (error) throw error;
}

// ─────────────────────────────────────────────
// Outreach Logs — Queue Management
// ─────────────────────────────────────────────

export async function getPendingLogs(limit = 5): Promise<OutreachLog[]> {
    const { data, error } = await supabase
        .from('ai_outreach_logs')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(limit);

    if (error) throw error;
    return data ?? [];
}

export async function setLogsProcessing(ids: string[]): Promise<void> {
    const { error } = await supabase
        .from('ai_outreach_logs')
        .update({ status: 'processing' })
        .in('id', ids);

    if (error) throw error;
}

export async function getApprovedLogs(limit = 5): Promise<OutreachLog[]> {
    const { data, error } = await supabase
        .from('ai_outreach_logs')
        .select('*')
        .eq('status', 'approved')
        .order('created_at', { ascending: true })
        .limit(limit);

    if (error) throw error;
    return data ?? [];
}

export async function markLogSent(id: string, generatedEmail: string): Promise<void> {
    const { error } = await supabase
        .from('ai_outreach_logs')
        .update({
            status: 'sent',
            generated_email: generatedEmail,
            sent_at: new Date().toISOString(),
        })
        .eq('id', id);

    if (error) throw error;
}

export async function markLogError(id: string, errorMsg: string): Promise<void> {
    const { error } = await supabase
        .from('ai_outreach_logs')
        .update({
            status: 'error',
            client_reply: `ERROR: ${errorMsg}`,
        })
        .eq('id', id);

    if (error) throw error;
}

export async function markLogReplied(
    id: string,
    clientReply: string,
    intentStatus: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'
): Promise<void> {
    const { error } = await supabase
        .from('ai_outreach_logs')
        .update({
            status: 'replied',
            client_reply: clientReply,
            intent_status: intentStatus,
            replied_at: new Date().toISOString(),
        })
        .eq('id', id);

    if (error) throw error;
}

export async function markLogOpened(customerId: number): Promise<void> {
    const { error } = await supabase
        .from('ai_outreach_logs')
        .update({
            opened_at: new Date().toISOString(),
        })
        .eq('customer_id', customerId)
        .eq('status', 'sent')
        .is('opened_at', null);

    if (error) throw error;
}

/**
 * Отмечает прочтение по ID лога (используется пикселем отслеживания)
 */
export async function markLogOpenedById(id: string): Promise<void> {
    const { error } = await supabase
        .from('ai_outreach_logs')
        .update({
            opened_at: new Date().toISOString(),
        })
        .eq('id', id)
        .is('opened_at', null);

    if (error) throw error;
}

// ─────────────────────────────────────────────
// Logs — Query & Stats
// ─────────────────────────────────────────────

export async function getLogs(opts: {
    campaign_id?: string;
    status?: string;
    page?: number;
    limit?: number;
}): Promise<{ data: OutreachLog[]; total: number }> {
    const page = opts.page ?? 1;
    const limit = opts.limit ?? 50;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase
        .from('ai_outreach_logs')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);

    if (opts.campaign_id) query = query.eq('campaign_id', opts.campaign_id);
    if (opts.status) query = query.eq('status', opts.status);

    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data ?? [], total: count ?? 0 };
}

export async function getLogByCustomerId(customerId: number): Promise<OutreachLog | null> {
    const { data } = await supabase
        .from('ai_outreach_logs')
        .select('*')
        .eq('customer_id', customerId)
        .eq('status', 'sent')
        .order('sent_at', { ascending: false })
        .limit(1)
        .single();

    return data ?? null;
}

export async function createOutreachLog(opts: {
    campaign_id: string;
    customer_id: number;
    company_name?: string;
    customer_email?: string;
}): Promise<OutreachLog> {
    const { data, error } = await supabase
        .from('ai_outreach_logs')
        .insert({
            campaign_id: opts.campaign_id,
            customer_id: opts.customer_id,
            company_name: opts.company_name ?? null,
            customer_email: opts.customer_email ?? null,
            status: 'pending',
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

// ─────────────────────────────────────────────
// Stats
// ─────────────────────────────────────────────

export interface ReactivationStats {
    total_sent: number;
    total_replied: number;
    total_positive: number;
    reply_rate: number;   // %
    conversion_rate: number; // %
}

export async function getStats(campaignId?: string): Promise<ReactivationStats> {
    let query = supabase
        .from('ai_outreach_logs')
        .select('status, intent_status');

    if (campaignId) query = query.eq('campaign_id', campaignId);

    const { data, error } = await query;
    if (error) throw error;

    const rows = data ?? [];
    const total_sent = rows.filter(r => ['sent', 'replied'].includes(r.status)).length;
    const total_replied = rows.filter(r => r.status === 'replied').length;
    const total_positive = rows.filter(r => r.intent_status === 'POSITIVE').length;
    const reply_rate = total_sent > 0 ? Math.round((total_replied / total_sent) * 100) : 0;
    const conversion_rate = total_sent > 0 ? Math.round((total_positive / total_sent) * 100) : 0;

    return { total_sent, total_replied, total_positive, reply_rate, conversion_rate };
}

export async function deleteCampaign(id: string): Promise<void> {
    // 1. Удаляем логи рассылки
    const { error: logsError } = await supabase
        .from('ai_outreach_logs')
        .delete()
        .eq('campaign_id', id);
    
    if (logsError) throw logsError;

    // 2. Удаляем саму кампанию
    const { error: campaignError } = await supabase
        .from('ai_reactivation_campaigns')
        .delete()
        .eq('id', id);

    if (campaignError) throw campaignError;
}
