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
 *   referenciando as etapas que se está tentando apagar. Depois do upsert,
 *   o seed também reconcilia órfãos (etapas com `ordem >= client.funil.length`
 *   que sobraram de uma execução anterior com um funil maior — ver
 *   `reconciliarEtapasOrfas` abaixo) e confere explicitamente que exatamente
 *   1 etapa ficou com `ehGanho: true` (fix round 1/5: encolher o funil sem
 *   isso deixava a etapa removida órfã com `ehGanho: true` para sempre,
 *   fazendo `ehGanho` apontar para duas etapas ao mesmo tempo).
 * - User: upsert por `email` (único no schema). `senhaHash` só é regravado
 *   numa reexecução quando `SEED_PASSWORD` está explicitamente definida (ver
 *   comentário junto a `senhaPlanoExplicita` abaixo) — fix round 1/5: antes
 *   `update: {}` nunca regravava o hash, então `SEED_PASSWORD` definida
 *   depois do primeiro seed não tinha efeito nenhum e a senha antiga
 *   continuava válida.
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

  await reconciliarEtapasOrfas();
  await confirmarInvarianteEhGanho();

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
  //
  // `senhaPlanoExplicita` (fix round 1/5): distinguimos "SEED_PASSWORD não
  // foi definida" de "foi definida com algum valor". Só regravamos
  // `senhaHash` numa reexecução quando a variável foi explicitamente
  // passada — o objetivo é rotacionar a senha de verdade quando alguém pede
  // isso deliberadamente, sem reescrever o hash (com salt novo, toda vez)
  // numa reexecução comum onde ninguém pediu troca nenhuma.
  const senhaPlanoExplicita = process.env.SEED_PASSWORD;
  const senhaPlano = senhaPlanoExplicita ?? "senha123";
  const senhaHash = await bcrypt.hash(senhaPlano, 10);
  const atualizarSenhaNaReexecucao = senhaPlanoExplicita !== undefined;

  const admin = await prisma.user.upsert({
    where: { email: "admin@exemplo.com" },
    update: atualizarSenhaNaReexecucao ? { senhaHash } : {},
    create: { nome: "Admin Exemplo", email: "admin@exemplo.com", senhaHash, papel: "ADMIN" },
  });

  const vendedor = await prisma.user.upsert({
    where: { email: "vendedor@exemplo.com" },
    update: atualizarSenhaNaReexecucao ? { senhaHash } : {},
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

/**
 * Remove do banco as `PipelineStage` que sobraram de uma execução anterior
 * com um `client.funil` maior (ex.: funil tinha 5 etapas, alguém removeu uma
 * em `config/client.ts` e reduziu pra 4 — a antiga etapa de `ordem: 4` não é
 * mais tocada pelo loop de upsert em `seed()`, que só cobre
 * `0..client.funil.length - 1`).
 *
 * Fix round 1/5: sem isso, a etapa órfã ficava no banco pra sempre com o
 * `ehGanho: true` que tinha antes de virar órfã (era a última etapa do
 * funil anterior), enquanto a nova última etapa também virava `ehGanho:
 * true` — duas linhas com a flag ligada ao mesmo tempo, silenciosamente.
 * `listarEtapas()` não filtra por comprimento, então também devolveria a
 * órfã pra sempre.
 *
 * `Lead.stageId` é `ON DELETE RESTRICT`, então apagar uma etapa que ainda
 * tem lead não é uma opção silenciosa: mover ou perder leads de um cliente
 * de verdade é pior do que o bug que este fix resolve. Por isso, se algum
 * lead ainda aponta pra uma etapa órfã, o seed falha alto e explica o que
 * o operador precisa fazer antes de rodar de novo — em vez de deixar o
 * Postgres estourar uma violação de FK crua, ou (pior) apagar o lead junto.
 */
async function reconciliarEtapasOrfas(): Promise<void> {
  const orfas = await prisma.pipelineStage.findMany({
    where: { ordem: { gte: client.funil.length } },
    orderBy: { ordem: "asc" },
  });

  for (const orfa of orfas) {
    const leadsNaEtapa = await prisma.lead.count({ where: { stageId: orfa.id } });
    if (leadsNaEtapa > 0) {
      throw new Error(
        `Seed abortado: a etapa "${orfa.nome}" (ordem ${orfa.ordem}, id ${orfa.id}) não existe mais em ` +
          `client.funil, mas ainda tem ${leadsNaEtapa} lead(s) apontando pra ela. Apagar essa etapa ` +
          `automaticamente moveria ou descartaria esses leads sem confirmação — o seed não faz isso. ` +
          `Mova os leads pra uma etapa que continua existindo antes de rodar o seed de novo, por exemplo: ` +
          `prisma.lead.updateMany({ where: { stageId: "${orfa.id}" }, data: { stageId: <idDaNovaEtapa> } })`
      );
    }
    await prisma.pipelineStage.delete({ where: { id: orfa.id } });
  }
}

/**
 * Confere explicitamente, depois do upsert e da reconciliação de órfãs, que
 * o banco tem exatamente 1 `PipelineStage` com `ehGanho: true` — a Task 20
 * calcula a taxa de conversão a partir exatamente dessa flag.
 *
 * Fix round 1/5: o loop de upsert em `seed()` já marca exatamente 1 etapa
 * como `ehGanho` por construção (`index === client.funil.length - 1`), e
 * `reconciliarEtapasOrfas` já remove qualquer etapa fora dessa faixa — mas
 * confiar nisso implicitamente foi exatamente como o bug original passou:
 * o loop "parecia" bastar. Esta checagem é o alarme que dispara se alguma
 * mudança futura nessas duas funções voltar a violar o invariante, em vez
 * de deixar o dado errado seguir silenciosamente pro dashboard da Task 20.
 */
async function confirmarInvarianteEhGanho(): Promise<void> {
  const etapasGanhas = await prisma.pipelineStage.count({ where: { ehGanho: true } });
  if (etapasGanhas !== 1) {
    throw new Error(
      `Invariante violada: esperava exatamente 1 PipelineStage com ehGanho=true, encontrei ${etapasGanhas}. ` +
        `Task 20 calcula a taxa de conversão a partir dessa flag — não é seguro continuar o seed assim.`
    );
  }
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
