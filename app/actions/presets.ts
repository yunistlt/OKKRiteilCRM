'use server';

import { supabase } from '@/utils/supabase'; // Uses service role key from utils

export interface Preset {
    id: string;
    name: string;
    filters: any;
    created_at: string;
}

export async function getPresets() {
    try {
        const { data, error } = await supabase
            .from('dashboard_presets')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        return { success: true, data: data as Preset[] };
    } catch (e: any) {
        console.error('getPresets Error:', e);
        // Return empty if table likely doesn't exist yet to avoid crashing UI completely
        if (e.message?.includes('does not exist')) return { success: true, data: [] };
        return { success: false, error: e.message };
    }
}

export async function savePreset(name: string, filters: any) {
    try {
        const { data, error } = await supabase
            .from('dashboard_presets')
            .insert([{ name, filters }])
            .select()
            .single();

        if (error) throw error;
        return { success: true, data };
    } catch (e: any) {
        console.error('savePreset Error:', e);
        return { success: false, error: e.message };
    }
}

export async function deletePreset(id: string) {
    try {
        const { error } = await supabase
            .from('dashboard_presets')
            .delete()
            .eq('id', id);

        if (error) throw error;
        return { success: true };
    } catch (e: any) {
        console.error('deletePreset Error:', e);
        return { success: false, error: e.message };
    }
}
