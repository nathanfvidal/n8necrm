// Este script grava no mesmo Postgres do Supabase usado pelos testes que
// tocam banco (tests/unit/rate-limit.test.ts, tests/unit/audit-log.test.ts) e
// pelo app em dev — carrega DATABASE_URL do .env aqui, e não em
// vitest.config.ts, pelo mesmo motivo documentado lá: não injetar
// credenciais em testes que não tocam banco. Precisa ser o primeiro import:
// src/lib/prisma.ts → src/lib/env.ts lê process.env.DATABASE_URL no
// top-level.
import "dotenv/config";

import bcrypt from "bcryptjs";

import { prisma } from "../src/lib/prisma";
import { client } from "../config/client";

// Prisma 7 exige um driver adapter (ver node_modules/.prisma/client/index.d.ts:
// "A driver adapter is **required**"). `new PrismaClient()` sem adapter não
// funciona mais — por isso reusamos o client singleton de src/lib/prisma.ts
// (adapter-pg já configurado) em vez de instanciar um novo aqui.

const CORES = ["#94A3B8", "#60A5FA", "#FBBF24", "#F97316", "#22C55E"];

/**
 * Seed determinístico do funil, dos usuários de exemplo e de alguns leads.
 *
 * Precisa ser seguro para rodar mais de uma vez contra o Postgres
 * compartilhado (dev, verificação manual, CI) — sem duplicar linhas e sem
 * quebrar por causa de foreign key. Por isso:
 *
 * - PipelineStage: upsert por `ordem` (já é `@@unique([ordem])` no schema),
 *   nunca `deleteMany()`. `Lead.stageId` é `ON DELETE RESTRICT` (ver
 *   prisma/migrations/20260730211315_init/migration.sql) — como este mesmo
 *   seed cria Leads apontando para a primeira etapa, um `deleteMany()` em
 *   PipelineStage quebraria já na segunda execução, com leads existentes
 *   referenciando as etapas que se está tentando apagar.
 * - User: upsert por `email` (único no schema). `update: {}` propositalmente
 *   não regrava `senhaHash` numa reexecução — bcrypt.hash tem salt
 *   aleatório, então o hash mudaria a cada run sem necessidade nenhuma.
 * - Contact: upsert por `telefone` (único no schema).
 * - Lead: não tem chave natural única no schema. Para não duplicar a cada
 *   execução, só cria um Lead para o contato se ainda não existir nenhum
 *   apontando para ele.
 */
export async function seed(): Promise<void> {
  for (const [index, nome] of client.funil.entries()) {
    const ehUltimaEtapa = index === client.funil.length - 1;
    await prisma.pipelineStage.upsert({
      where: { ordem: index },
      update: {
        nome,
        cor: CORES[index % CORES.length],
        ehGanho: ehUltimaEtapa,
        ehPerdido: false,
      },
      create: {
        nome,
        ordem: index,
        cor: CORES[index % CORES.length],
        ehGanho: ehUltimaEtapa,
        ehPerdido: false,
      },
    });
  }

  // "senha123" é um literal público (está no repo). Nada nesta função
  // detecta com segurança se DATABASE_URL aponta pro Postgres real de um
  // cliente em produção — não há trigger automático de seed em nenhum
  // script (postinstall só roda `prisma generate`), e checar NODE_ENV não
  // serve: o próprio plano deste seed é dobrar como demo pra prospects, e
  // uma demo rodando via `next start` também tem NODE_ENV=production, então
  // bloquear por isso quebraria o caso de uso que o seed precisa suportar.
  // A mitigação cabível aqui é dar um jeito barato de trocar a senha sem
  // tocar em código: SEED_PASSWORD, com o literal documentado como
  // fallback (mantém dev/demo/testes funcionando sem configuração extra).
  const senhaPlano = process.env.SEED_PASSWORD ?? "senha123";
  const senhaHash = await bcrypt.hash(senhaPlano, 10);

  const admin = await prisma.user.upsert({
    where: { email: "admin@exemplo.com" },
    update: {},
    create: { nome: "Admin Exemplo", email: "admin@exemplo.com", senhaHash, papel: "ADMIN" },
  });

  const vendedor = await prisma.user.upsert({
    where: { email: "vendedor@exemplo.com" },
    update: {},
    create: { nome: "Vendedor Exemplo", email: "vendedor@exemplo.com", senhaHash, papel: "VENDEDOR" },
  });

  const primeiraEtapa = await prisma.pipelineStage.findFirstOrThrow({ orderBy: { ordem: "asc" } });

  const nomes = ["Carlos Silva", "Fernanda Lima", "João Pereira", "Marina Costa"];
  for (let i = 0; i < nomes.length; i++) {
    const contact = await prisma.contact.upsert({
      where: { telefone: `1199999000${i}` },
      update: {},
      create: { nome: nomes[i], telefone: `1199999000${i}` },
    });

    const leadExistente = await prisma.lead.findFirst({ where: { contactId: contact.id } });
    if (!leadExistente) {
      await prisma.lead.create({
        data: {
          contactId: contact.id,
          stageId: primeiraEtapa.id,
          responsavelId: i % 2 === 0 ? admin.id : vendedor.id,
          canal: "MANUAL",
        },
      });
    }
  }

  console.log("Seed concluído.");
}

// O Vitest define process.env.VITEST em todo processo de teste. Sem essa
// guarda, importar `seed` a partir de um arquivo de teste (para testar
// idempotência chamando a função diretamente) disparava também esta
// invocação de topo de arquivo, rodando o seed uma vez a mais — e
// desconectando o client compartilhado no meio da suíte.
if (!process.env.VITEST) {
  seed()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
