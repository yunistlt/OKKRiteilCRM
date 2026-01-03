import { supabase } from '@/utils/supabase';

// Force dynamic rendering so it runs on every request
export const dynamic = 'force-dynamic';

export default async function DebugPage() {
    let diagnosticStep = 'Init';
    let readResult = null;
    let writeResult = null;
    let envCheck = {
        url: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        key: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    };

    try {
        diagnosticStep = 'Reading Statuses';
        const { data: statuses, error: readError } = await supabase
            .from('statuses')
            .select('*')
            .limit(1);

        readResult = readError ? `ERROR: ${readError.message}` : `SUCCESS: Found ${statuses?.length} rows`;

        if (!readError && statuses && statuses.length > 0) {
            diagnosticStep = 'Writing Setting';
            const code = statuses[0].code;
            const { data, error: writeError } = await supabase
                .from('status_settings')
                .upsert({
                    code: code,
                    is_working: true,
                    updated_at: new Date().toISOString()
                })
                .select();

            writeResult = writeError ? `ERROR: ${writeError.message}` : `SUCCESS: Wrote ${JSON.stringify(data)}`;
        } else {
            writeResult = 'SKIPPED: No statuses found to test write.';
        }

    } catch (e: any) {
        diagnosticStep = `CRASH: ${e.message}`;
    }

    return (
        <div style={{ padding: 40, fontFamily: 'monospace', maxWidth: 800, margin: '0 auto' }}>
            <h1>Server-Side Database Diagnostics</h1>

            <div style={{ marginBottom: 20, padding: 10, backgroundColor: '#e3f2fd' }}>
                <strong>Environment Check:</strong>
                <ul>
                    <li>URL Defined: {envCheck.url ? 'YES' : 'NO'}</li>
                    <li>Key Defined: {envCheck.key ? 'YES' : 'NO'}</li>
                </ul>
            </div>

            <div style={{ backgroundColor: '#f5f5f5', padding: 20, borderRadius: 8, border: '1px solid #ddd' }}>
                <p><strong>Step:</strong> {diagnosticStep}</p>
                <div style={{ margin: '10px 0', borderBottom: '1px solid #ccc' }}></div>
                <p><strong>Read Test:</strong> {readResult}</p>
                <p><strong>Write Test:</strong> {writeResult}</p>
            </div>

            <p style={{ marginTop: 20, color: '#666' }}>
                Refresh this page to re-run the server-side test.
            </p>
        </div>
    );
}
