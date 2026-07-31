import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

// Não carregamos .env aqui. Um loadEnv() global injetaria TODAS as
// variáveis (AUTH_SECRET, SUPABASE_SERVICE_ROLE_KEY, ...) em todo arquivo de
// teste, mesmo os que não tocam banco (client-config, permissions, storage).
// Os arquivos que realmente precisam de DATABASE_URL (tests/unit/rate-limit.test.ts,
// tests/unit/audit-log.test.ts, tests/unit/seed.test.ts, tests/unit/pipeline-stages.test.ts)
// carregam `dotenv/config` eles mesmos — mesmo padrão que prisma.config.ts já usa.
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    // seed.test.ts e pipeline-stages.test.ts chamam prisma/seed.ts#seed()
    // (upsert por email/telefone/ordem) contra o Postgres real do Supabase.
    // Com arquivos rodando em paralelo (padrão do Vitest), duas execuções de
    // seed() concorrentes podem ambas checar "não existe" antes de qualquer
    // uma criar a linha e colidir no unique constraint (email/telefone) —
    // não é um bug de idempotência do seed, é uma corrida de teste. Rodar os
    // arquivos em sequência elimina a corrida; a suíte inteira ainda é
    // pequena o bastante pra isso não custar nada perceptível.
    fileParallelism: false,
  },
});
