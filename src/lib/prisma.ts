// Fix round 2/5 (Task 17), achado do revisor: sem isto, o único motivo pelo
// qual um Client Component não conseguia importar Prisma era coincidência —
// o bundler tropeçando em módulos do Node (`dns`/`net`/`tls`/`fs`) que `pg`
// puxa por baixo. Isso não é uma guarda, é um acidente da árvore de
// dependências que pararia de proteger nada no dia em que o driver mudasse.
// `import "server-only"` (mesmo padrão de src/lib/storage.ts) faz o build
// falhar com um erro claro e nomeado sempre que este módulo (Prisma, e
// tudo que o importa — ver notes.ts) acabar num bundle de cliente.
import "server-only";

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { env } from "./env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
