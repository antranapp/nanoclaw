import type { NextConfig } from "next";
import path from "path";

const backendUrl = process.env.BACKEND_URL;

// __dirname = webui/ directory (CJS context, no "type":"module" in package.json)
const webuiDir = path.resolve(__dirname);

const nextConfig: NextConfig = {
  turbopack: {
    // Fix: prevent Next.js from using the parent nanoclaw/ directory as workspace
    // root (which causes it to look for tailwindcss in the wrong node_modules)
    root: webuiDir,
  },
  webpack(config) {
    // Fix the same issue for the webpack pipeline (used for SSR even in Turbopack mode)
    const webuiModules = path.join(webuiDir, "node_modules");
    const existing: string[] = config.resolve?.modules ?? ["node_modules"];
    if (!existing.includes(webuiModules)) {
      config.resolve.modules = [webuiModules, ...existing];
    }
    return config;
  },
  ...(backendUrl
    ? {
        async rewrites() {
          return {
            // beforeFiles runs before route handlers so it takes precedence
            // over any app/api/* route.ts files
            beforeFiles: [
              {
                source: "/api/:path*",
                destination: `${backendUrl}/api/:path*`,
              },
            ],
            afterFiles: [],
            fallback: [],
          };
        },
      }
    : {}),
};

export default nextConfig;
