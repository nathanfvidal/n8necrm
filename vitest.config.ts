import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

// Não carregamos .env aqui. Um loadEnv() global injetaria TODAS as
// variáveis (AUTH_SECRET, SUPABASE_SERVICE_ROLE_KEY, ...) em todo arquivo de
// teste, mesmo os que não tocam banco (client-config, permissions, storage).
// Os arquivos que realmente precisam de DATABASE_URL carregam `dotenv/config`
// eles mesmos — mesmo padrão que prisma.config.ts já usa (todo teste que
// importa `src/lib/prisma` direto ou via `prisma/seed.ts` contra o Postgres
// real do Supabase). Não listamos quantos são nem quais aqui de propósito —
// esse número muda a cada teste novo que toque banco, e um comentário com
// contagem fixa só fica desatualizado (já aconteceu uma vez). Para achar a
// lista atual: `grep -rlE '^import "dotenv/config";' tests/` — âncora no
// início da linha, não pega comentário que só MENCIONA a string (ex.: o
// comentário deste próprio arquivo, ou o de permissions.test.ts).
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
    setupFiles: ["tests/vitest.setup.ts"],
  },
});
