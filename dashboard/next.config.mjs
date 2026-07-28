/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages ship raw TypeScript — Next must transpile them (eng review #13).
  // '@yield/scenario' (+ its pure deps) powers ?demo=90d, which replays the 90-day simulation
  // CLIENT-SIDE through the real components. '@yield/agent' is listed ONLY so the two pure engine
  // files sim.ts deep-imports (decision/engine, exposure/engine) get transpiled — the agent barrel
  // (Circle SDK, node:fs/http) is never imported and never enters the bundle.
  transpilePackages: ['@yield/shared', '@yield/scenario', '@yield/forecast', '@yield/agent'],
  webpack: (config) => {
    // The workspaces use NodeNext-style specifiers ("./sim.js" meaning sim.ts). tsx and tsc map
    // them natively; webpack needs the mapping stated. '.js' first, so ordinary JS packages in
    // node_modules resolve exactly as before and the .ts fallback only fires when no .js exists.
    config.resolve.extensionAlias = { '.js': ['.js', '.ts', '.tsx'] };
    return config;
  },
};

export default nextConfig;
