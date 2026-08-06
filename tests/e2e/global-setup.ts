import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Zera o contador de tentativas de login antes da suíte E2E.
 *
 * ## Por que isto é necessário
 *
 * O limite de tentativas (`src/core/rate-limit/login.ts`) conta TODA
 * tentativa, certa ou errada, e a suíte E2E faz vários logins seguidos com a
 * mesma conta (`admin@exemplo.com`). Uma execução isolada cabe folgada no
 * teto de 10 por 10 minutos; duas execuções dentro da mesma janela, não —
 * e a segunda falha com "E-mail ou senha inválidos" em testes que não têm
 * nada a ver com login.
 *
 * Isso não é um teto mal dimensionado: 10 tentativas em 10 minutos é muito
 * para uma pessoa e pouco para um robô, que é exatamente o objetivo. Quem
 * está fora da curva é a suíte, que loga como um robô. Limpar o contador
 * aqui é a mesma higiene que os specs já fazem com lead e contato de teste —
 * preparar o estado do banco que o teste precisa, em vez de afrouxar a
 * regra do sistema para o teste passar.
 *
 * Apaga SÓ as chaves com prefixo `login:` — nenhuma outra chave de rate
 * limit (o webhook do WhatsApp usa `whatsapp:webhook:*`) é tocada.
 */
export default async function globalSetup() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });

  try {
    const { count } = await prisma.rateLimit.deleteMany({
      where: { chave: { startsWith: "login:" } },
    });
    if (count > 0) {
      console.log(`[e2e] contador de tentativas de login zerado (${count} chave(s)).`);
    }
  } finally {
    await prisma.$disconnect();
  }
}
