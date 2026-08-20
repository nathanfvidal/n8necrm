// Este arquivo usa o Prisma REAL contra o Postgres do Supabase, então carrega
// DATABASE_URL do .env aqui — não em vitest.config.ts — para não injetar
// credenciais em testes que não tocam banco. Precisa ser o primeiro import:
// os módulos abaixo (via src/lib/prisma.ts → src/lib/env.ts) leem
// process.env.DATABASE_URL no top-level. Mesmo padrão de
// `tests/unit/contact-isolamento.test.ts`.
import "dotenv/config";

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

// "server-only" só resolve para um no-op sob a condição de resolução
// "react-server" que o Next.js aplica no build — fora desse pipeline (aqui,
// sob Vitest) ele sempre lança. `src/lib/prisma.ts` importa.
vi.mock("server-only", () => ({}));

import { prisma } from "../../src/lib/prisma";
import { listarAtividadeRecente } from "../../src/core/audit/queries";
import { registrarAuditoria } from "../../src/core/audit/log";
import { avaliarAtividadeSuspeita, LIMITE_ALERTA } from "../../src/core/audit/alerta";

/**
 * O par de `contact-isolamento`, `lead-isolamento`, `pipeline-isolamento` e
 * `whatsapp-isolamento`, agora para `core/audit/`.
 *
 * ## As três costuras que este arquivo prova
 *
 * 1. **A leitura da home.** `listarAtividadeRecente` substitui um
 *    `prisma.auditLog.findMany({ take: 10, orderBy })` SEM `where` nenhum que
 *    morava dentro de `src/app/(painel)/page.tsx`. Era o item 1 da fila de
 *    conversão e a última leitura cross-tenant escrita dentro de uma página.
 *
 * 2. **A empresa da LINHA de auditoria.** `registrarAuditoria` deduzia a
 *    empresa do vínculo de quem AGIU (`companyIdDoUsuario`, que pega um
 *    `Membership` arbitrário de quem tem mais de um). Quem age sobre entidade
 *    da empresa A tendo vínculo também na B gravava o rastro na empresa
 *    errada — e o rastro é justamente o que se lê depois para reconstituir o
 *    estrago. Agora `companyId` é campo obrigatório de `ParamsDeAuditoria`.
 *
 * 3. **A contagem da rajada.** `avaliarAtividadeSuspeita` contava `AuditLog`
 *    só por `userId`. Para quem tem dois vínculos, ações nas duas empresas
 *    somavam num contador só e disparavam alarme na empresa errada.
 *
 * ## A sonda de assinatura ANTIGA
 *
 * Lição de dois blocos anteriores deste ciclo: um RED pode passar pelo motivo
 * errado (a mudança de assinatura faz o código velho ler a empresa como id, e
 * o caso fica verde sem provar nada). Por isso os casos 1 e 3 têm uma sonda
 * que refaz a consulta ANTIGA, palavra por palavra, e AFIRMA que ela alcança a
 * outra empresa. Ela não testa o código de produção — testa a FIXTURE: se a
 * sonda ficar verde, é porque não há dado cruzado para vazar, e o caso ao lado
 * dela passaria por vacuidade.
 *
 * ## As DUAS metades, sempre
 *
 * Todo caso afirma também que o dado da empresa CERTA continua chegando. Sem
 * ela, "não devolver nada para ninguém" passaria como correção.
 */

// ─── Ids fixos ────────────────────────────────────────────────────────────
const P = "iso-ad";
const EMPRESA_A = `${P}-company-a`;
const EMPRESA_B = `${P}-company-b`;
/** Tem vínculo nas DUAS empresas — é a pessoa por onde os defeitos 2 e 3 passam. */
const USUARIO_DUPLO = `${P}-user-duplo`;
/** ADMIN só da A. Existe para RECEBER o alerta de rajada e provar em qual empresa ele caiu. */
const ADMIN_A = `${P}-user-admin-a`;
/** ADMIN só da B. Se um alerta da A chegar a ele, o escopo do alerta vazou. */
const ADMIN_B = `${P}-user-admin-b`;

const SENHA_FALSA = "$2b$10$naoUsadaPorNenhumTesteDesteArquivo000000000000000000";

/**
 * Uma das `ACOES_SENSIVEIS` de `core/audit/alerta.ts`. Escrita literal de
 * propósito: importar a lista e pegar `[0]` faria o teste seguir a lista se ela
 * for reordenada, e o que se quer aqui é uma ação sensível FIXA.
 */
const ACAO_SENSIVEL = "excluir_task";

/**
 * Ordem ditada pelas FKs. `Notification` PRIMEIRO
 * (`Notification_userId_fkey` aponta para `User`), depois `AuditLog`, depois
 * `Membership`, depois `User`, depois `Company` — o padrão do commit 63cecd2.
 *
 * `RateLimit` entra porque `avaliarAtividadeSuspeita` consome uma chave de
 * silêncio (`alerta:atividade:<userId>`) por `checarRateLimit`: sem apagá-la, o
 * segundo caso que dispara alerta para o mesmo usuário sai calado e o teste
 * falha por um motivo que não é o testado.
 */
