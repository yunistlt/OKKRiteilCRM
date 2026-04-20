import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: 'OKKRiteilCRM',
        short_name: 'OKK CRM',
        description: 'Корпоративная CRM-платформа с мессенджером, аналитикой и внутренними AI-инструментами.',
        start_url: '/messenger',
        display: 'standalone',
        background_color: '#f8fafc',
        theme_color: '#0f172a',
        orientation: 'portrait',
        icons: [
            {
                src: '/favicon-v2.png',
                sizes: '192x192',
                type: 'image/png',
                purpose: 'any',
            },
            {
                src: '/favicon-v2.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'maskable',
            },
        ],
    };
}