import type { NextConfig } from "next";

const appRoot = process.cwd();

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "26mb",
    },
  },
  outputFileTracingRoot: appRoot,
  reactCompiler: true,
  turbopack: {
    ignoreIssue: [
      {
        path: "**/next.config.ts",
        title: "Encountered unexpected file in NFT list",
      },
    ],
    root: appRoot,
  },
};

export default nextConfig;
