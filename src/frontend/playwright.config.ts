import { defineConfig, devices } from "@playwright/test";

// E2E config for the Anchor app. Assumes the production server is already
// running on http://localhost:3000 (make build && make start) and the FastAPI
// backend on 127.0.0.1:8001 (proxied via the Next.js /api rewrite).
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e/report" }]],
  use: {
    baseURL: "http://localhost:3000",
    // Auto-grant camera/mic for the "Who is this?" flow.
    permissions: ["camera", "microphone"],
    // Block the PWA service worker so cached assets can't make tests flaky.
    serviceWorkers: "block",
    trace: "retain-on-failure",
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
