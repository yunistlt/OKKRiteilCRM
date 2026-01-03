'use client';

import { useEffect } from 'react';

export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('Page Error:', error);
    }, [error]);

    return (
        <div style={{ padding: 40, fontFamily: 'sans-serif' }}>
            <h2 style={{ color: 'red' }}>Что-то пошло не так</h2>
            <p style={{ color: '#666' }}>{error.message}</p>
            <button
                onClick={() => reset()}
                style={{
                    marginTop: 20,
                    padding: '10px 20px',
                    background: '#0070f3',
                    color: 'white',
                    border: 'none',
                    borderRadius: 4,
                    cursor: 'pointer'
                }}
            >
                Попробовать снова
            </button>
        </div>
    );
}
