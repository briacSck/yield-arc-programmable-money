/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages ship raw TypeScript — Next must transpile them (eng review #13).
  transpilePackages: ['@yield/shared'],
};

export default nextConfig;
