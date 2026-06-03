const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  fallbacks: {
    document: '/offline',
  },
  runtimeCaching: [
    {
      urlPattern: ({ url }) => url.origin === self.origin && url.pathname.startsWith('/api/'),
      handler: 'NetworkOnly',
      method: 'GET',
      options: {},
    },
    ...require('next-pwa/cache').filter((entry) => entry.options?.cacheName !== 'apis'),
  ],
  disable: process.env.NODE_ENV === 'development',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['docx']
  }
}

module.exports = withPWA(nextConfig)
