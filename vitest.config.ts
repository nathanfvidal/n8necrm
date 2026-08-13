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
  },
});

// ─── Se a suíte falhar com "Failed to start forks worker", leia isto ──────
//
// O sintoma: a execução termina com `Errors 1 error`, um ARQUIVO INTEIRO não
// roda (o total cai, ex.: 87 → 86 arquivos) e a mensagem é
//
//   [vitest-pool]: Failed to start forks worker for test files <algum arquivo>
//   Caused by: [vitest-pool-runner]: Timeout waiting for worker to respond
//
// O arquivo citado MUDA a cada execução. Isso é o que denuncia: não é aquele
// teste, é o worker que não subiu a tempo.
//
// Causa observada: este projeto vive dentro de uma pasta sincronizada pelo
// OneDrive. Logo após um merge (ou qualquer escrita grande), a sincronização
// disputa o I/O e o processo do worker estoura o tempo de resposta.
//
// A assinatura que confirma, e que é o motivo de este bloco existir: compare
// o `import` no rodapé do relatório. Medido em execuções consecutivas da
// MESMA árvore, logo após um merge de 19 arquivos:
//
//   falhou  → Duration 507s (import 74.63s)
//   passou  → Duration 364s (import 20.48s)
//
// I/O três vezes e meia mais lento. Espere a sincronização assentar e rode de
// novo antes de investigar o teste citado.
//
// NÃO configure retentativa automática nem aumente o timeout do worker para
// "resolver" isto. O `AGENTS.md` deste projeto existe por causa de um defeito
// REAL de segurança que quase foi descartado como teste instável — mascarar
// esta falha é treinar todo mundo a ignorar a próxima, que pode não ser
// ambiental. Um erro visível que se explica em três linhas vale mais que um
// verde que esconde qualquer coisa.
