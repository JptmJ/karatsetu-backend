import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';

// Ensure .env.test is loaded before tests start
dotenv.config({ path: '.env.test', override: true });

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['./tests/global-setup.ts'],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
