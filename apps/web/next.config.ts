import type { NextConfig } from "next";

const appRoot = process.cwd();

const nextConfig: NextConfig = {
  // Docker builds assign a unique ID so tabs from an older image hard-reload
  // instead of submitting stale Server Action identifiers to the new server.
  deploymentId: process.env.NEXT_DEPLOYMENT_ID,
  experimental: {
    serverActions: {
      // The product accepts 25 MiB PDFs. Leave multipart/form-data headroom
      // so application validation can return a useful error instead of a 413.
      bodySizeLimit: "32mb",
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
