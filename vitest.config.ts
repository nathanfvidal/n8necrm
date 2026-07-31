import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

// Não carregamos .env aqui. Um loadEnv() global injetaria TODAS as
// variáveis (AUTH_SECRET, SUPABASE_SERVICE_ROLE_KEY, ...) em todo arquivo de
// teste, mesmo os que não tocam banco (client-config, permissions, storage).
// Os dois arquivos que realmente precisam de DATABASE_URL
// (tests/unit/rate-limit.test.ts, tests/unit/audit-log.test.ts) carregam
// `dotenv/config` eles mesmos — mesmo padrão que prisma.config.ts já usa.
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
  },
});
