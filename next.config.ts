import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // Docker builds a self-contained server; Vercel ignores this.
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,
  // Server-only libraries that load files or WASM at runtime stay out of the bundle.
  serverExternalPackages: [
    "@electric-sql/pglite",
    "pg",
    "@citation-js/core",
    "@citation-js/plugin-csl",
    "@citation-js/plugin-bibtex",
    "@citation-js/plugin-ris",
    "fuzzball",
  ],
  // citation-js is loaded through createRequire (one plugin registry), which file tracing
  // cannot follow, so ship it and its dependencies explicitly with every server route.
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/@citation-js/**/*",
      "./node_modules/citeproc/**/*",
      "./node_modules/moo/**/*",
      "./node_modules/sync-fetch-undici/**/*",
      "./node_modules/whatwg-mimetype/**/*",
      "./node_modules/@electric-sql/pglite/dist/**/*",
    ],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
