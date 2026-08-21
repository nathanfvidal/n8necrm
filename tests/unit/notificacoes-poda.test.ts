// Poda da tabela `Notification`, contra o Postgres real.
//
// Risco registrado na auditoria: nada nunca apagava notificação. Cada lead
// novo gera uma linha para o responsável; cada conversa que passa a aguardar
// humano gera UMA LINHA POR USUÁRIO ATIVO; e o alerta de rajada destrutiva
// (`core/audit/alerta.ts`) soma outra por ADMIN. A tabela só cresce, e cresce
// mais rápido quanto maior a equipe.
//
// Contra o banco real, e não mock, pelo mesmo motivo do alerta: o que pode
// estar errado aqui é o `where` — a distinção entre lida e não lida, e as duas
// janelas de retenção. Um `deleteMany` com predicado errado apagaria aviso
// pendente de gente de verdade, e mock nenhum pegaria isso.
import "dotenv/config";

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import {
  podarNotificacoes,
  RETENCAO_LIDA_MS,
  RETENCAO_ABSOLUTA_MS,
} from "../../src/core/notifications/dispatch";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const MARCA = "ZZPodaNotificacao";
const DIA_MS = 24 * 60 * 60_000;
let idDono = "";
// Empresa única do Ciclo 1a (mesma suposição de `prisma/seed.ts`) —
// `Notification.companyId` agora é obrigatório.
let companyId = "";

async function limpar() {
  const usuarios = await prisma.user.findMany({
    where: { nome: { contains: MARCA } },
    select: { id: true },
  });
  const ids = usuarios.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
}

beforeAll(async () => {
  await limpar();
  const empresa = await prisma.company.findFirstOrThrow();
  companyId = empresa.id;
  const dono = await prisma.user.create({
    data: {
      nome: `Dono ${MARCA}`,
      email: `poda-${MARCA.toLowerCase()}@teste.invalid`,
      senhaHash: "$2b$10$invalidoinvalidoinvalidoinvalidoinvalidoinvalidoinvalidoinva",
      ativo: false,
    },
  });
  idDono = dono.id;
});

afterAll(async () => {
  await limpar();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.notification.deleteMany({ where: { userId: idDono } });
});

/** Cria uma notificação do usuário de teste com idade e estado de leitura dados. */
async function criar(opcoes: { diasAtras: number; lida: boolean }) {
  const quando = new Date(Date.now() - opcoes.diasAtras * DIA_MS);
  return prisma.notification.create({
    data: {
      companyId,
      userId: idDono,
      tipo: "NOVO_LEAD",
      payload: { leadId: "x", contatoNome: MARCA },
      criadoEm: quando,
      lidaEm: opcoes.lida ? quando : null,
    },
  });
}

async function sobreviveu(id: string): Promise<boolean> {
  return (await prisma.notification.count({ where: { id } })) === 1;
}

describe("poda de notificacoes", () => {
  it("apaga notificacao LIDA mais velha que a retencao de lidas", async () => {
    const dias = RETENCAO_LIDA_MS / DIA_MS + 1;
    const alvo = await criar({ diasAtras: dias, lida: true });

    await podarNotificacoes(companyId);

    expect(await sobreviveu(alvo.id)).toBe(false);
  });

  it("PRESERVA notificacao lida recente", async () => {
    const alvo = await criar({ diasAtras: 1, lida: true });

    await podarNotificacoes(companyId);

    expect(await sobreviveu(alvo.id)).toBe(true);
  });

  // A regra que protege o usuário: aviso que ninguém viu ainda continua sendo
  // trabalho pendente, por mais velho que esteja. Apagar por idade um aviso
  // NÃO LIDO seria a poda escondendo justamente o que o sino existe para
  // mostrar.
  it("PRESERVA notificacao NAO LIDA mais velha que a retencao de lidas", async () => {
    const dias = RETENCAO_LIDA_MS / DIA_MS + 30;
    const alvo = await criar({ diasAtras: dias, lida: false });

    await podarNotificacoes(companyId);

    expect(await sobreviveu(alvo.id)).toBe(true);
  });

  // O limite dessa proteção: um aviso de meio ano que ninguém abriu não é
  // trabalho pendente, é entulho — e sem este corte a tabela voltaria a
  // crescer sem teto por conta de quem nunca clica no sino.
  it("apaga notificacao nao lida alem da retencao ABSOLUTA", async () => {
    const dias = RETENCAO_ABSOLUTA_MS / DIA_MS + 1;
    const alvo = await criar({ diasAtras: dias, lida: false });

    await podarNotificacoes(companyId);

    expect(await sobreviveu(alvo.id)).toBe(false);
  });

  it("a retencao absoluta e' bem maior que a de lidas", () => {
    expect(RETENCAO_ABSOLUTA_MS).toBeGreaterThan(RETENCAO_LIDA_MS);
  });

  it("devolve quantas linhas saíram", async () => {
    await criar({ diasAtras: RETENCAO_ABSOLUTA_MS / DIA_MS + 5, lida: false });
    await criar({ diasAtras: RETENCAO_LIDA_MS / DIA_MS + 5, lida: true });
    const preservada = await criar({ diasAtras: 1, lida: false });

    const removidas = await podarNotificacoes(companyId);

    expect(removidas).toBeGreaterThanOrEqual(2);
    expect(await sobreviveu(preservada.id)).toBe(true);
  });
});
