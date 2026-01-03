/** @type {import('next').NextConfig} */
const nextConfig = {
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
