/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    // Handle Node.js modules that shouldn't be bundled for the browser
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        dns: false,
        child_process: false,
        encoding: false,
      };

      // Stub out problematic packages that try to use Node.js APIs
      config.resolve.alias = {
        ...config.resolve.alias,
        brotli: false,
      };
    }
    return config;
  },
};

export default nextConfig;
