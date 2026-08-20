import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { EMAIL_ADMIN_E2E, EMAIL_VENDEDOR_E2E, senhaE2e } from "./credenciais";

/**
 * Custo 10, o mesmo de `src/core/users/service.ts` e do hash inerte de
 * `src/core/auth/credenciais.ts`. Aquele hash existe para que "e-mail não
 * existe" e "senha errada" levem o mesmo tempo; uma conta com custo diferente
 * responderia em outro tempo e reabriria a enumeração de usuário que aquele
 * código fechou — inclusive para estas contas de teste, que são reais no banco
 * como qualquer outra.
 */
const CUSTO_BCRYPT = 10;

/**
 * Garante que as contas de teste existem, estão ativas e com a senha atual.
 *
 * `upsert` e não `create`: roda antes de toda execução da suíte e não pode
 * quebrar na segunda vez nem depender de o banco estar num estado anterior.
 * O `update` regrava `senhaHash`, `ativo` e `papel` porque cada um desses já
 * foi motivo de suíte quebrada — conta desativada por um teste que falhou no
 * meio, papel trocado por um teste de permissão, senha rotacionada no `.env`.
 */
async function garantirContasDeTeste(prisma: PrismaClient): Promise<void> {
  const senhaHash = await bcrypt.hash(senhaE2e(), CUSTO_BCRYPT);

  // A empresa das contas de teste: a MAIS ANTIGA do banco, que nesta árvore é
  // `company-migracao-1a` — a que a migração do Ciclo 1a criou e à qual todo o
  // resto do dado de desenvolvimento está preso. Fixture não inventa empresa
  // nova: uma empresa por execução da suíte é exatamente o resíduo que a
  // auditoria do Ciclo 1a mediu (empresas órfãs deixadas por fixture).
  //
  // `findFirst` aqui não contradiz a regra "nunca `company.findFirst()`" de
  // `src/core/config/leitura.ts`: aquela proíbe DERIVAR a empresa do usuário
  // logado a partir do banco em código de aplicação. Aqui não há usuário
  // logado — este código está CRIANDO o vínculo que, depois, vai ser a origem
  // do `companyId` da sessão.
  const empresa = await prisma.company.findFirst({
    orderBy: { criadoEm: "asc" },
    select: { id: true },
  });
  if (!empresa) {
    throw new Error(
      "Não há nenhuma Company no banco, e as contas de teste E2E precisam de um Membership " +
        "para entrar no painel (src/core/auth/session.ts resolve o companyId da sessão pelo " +
        "vínculo). Rode as migrations e o seed antes da suíte E2E.",
    );
  }

  for (const [email, nome, papel] of [
    [EMAIL_ADMIN_E2E, "E2E Admin", "ADMIN"],
    [EMAIL_VENDEDOR_E2E, "E2E Vendedor", "VENDEDOR"],
  ] as const) {
    const usuario = await prisma.user.upsert({
      where: { email },
      update: { senhaHash, ativo: true, papel },
      create: { nome, email, senhaHash, papel },
      select: { id: true },
    });

    // O VÍNCULO, e sem ele a suíte inteira não entra no painel.
    //
    // Desde o Ciclo 1a `Membership.papel` é a fonte de verdade e `User.papel`
    // é espelho depreciado (`prisma/schema.prisma`, bloco de `User`):
    // `usuarioAtual()` resolve `companyId` e `papel` pelo vínculo e LANÇA
    // quando não há nenhum. Esta função foi escrita antes disso e continuou
    // criando só o `User` — medido em 2026-08-20, os dois `e2e-*@teste.invalid`
    // tinham ZERO linhas em `Membership`.
    //
    // O sintoma não apontava para cá: o login em si funcionava, `/` redirecionava
    // de volta para `/login` porque `(painel)/layout.tsx` captura o erro de
    // `usuarioAtual()` e manda para lá, e `auth.setup.ts` falhava dizendo que o
    // link "Equipe" não estava visível. É o mesmo defeito que o commit e67e1e6
    // fechou em `tests/unit/audit-log.test.ts`; a fixture E2E ficou de fora.
    //
    // `update: { papel }` pelo mesmo motivo que o `upsert` do usuário regrava o
    // papel: um teste de permissão que troque o papel e falhe no meio deixaria
    // o vínculo com o papel errado para a execução seguinte.
    await prisma.membership.upsert({
      where: { userId_companyId: { userId: usuario.id, companyId: empresa.id } },
      update: { papel },
      create: { userId: usuario.id, companyId: empresa.id, papel },
    });
  }
}

/**
 * Zera o contador de tentativas de login antes da suíte E2E.
 *
 * ## Por que isto é necessário
 *
 * O limite de tentativas (`src/core/rate-limit/login.ts`) conta TODA
 * tentativa, certa ou errada, e a suíte E2E faz vários logins seguidos com a
 * mesma conta (`e2e-admin@teste.invalid`). Uma execução isolada cabe folgada no
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
    await garantirContasDeTeste(prisma);

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
