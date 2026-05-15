import type { NextConfig } from "next";
import path from "node:path";

// Workspace root: <repo>/ — one level up from ui/. Tells Next.js where the
// real package.json + node_modules root lives so Turbopack can resolve `next`
// at build time, and so standalone bundling preserves the right relative
// structure (server.js lands at .next/standalone/ui/server.js).
const workspaceRoot = path.resolve(process.cwd(), "..");

const nextConfig: NextConfig = {
  devIndicators: false,
  // Bundle into a self-contained server.js so the UI runs without npm-installing
  // workspace deps on the target machine. Required for the `npm i -g golem-agent`
  // story to work end-to-end.
  output: "standalone",
  outputFileTracingRoot: workspaceRoot,
  turbopack: {
    root: workspaceRoot,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:3847/api/:path*",
      },
    ];
  },
};

export default nextConfig;