async function limparTudo() {
  const usuarios = [USUARIO_DUPLO, ADMIN_A, ADMIN_B];
  const empresas = [EMPRESA_A, EMPRESA_B];

  await prisma.notification.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.notification.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.auditLog.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.rateLimit.deleteMany({
    where: { chave: { in: usuarios.map((u) => `alerta:atividade:${u}`) } },
  });
  await prisma.membership.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.user.deleteMany({ where: { id: { in: usuarios } } });
  await prisma.company.deleteMany({ where: { id: { in: empresas } } });
}

/** Zera só o que cada caso grava — as empresas e as pessoas ficam de pé. */
async function limparMovimento() {
  const usuarios = [USUARIO_DUPLO, ADMIN_A, ADMIN_B];
  const empresas = [EMPRESA_A, EMPRESA_B];

  await prisma.notification.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.notification.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.auditLog.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.rateLimit.deleteMany({
    where: { chave: { in: usuarios.map((u) => `alerta:atividade:${u}`) } },
  });
}

/**
 * Grava `quantas` linhas de auditoria direto pelo prisma CRU — o oráculo de
 * ESCRITA, fora de qualquer código sob teste.
 *
 * `criadoEm` explícito e decrescente: `listarAtividadeRecente` ordena por ele, e
 * linhas criadas no mesmo milissegundo tornariam a ordem indefinida — o caso do
 * teto (`take`) precisa de ordem determinística para afirmar QUAIS dez chegaram.
 */
async function semearLinhas(
  companyId: string,
  userId: string,
  quantas: number,
  acao = ACAO_SENSIVEL,
  entidadeIdPrefixo = "e"
) {
  const base = Date.now();
  await prisma.auditLog.createMany({
    data: Array.from({ length: quantas }, (_, i) => ({
      companyId,
      userId,
      acao,
      entidade: "Lead",
      entidadeId: `${entidadeIdPrefixo}-${i}`,
      criadoEm: new Date(base - i * 1000),
    })),
  });
}

beforeAll(async () => {
  await limparTudo();

  await prisma.company.createMany({
    data: [
      { id: EMPRESA_A, nome: "Empresa A do isolamento de auditoria" },
      { id: EMPRESA_B, nome: "Empresa B do isolamento de auditoria" },
    ],
  });

  await prisma.user.createMany({
    data: [USUARIO_DUPLO, ADMIN_A, ADMIN_B].map((id) => ({
      id,
      nome: `Pessoa ${id}`,
      email: `${id}@exemplo.invalido`,
      senhaHash: SENHA_FALSA,
      papel: "ADMIN" as const,
    })),
  });

  // `USUARIO_DUPLO` primeiro na A: é o vínculo que `companyIdDoUsuario`
  // (`findFirstOrThrow`, sem `orderBy`) pegaria — e é justamente por ele ser
  // ARBITRÁRIO que a empresa da linha precisa vir de parâmetro.
  await prisma.membership.createMany({
    data: [
      { userId: USUARIO_DUPLO, companyId: EMPRESA_A, papel: "ADMIN" },
      { userId: USUARIO_DUPLO, companyId: EMPRESA_B, papel: "ADMIN" },
      { userId: ADMIN_A, companyId: EMPRESA_A, papel: "ADMIN" },
      { userId: ADMIN_B, companyId: EMPRESA_B, papel: "ADMIN" },
    ],
  });
});

beforeEach(limparMovimento);

afterAll(limparTudo);

describe("listarAtividadeRecente", () => {
  it("SONDA (consulta ANTIGA): sem `where`, a home alcançava a linha da outra empresa", async () => {
    await semearLinhas(EMPRESA_B, ADMIN_B, 12, "criar_lead", "sonda-b");

    // A consulta que morava dentro de `src/app/(painel)/page.tsx`, palavra por
    // palavra. Se esta afirmação falhar, a fixture parou de produzir dado
    // cruzado e o caso abaixo passa por vacuidade.
    const antigo = await prisma.auditLog.findMany({
      take: 10,
      orderBy: { criadoEm: "desc" },
      include: { user: { select: { id: true, nome: true } } },
    });

    expect(antigo.some((linha) => linha.companyId === EMPRESA_B)).toBe(true);
  });

  it("a home da A não mostra atividade da B, e mostra a dela", async () => {
    await semearLinhas(EMPRESA_A, ADMIN_A, 3, "criar_lead", "a");
    await semearLinhas(EMPRESA_B, ADMIN_B, 3, "criar_lead", "b");

    const linhas = await listarAtividadeRecente(EMPRESA_A);
    const ids = linhas.map((l) => l.entidadeId ?? "");

    expect(linhas.length).toBe(3);
    expect(linhas.every((l) => l.user.id === ADMIN_A)).toBe(true);
    expect(ids.join(",")).not.toContain("b-");
  });

  it("o teto de 10 corta DENTRO da empresa, não no banco inteiro", async () => {
    // 12 linhas da B são mais novas que as 4 da A. Sem escopo, as dez que
    // voltariam seriam todas da B e a A veria zero atividade própria.
    await semearLinhas(EMPRESA_A, ADMIN_A, 4, "criar_lead", "a");
    await semearLinhas(EMPRESA_B, ADMIN_B, 12, "criar_lead", "b");

    const linhas = await listarAtividadeRecente(EMPRESA_A);

    expect(linhas.length).toBe(4);
    expect(linhas.every((l) => l.user.id === ADMIN_A)).toBe(true);
  });
});

