/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // Use environment variable for backend URL, fallback to localhost for development
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
    
    return [
      {
        source: '/runs/:path*',
        destination: `${backendUrl}/runs/:path*`,
      },
      {
        source: '/runs-files/:path*',
        destination: `${backendUrl}/runs-files/:path*`,
      },
      {
        source: '/health',
        destination: `${backendUrl}/health`,
      },
      {
        source: '/openapi.json',
        destination: `${backendUrl}/openapi.json`,
      },
    ];
  },
};

module.exports = nextConfig;

