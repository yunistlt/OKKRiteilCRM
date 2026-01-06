'use client';

import { useState } from 'react';
import { toggleStatus } from '../settings/statuses/actions';

export default function DebugActionPage() {
    const [result, setResult] = useState<string>('Ready');

    async function handleTest() {
        setResult('Testing...');
        try {
            console.log('Invoking Server Action...');
            const res = await toggleStatus('novyi-1', true);
            console.log('Result:', res);
            setResult(JSON.stringify(res));
        } catch (e: any) {
            console.error(e);
            setResult(`ERROR: ${e.message}`);
        }
    }

    return (
        <div className="p-4 md:p-12 max-w-3xl mx-auto font-sans min-h-screen bg-gray-50 uppercase-none">
            <div className="mb-8 md:mb-12">
                <h1 className="text-2xl md:text-4xl font-black text-gray-900 tracking-tight leading-tight">Server Action Test</h1>
                <p className="text-gray-400 font-bold uppercase text-[10px] md:text-xs tracking-widest mt-2 px-1">Isolation Testing</p>
            </div>

            <div className="bg-white rounded-[32px] md:rounded-[40px] shadow-2xl shadow-gray-200/50 border border-gray-100 p-6 md:p-10">
                <div className="space-y-8">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                            <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest">Target Status</h3>
                            <p className="text-blue-600 font-bold text-lg">novyi-1</p>
                        </div>
                        <button
                            onClick={handleTest}
                            className="w-full sm:w-auto px-8 py-4 bg-blue-600 text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl shadow-blue-200 hover:bg-blue-700 hover:shadow-lg transition-all active:scale-[0.98]"
                        >
                            Execute Action
                        </button>
                    </div>

                    <div>
                        <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Execution Result</div>
                        <pre className="p-6 bg-gray-50 rounded-2xl border border-gray-100 font-mono text-xs md:text-sm text-gray-700 overflow-x-auto whitespace-pre-wrap break-all min-h-[100px]">
                            {result}
                        </pre>
                    </div>

                    <div className="pt-4 border-t border-gray-100">
                        <p className="text-[10px] md:text-xs text-gray-400 font-bold uppercase tracking-widest leading-relaxed">
                            Check browser console for detailed logs.<br />
                            Verification: check <span className="text-gray-600">status_settings</span> table after execution.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
