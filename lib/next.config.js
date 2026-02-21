/** @type {import('next').NextConfig} */
const nextConfig = {
  // Force server build output (prevents "export" behavior)
  output: "standalone",
};

module.exports = nextConfig;
