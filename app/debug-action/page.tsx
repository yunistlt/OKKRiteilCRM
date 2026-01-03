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
        <div style={{ padding: 40, fontFamily: 'monospace' }}>
            <h1>Server Action Isolation Test</h1>
            <button
                onClick={handleTest}
                style={{ padding: '10px 20px', fontSize: 16, cursor: 'pointer' }}
            >
                Test Write 'novyi-1'
            </button>
            <pre style={{ marginTop: 20, background: '#eee', padding: 10 }}>
                {result}
            </pre>
            <p>Check browser console AND status_settings table.</p>
        </div>
    );
}
