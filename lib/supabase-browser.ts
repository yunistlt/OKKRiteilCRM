import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let browserClient: SupabaseClient | null = null;

function getBrowserSupabaseClient() {
    if (browserClient) {
        return browserClient;
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('Supabase browser env is not configured');
    }

    browserClient = createClient(supabaseUrl, supabaseAnonKey);
    return browserClient;
}

export async function uploadFileToSignedStorageUrl({
    bucket,
    filePath,
    token,
    file,
    upsert,
}: {
    bucket: string;
    filePath: string;
    token: string;
    file: File;
    upsert?: boolean;
}) {
    const { error } = await getBrowserSupabaseClient()
        .storage
        .from(bucket)
        .uploadToSignedUrl(filePath, token, file, {
            upsert,
            contentType: file.type,
        });

    if (error) {
        throw error;
    }
}