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

/**
 * Teto de conexões que UM processo da aplicação abre.
 *
 * ## Por que existe um teto
 *
 * Enquanto o `DATABASE_URL` apontava para o pooler em *session mode* (porta
 * 5432), cada cliente prendia uma conexão inteira dentro de um total de 15, e
 * o `pg` abre 10 por padrão — um processo sozinho tomava dois terços do
 * orçamento. Isso não era hipótese: rodando a suíte E2E em paralelo, o painel
 * passou a devolver 500 com
 * `(EMAXCONNSESSION) max clients reached in session mode - pool_size: 15`.
 *
 * Hoje o `DATABASE_URL` é o pooler em *transaction mode* (porta 6543), onde a
 * conexão do servidor só fica ocupada durante a transação e o pooler
 * multiplexa muitos clientes sobre poucas conexões reais. O aperto de antes
 * deixou de existir — mas o teto continua, agora com outro papel: impedir que
 * um pico de tráfego (ou um vazamento de conexão) faça UM processo abrir sem
 * limite. Um teto explícito transforma um pico em fila, que é degradação
 * previsível, em vez de erro em cascata.
 *
 * 10 é o padrão do `pg`, declarado aqui de propósito para que o valor seja uma
 * decisão visível e não um efeito colateral da biblioteca. `connectionTimeoutMillis`
 * garante que, se a fila encher, a requisição falhe rápido e visivelmente em
 * vez de ficar pendurada.
 */
const MAX_CONEXOES_POR_PROCESSO = 10;

function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
    max: MAX_CONEXOES_POR_PROCESSO,
    connectionTimeoutMillis: 10_000,
  });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
