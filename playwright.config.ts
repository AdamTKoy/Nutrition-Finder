// config for testing browser functionality
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",

  use: {
    baseURL: "http://127.0.0.1:3100",
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command:
      "npm run build && npm run start -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      // empty environment variables only apply to test process (.env.local unchanged)
      SPOONACULAR_API_KEY: "",
      GOOGLE_MAPS_SERVER_API_KEY: "",
      NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: "",
    },
  },
});