import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4319',
    headless: true,
  },
  webServer: [
    {
      command: 'tsx src/index.ts --api --no-whatsapp',
      url: 'http://127.0.0.1:4317/api/bootstrap',
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
      env: {
        WEBUI_PORT: '4317',
        ASSISTANT_NAME: 'TestBot',
      },
    },
    {
      command: 'npm run dev',
      url: 'http://127.0.0.1:4319',
      cwd: './webui',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        PORT: '4319',
        BACKEND_URL: 'http://127.0.0.1:4317',
        NEXT_PUBLIC_WS_URL: 'ws://127.0.0.1:4317/api/ws',
      },
    },
  ],
});
