// vitest.config.ts
// Test configuration.
// - environment 'node': backend code (Fastify/Prisma/Redis), no DOM.
// - globals enabled: describe/it/expect/vi without explicit imports.
// - coverage via the v8 provider (native to Node).
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    env: {
      // TEST-ONLY values (never use in a real environment). Several tests
      // create Instance/ApiClient through the services (not only prisma mocks),
      // which encrypts/hashes secrets before the INSERT. The app config also
      // refuses to load outside development with the default secrets, so the
      // tests provide explicit (non-default, fictional) ones.
      SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
      JWT_SECRET: 'test-only-jwt-secret-value',
      API_SECRET: 'test-only-api-secret-value',
      DATABASE_URL: 'postgresql://localhost:5432/test',
      DIRECT_DATABASE_URL: 'postgresql://localhost:5432/test',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Mede cobertura só do código-fonte (ignora os próprios testes e configs).
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/types/**'],
    },
  },
})
