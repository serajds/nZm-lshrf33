import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { VitePWA } from "vite-plugin-pwa";

const isBuild = process.argv.includes("build");

const port = Number(process.env.PORT || (isBuild ? "3000" : ""));
if (!isBuild && (!port || Number.isNaN(port) || port <= 0)) {
  throw new Error(
    `PORT environment variable is required but was not provided or invalid.`,
  );
}

const basePath = process.env.BASE_PATH || "/";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "favicon.svg",
        "apple-touch-icon.png",
        "opengraph.jpg",
        "pwa-72x72.png",
        "pwa-96x96.png",
        "pwa-128x128.png",
        "pwa-144x144.png",
        "pwa-152x152.png",
        "pwa-384x384.png",
      ],
      workbox: {
        // Precache only the app shell (HTML, CSS, the framework chunk, and
        // icons). Heavy vendor chunks (recharts, leaflet, xlsx) and
        // per-page chunks are NOT precached — they're cached on first use
        // by the runtime cache below. This keeps the install download
        // small (~200 KB instead of ~2.5 MB) so the first visit is fast.
        globPatterns: ["**/*.{css,html,svg,ico,woff2}", "assets/index-*.js", "assets/vendor-react-*.js"],
        navigateFallbackDenylist: [
          new RegExp("^" + basePath.replace(/\/$/, "") + "/api"),
          /^\/api/,
        ],
        // Custom push + notificationclick handlers live in public/push-handler.js
        // and are loaded into the generated workbox SW at runtime. The path
        // is resolved relative to the SW's scope, which is always `basePath`,
        // so we strip the leading slash and let the browser join it correctly
        // even when basePath ≠ "/".
        importScripts: [(basePath.endsWith("/") ? basePath : basePath + "/") + "push-handler.js"],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        runtimeCaching: [
          // Per-page + vendor JS chunks: cache on first use. Subsequent visits
          // are instant.
          {
            urlPattern: /\/assets\/.*\.(?:js|css)$/,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "asset-chunks",
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api"),
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              networkTimeoutSeconds: 10,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
      manifest: {
        id: basePath,
        name: "ادارة الاشراف والمتابعة",
        short_name: "ادارة الاشراف والمتابعة",
        description:
          "نظام إدارة الإشراف والمتابعة للمشاريع الإنشائية - متابعة التقدم والأنشطة والتقارير",
        theme_color: "#1f4d8b",
        background_color: "#ffffff",
        display: "standalone",
        display_override: ["standalone", "minimal-ui"],
        orientation: "any",
        lang: "ar",
        dir: "rtl",
        start_url: basePath,
        scope: basePath,
        prefer_related_applications: false,
        icons: [
          { src: "pwa-72x72.png", sizes: "72x72", type: "image/png", purpose: "any" },
          { src: "pwa-96x96.png", sizes: "96x96", type: "image/png", purpose: "any" },
          { src: "pwa-128x128.png", sizes: "128x128", type: "image/png", purpose: "any" },
          { src: "pwa-144x144.png", sizes: "144x144", type: "image/png", purpose: "any" },
          { src: "pwa-152x152.png", sizes: "152x152", type: "image/png", purpose: "any" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "pwa-384x384.png", sizes: "384x384", type: "image/png", purpose: "any" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          {
            src: "pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: import.meta.dirname,
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // Split heavy third-party libraries into their own chunks so they don't
    // get pulled into the initial bundle alongside the framework code, and
    // so a single page that uses xlsx/leaflet doesn't drag the rest of
    // the app down with it.
    rollupOptions: {
      output: {
        // Split stable third-party libraries into dedicated chunks. They
        // change rarely, so the browser caches them across deploys — only
        // the small index.js (your own code) is re-downloaded on updates.
        // Without this, every redeploy busted a 484 KB main bundle that
        // contained ALL of @tanstack/react-query + the entire orval API
        // surface + all Radix primitives + lucide icons + sonner.
        manualChunks(id) {
          if (!id.includes("node_modules") && !id.includes("/lib/api-client-react/")) {
            return undefined;
          }
          if (id.includes("/lib/api-client-react/") || id.includes("@workspace/api-client-react")) {
            return "vendor-api";
          }
          if (id.includes("@tanstack/react-query")) return "vendor-rq";
          if (id.includes("@radix-ui/")) return "vendor-radix";
          if (id.includes("lucide-react")) return "vendor-icons";
          if (id.includes("sonner")) return "vendor-toast";
          if (id.includes("recharts") || id.includes("d3-")) return "vendor-charts";
          if (id.includes("leaflet")) return "vendor-leaflet";
          if (id.includes("xlsx")) return "vendor-xlsx";
          if (id.includes("framer-motion")) return "vendor-motion";
          if (id.includes("@dnd-kit/")) return "vendor-dnd";
          if (id.includes("/react-dom/") || id.includes("/react/") || id.includes("/wouter/") || id.includes("scheduler")) {
            return "vendor-react";
          }
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 800,
  },
  // Pre-bundle heavy dependencies at dev-server startup instead of on-demand
  // when the user lands on the page that needs them. This eliminates the
  // multi-second pause the user sees the first time a page imports recharts,
  // leaflet, xlsx, framer-motion, etc.
  //
  // CRITICAL: by default Vite does NOT pre-bundle workspace packages — it
  // serves them as raw TypeScript that the browser has to transform on every
  // cold page load. `@workspace/api-client-react` is a 180 KB orval-generated
  // file with 27 hooks, imported by 19 different pages/components. Without
  // pre-bundling it, every fresh page load paid a 3-4 second penalty just to
  // re-parse this single workspace package. Forcing it through optimizeDeps
  // makes esbuild bundle + tree-shake it once at startup.
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "wouter",
      "@tanstack/react-query",
      "sonner",
      "lucide-react",
      "date-fns",
      "react-hook-form",
      "zod",
      "@hookform/resolvers/zod",
      "framer-motion",
      "recharts",
      "leaflet",
      "react-leaflet",
      "xlsx",
      "@dnd-kit/core",
      "@dnd-kit/sortable",
      "@dnd-kit/utilities",
      "@workspace/api-client-react",
    ],
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    // Eagerly transform the entry chain at startup so the very first page
    // request doesn't pay the full module-graph compile cost.
    warmup: {
      clientFiles: [
        "./src/main.tsx",
        "./src/App.tsx",
        "./src/components/layout.tsx",
        "./src/hooks/use-auth.tsx",
        "./src/pages/login.tsx",
        "./src/pages/dashboard.tsx",
        "./src/pages/projects/index.tsx",
        "./src/pages/projects/[id].tsx",
      ],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
