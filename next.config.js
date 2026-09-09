/** @type {import('next').NextConfig} */
const nextConfig = {
    // nunjucks (шаблоны документов и писем) тянет за собой chokidar/fsevents — нативный
    // модуль, который webpack не собирает. На сервере он и не нужен как бандл: подключаем
    // как обычную зависимость Node.
    experimental: {
        serverComponentsExternalPackages: ['nunjucks'],
    },
    async redirects() {
        return [
            {
                source: '/statuses',
                destination: '/settings/statuses',
                permanent: true,
            },
        ];
    },
};

module.exports = nextConfig;