describe("registrarAuditoria", () => {
  it("grava na empresa que RECEBEU por parâmetro, não no vínculo arbitrário do autor", async () => {
    // O vínculo que `companyIdDoUsuario` pegaria é o da A (criado primeiro). A
    // ação é sobre entidade da B, e é a B que precisa aparecer na linha.
    await registrarAuditoria({
      companyId: EMPRESA_B,
      userId: USUARIO_DUPLO,
      acao: "editar_lead",
      entidade: "Lead",
      entidadeId: "lead-da-b",
    });

    const linhas = await prisma.auditLog.findMany({ where: { userId: USUARIO_DUPLO } });

    expect(linhas.length).toBe(1);
    expect(linhas[0]!.companyId).toBe(EMPRESA_B);
  });

  it("a linha gravada na A aparece para a A e não para a B", async () => {
    await registrarAuditoria({
      companyId: EMPRESA_A,
      userId: USUARIO_DUPLO,
      acao: "editar_lead",
      entidade: "Lead",
      entidadeId: "lead-da-a",
    });

    const naA = await listarAtividadeRecente(EMPRESA_A);
    const naB = await listarAtividadeRecente(EMPRESA_B);

    expect(naA.map((l) => l.entidadeId)).toContain("lead-da-a");
    expect(naB.map((l) => l.entidadeId)).not.toContain("lead-da-a");
  });
});

describe("avaliarAtividadeSuspeita", () => {
  it("SONDA (contagem ANTIGA): sem `companyId`, as duas empresas somavam num contador só", async () => {
    const metade = Math.ceil(LIMITE_ALERTA / 2);
    await semearLinhas(EMPRESA_A, USUARIO_DUPLO, metade, ACAO_SENSIVEL, "a");
    await semearLinhas(EMPRESA_B, USUARIO_DUPLO, metade, ACAO_SENSIVEL, "b");

    // A contagem que `avaliarAtividadeSuspeita` fazia: só `userId`.
    const somaCruzada = await prisma.auditLog.count({
      where: { userId: USUARIO_DUPLO, acao: ACAO_SENSIVEL },
    });
    const soDaA = await prisma.auditLog.count({
      where: { companyId: EMPRESA_A, userId: USUARIO_DUPLO, acao: ACAO_SENSIVEL },
    });

    expect(somaCruzada).toBeGreaterThanOrEqual(LIMITE_ALERTA);
    expect(soDaA).toBeLessThan(LIMITE_ALERTA);
  });

  it("metade em cada empresa NÃO fecha rajada em nenhuma das duas", async () => {
    const metade = Math.ceil(LIMITE_ALERTA / 2);
    await semearLinhas(EMPRESA_A, USUARIO_DUPLO, metade, ACAO_SENSIVEL, "a");
    await semearLinhas(EMPRESA_B, USUARIO_DUPLO, metade, ACAO_SENSIVEL, "b");

    await avaliarAtividadeSuspeita({
      companyId: EMPRESA_A,
      userId: USUARIO_DUPLO,
      acao: ACAO_SENSIVEL,
    });

    const avisos = await prisma.notification.count({
      where: { userId: { in: [ADMIN_A, ADMIN_B] } },
    });
    expect(avisos).toBe(0);
  });

  it("rajada inteira DENTRO da A alerta o ADMIN da A e nunca o da B", async () => {
    await semearLinhas(EMPRESA_A, USUARIO_DUPLO, LIMITE_ALERTA, ACAO_SENSIVEL, "a");

    await avaliarAtividadeSuspeita({
      companyId: EMPRESA_A,
      userId: USUARIO_DUPLO,
      acao: ACAO_SENSIVEL,
    });

    const avisos = await prisma.notification.findMany({
      where: { userId: { in: [ADMIN_A, ADMIN_B] } },
    });

    expect(avisos.map((n) => n.userId)).toEqual([ADMIN_A]);
    expect(avisos[0]!.companyId).toBe(EMPRESA_A);
  });
});
