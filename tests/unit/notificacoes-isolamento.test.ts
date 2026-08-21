// Este arquivo usa o Prisma REAL contra o Postgres do Supabase, então carrega
// DATABASE_URL do .env aqui — não em vitest.config.ts — para não injetar
// credenciais em testes que não tocam banco. Precisa ser o primeiro import:
// os módulos abaixo (via src/lib/prisma.ts → src/lib/env.ts) leem
// process.env.DATABASE_URL no top-level. Mesmo padrão de
// `tests/unit/audit-isolamento.test.ts`.
import "dotenv/config";

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { prisma } from "../../src/lib/prisma";
import {
  listarNotificacoesNaoLidas,
  marcarComoLida,
  podarNotificacoes,
  RETENCAO_ABSOLUTA_MS,
} from "../../src/core/notifications/dispatch";

/**
 * O sino, com duas empresas.
 *
 * ## O que este arquivo prova, e por que precisa de duas
 *
 * `listarNotificacoesNaoLidas` e `marcarComoLida` filtravam só por `userId`.
 * Escopo por DONO coincide com escopo por EMPRESA enquanto ninguém tem vínculo
 * em duas — e é por isso que `userId` sozinho parecia bastar. `criarUsuario`
 * (`core/users/service.ts`) já sabe criar `Membership`, então dois vínculos é
 * estado expressável hoje, e nele o sino misturaria os avisos das duas
 * empresas numa lista só. O `payload` de uma notificação de WhatsApp carrega o
 * RÓTULO do cliente (`modules/whatsapp/notificacoes.ts`) — misturar não é
 * desarrumação, é o nome de um cliente aparecendo na sessão de outra empresa.
 *
 * `podarNotificacoes` é o caso invertido, e é uma ESCRITA: ela apagava a tabela
 * inteira, de todas as empresas, disparada pela navegação de qualquer uma.
 *
 * ## A sonda de consulta ANTIGA
 *
 * Cada bloco tem uma, e ela testa a FIXTURE, não o código: se ficar verde, não
 * há dado cruzado e o caso ao lado passaria por vacuidade. É a armadilha que
 * dois blocos anteriores deste ciclo já pagaram.
 *
 * ## As DUAS metades, sempre
 *
 * Todo caso afirma também que o dado da empresa CERTA continua chegando.
 */

const P = "iso-nt";
const EMPRESA_A = `${P}-company-a`;
const EMPRESA_B = `${P}-company-b`;
/** Vínculo nas DUAS. É por ele que "escopo por dono" deixa de bastar. */
const USUARIO_DUPLO = `${P}-user-duplo`;

const AVISO_NA_A = `${P}-notif-a`;
const AVISO_NA_B = `${P}-notif-b`;
/** Velha o bastante para a poda levar, e da empresa B. */
const AVISO_VELHO_NA_B = `${P}-notif-velho-b`;
const AVISO_VELHO_NA_A = `${P}-notif-velho-a`;

const SENHA_FALSA = "$2b$10$naoUsadaPorNenhumTesteDesteArquivo000000000000000000";

async function limparTudo() {
  const empresas = [EMPRESA_A, EMPRESA_B];
  await prisma.notification.deleteMany({ where: { userId: USUARIO_DUPLO } });
  await prisma.notification.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.membership.deleteMany({ where: { userId: USUARIO_DUPLO } });
  await prisma.user.deleteMany({ where: { id: USUARIO_DUPLO } });
  await prisma.company.deleteMany({ where: { id: { in: empresas } } });
}

/**
 * Recria as notificações a cada caso: metade deles GRAVA (`marcarComoLida`) ou
 * APAGA (`podarNotificacoes`), e sem recriar um caso leria o efeito do
 * anterior — o teste passaria a medir ordem de execução em vez de isolamento.
 */
async function semear() {
  await prisma.notification.deleteMany({ where: { userId: USUARIO_DUPLO } });

  const velho = new Date(Date.now() - RETENCAO_ABSOLUTA_MS - 86_400_000);

  await prisma.notification.createMany({
    data: [
      {
        id: AVISO_NA_A,
        companyId: EMPRESA_A,
        userId: USUARIO_DUPLO,
        tipo: "NOVO_LEAD",
        payload: { leadId: "lead-da-a", contatoNome: "Cliente da A" },
      },
      {
        id: AVISO_NA_B,
        companyId: EMPRESA_B,
        userId: USUARIO_DUPLO,
        tipo: "NOVO_LEAD",
        payload: { leadId: "lead-da-b", contatoNome: "Cliente da B" },
      },
      {
        id: AVISO_VELHO_NA_A,
        companyId: EMPRESA_A,
        userId: USUARIO_DUPLO,
        tipo: "NOVO_LEAD",
        payload: { leadId: "velho-a", contatoNome: "Antigo da A" },
        criadoEm: velho,
      },
      {
        id: AVISO_VELHO_NA_B,
        companyId: EMPRESA_B,
        userId: USUARIO_DUPLO,
        tipo: "NOVO_LEAD",
        payload: { leadId: "velho-b", contatoNome: "Antigo da B" },
        criadoEm: velho,
      },
    ],
  });
}

