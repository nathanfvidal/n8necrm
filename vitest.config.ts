import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

// Testes de integração (rate-limit, audit-log) usam o Prisma real contra o
// Postgres do Supabase, então `src/lib/env.ts` precisa de DATABASE_URL em
// process.env. O Vite não injeta .env em process.env automaticamente fora do
// modo browser — carregamos manualmente aqui, do mesmo jeito que
// prisma.config.ts faz com `import "dotenv/config"`, mas usando o loader que
// já é dependência transitiva do próprio Vitest (evita adicionar "dotenv"
// como dependência direta só para isso).
Object.assign(process.env, loadEnv("test", process.cwd(), ""));

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
  },
});
