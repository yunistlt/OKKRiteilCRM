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
        <div className="p-4 md:p-12 max-w-3xl mx-auto font-sans min-h-screen bg-gray-50 uppercase-none">
            <div className="mb-8 md:mb-12">
                <h1 className="text-2xl md:text-4xl font-black text-gray-900 tracking-tight leading-tight">Database Diagnostics</h1>
                <p className="text-gray-400 font-bold uppercase text-[10px] md:text-xs tracking-widest mt-2 px-1">Server-Side Health Check</p>
            </div>

            <div className="bg-blue-600 rounded-3xl p-6 md:p-8 shadow-2xl shadow-blue-200 mb-6 md:mb-8 text-white relative overflow-hidden">
                <div className="relative z-10">
                    <h2 className="text-[10px] md:text-xs font-black uppercase tracking-[0.2em] mb-4 opacity-80">Environment Config</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/10">
                            <div className="text-[10px] font-black uppercase tracking-widest opacity-60 mb-1">Supabase URL</div>
                            <div className="text-sm font-bold flex items-center gap-2">
                                <span className={envCheck.url ? "text-green-300" : "text-red-300"}>
                                    {envCheck.url ? "● DEFINED" : "○ MISSING"}
                                </span>
                            </div>
                        </div>
                        <div className="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/10">
                            <div className="text-[10px] font-black uppercase tracking-widest opacity-60 mb-1">Supabase Key</div>
                            <div className="text-sm font-bold flex items-center gap-2">
                                <span className={envCheck.key ? "text-green-300" : "text-red-300"}>
                                    {envCheck.key ? "● DEFINED" : "○ MISSING"}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-white/10 rounded-full blur-3xl"></div>
            </div>

            <div className="bg-white rounded-[32px] md:rounded-[40px] shadow-2xl shadow-gray-200/50 border border-gray-100 p-6 md:p-10 font-mono text-xs md:text-sm">
                <div className="space-y-6">
                    <div>
                        <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 font-sans">Current Step</div>
                        <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 font-bold text-gray-700 break-words line-clamp-2 md:line-clamp-none">
                            {diagnosticStep}
                        </div>
                    </div>

                    <div className="h-px bg-gray-100"></div>

                    <div className="grid grid-cols-1 gap-6">
                        <div>
                            <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 font-sans">Read Test (statuses)</div>
                            <div className={`p-4 rounded-2xl border ${readResult?.includes('ERROR') ? 'bg-red-50 border-red-100 text-red-700' : 'bg-green-50 border-green-100 text-green-700'} font-bold break-words`}>
                                {readResult}
                            </div>
                        </div>

                        <div>
                            <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 font-sans">Write Test (status_settings)</div>
                            <div className={`p-4 rounded-2xl border ${writeResult?.includes('ERROR') ? 'bg-red-50 border-red-100 text-red-700' : writeResult?.includes('SUCCESS') ? 'bg-green-50 border-green-100 text-green-700' : 'bg-gray-50 border-gray-100 text-gray-400'} font-bold break-all md:break-words`}>
                                {writeResult}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="mt-8 text-center px-6">
                <p className="text-gray-400 text-[10px] md:text-xs font-bold uppercase tracking-widest leading-relaxed">
                    Refresh this page to re-run server-side diagnostics.<br />
                    Results are rendered dynamically.
                </p>
            </div>
        </div>
    );
}