beforeAll(async () => {
  await limparTudo();

  await prisma.company.createMany({
    data: [
      { id: EMPRESA_A, nome: "Empresa A do isolamento de notificações" },
      { id: EMPRESA_B, nome: "Empresa B do isolamento de notificações" },
    ],
  });

  await prisma.user.create({
    data: {
      id: USUARIO_DUPLO,
      nome: "Duda das Duas",
      email: `${USUARIO_DUPLO}@exemplo.invalido`,
      senhaHash: SENHA_FALSA,
    },
  });

  await prisma.membership.createMany({
    data: [
      { userId: USUARIO_DUPLO, companyId: EMPRESA_A, papel: "ADMIN" },
      { userId: USUARIO_DUPLO, companyId: EMPRESA_B, papel: "ADMIN" },
    ],
  });
});

beforeEach(semear);

afterAll(limparTudo);

describe("listarNotificacoesNaoLidas", () => {
  it("SONDA (consulta ANTIGA): só `userId` juntava os avisos das duas empresas", async () => {
    const antigo = await prisma.notification.findMany({
      where: { userId: USUARIO_DUPLO, lidaEm: null },
    });

    const empresas = new Set(antigo.map((n) => n.companyId));
    expect(empresas.has(EMPRESA_A)).toBe(true);
    expect(empresas.has(EMPRESA_B)).toBe(true);
  });

  it("o sino da A não mostra o aviso da B, e mostra o dela", async () => {
    const ids = (await listarNotificacoesNaoLidas(EMPRESA_A, USUARIO_DUPLO)).map((n) => n.id);

    expect(ids).toContain(AVISO_NA_A);
    expect(ids).not.toContain(AVISO_NA_B);
  });

  it("o sino da B não mostra o aviso da A, e mostra o dele", async () => {
    const ids = (await listarNotificacoesNaoLidas(EMPRESA_B, USUARIO_DUPLO)).map((n) => n.id);

    expect(ids).toContain(AVISO_NA_B);
    expect(ids).not.toContain(AVISO_NA_A);
  });
});

describe("marcarComoLida — a regra de dono passa, o escopo é quem recusa", () => {
  // `USUARIO_DUPLO` É dono das duas notificações, então a checagem de dono
  // ACEITA nos dois casos. O que recusa é o `companyId` do cliente.
  it("a sessão da A não marca como lida o aviso da B", async () => {
    await expect(
      marcarComoLida({
        companyId: EMPRESA_A,
        notificationId: AVISO_NA_B,
        userId: USUARIO_DUPLO,
      })
    ).rejects.toThrow("Notificação não encontrada");

    const noBanco = await prisma.notification.findUniqueOrThrow({ where: { id: AVISO_NA_B } });
    expect(noBanco.lidaEm).toBeNull();
  });

  it("a sessão da B marca como lida o aviso dela", async () => {
    await marcarComoLida({
      companyId: EMPRESA_B,
      notificationId: AVISO_NA_B,
      userId: USUARIO_DUPLO,
    });

    const noBanco = await prisma.notification.findUniqueOrThrow({ where: { id: AVISO_NA_B } });
    expect(noBanco.lidaEm).not.toBeNull();
  });
});

describe("podarNotificacoes — a faxina de uma empresa não apaga a linha da outra", () => {
  it("SONDA (poda ANTIGA): sem `companyId`, o `deleteMany` alcançava as duas empresas", async () => {
    // O `where` que `podarNotificacoes` usava, sem apagar nada — só contando o
    // que ele teria levado. Se esta contagem parar de ver as duas empresas, a
    // fixture parou de produzir o estado que o caso abaixo testa.
    const corte = new Date(Date.now() - RETENCAO_ABSOLUTA_MS);
    const alcancadas = await prisma.notification.findMany({
      where: { criadoEm: { lt: corte }, userId: USUARIO_DUPLO },
    });

    const empresas = new Set(alcancadas.map((n) => n.companyId));
    expect(empresas.has(EMPRESA_A)).toBe(true);
    expect(empresas.has(EMPRESA_B)).toBe(true);
  });

  it("podar pela A leva a linha velha da A e deixa a da B", async () => {
    const removidas = await podarNotificacoes(EMPRESA_A);

    expect(removidas).toBeGreaterThanOrEqual(1);
    expect(await prisma.notification.findUnique({ where: { id: AVISO_VELHO_NA_A } })).toBeNull();
    expect(
      await prisma.notification.findUnique({ where: { id: AVISO_VELHO_NA_B } })
    ).not.toBeNull();
  });

  it("podar pela B leva a linha velha da B — a poda não parou de funcionar", async () => {
    await podarNotificacoes(EMPRESA_B);

    expect(await prisma.notification.findUnique({ where: { id: AVISO_VELHO_NA_B } })).toBeNull();
    expect(
      await prisma.notification.findUnique({ where: { id: AVISO_VELHO_NA_A } })
    ).not.toBeNull();
  });
});
