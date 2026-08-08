// Detecção de atividade destrutiva em rajada, provada contra o POSTGRES REAL.
//
// Mock aqui seria pior que inútil: o que pode estar errado neste código é
// exatamente o FORMATO DA CONSULTA — a janela de tempo (`criadoEm: { gte }`),
// o conjunto de ações vigiadas (`acao: { in }`) e o escopo por autor. Um
// `count` com o `where` errado passaria num teste mockado e nunca alertaria
// em produção. Mesma razão documentada em `dono-integracao.test.ts`.
//
// ## Por que este controle existe
//
// Decisão do dono do projeto, na auditoria: exclusão precisa deixar log "por
// se alguém quiser sabotar a empresa". O log passou a existir — mas log que
// ninguém lê não impede nada, só permite reconstituir o estrago depois. Isto
// é a outra metade: alguém FICA SABENDO enquanto está acontecendo.
//
// Note a assimetria com um limite de taxa, que é o ponto do desenho: alertar
// não bloqueia nada. Um falso positivo custa uma notificação a um ADMIN, não
// trabalho barrado. Por isso o gatilho aqui pode ser bem mais apertado do que
// qualquer teto de escrita poderia ser sem atrapalhar quem trabalha.
import "dotenv/config";

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import {
  avaliarAtividadeSuspeita,
  ACOES_SENSIVEIS,
  LIMITE_ALERTA,
  TIPO_ALERTA_ATIVIDADE,
} from "../../src/core/audit/alerta";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const MARCA = "ZZAlertaAtividade";

let idSuspeito = "";
let idAdminA = "";
let idAdminB = "";

/**
 * Limpeza por marca. As notificações são filtradas EM MEMÓRIA pelo
 * `autorNome` gravado no payload — não por `tipo` — porque apagar por
 * `tipo: "ALERTA_ATIVIDADE"` levaria junto alertas legítimos deste banco, que
 * é compartilhado com produção. Mesma técnica que `stage-transition.test.ts`
 * usa para as notificações de novo lead.
 */
async function limpar() {
  const notificacoes = await prisma.notification.findMany({
    where: { tipo: TIPO_ALERTA_ATIVIDADE },
  });
  const idsParaApagar = notificacoes
    .filter((n) => String((n.payload as { autorNome?: string } | null)?.autorNome ?? "").includes(MARCA))
    .map((n) => n.id);
  if (idsParaApagar.length > 0) {
    await prisma.notification.deleteMany({ where: { id: { in: idsParaApagar } } });
  }

  const usuarios = await prisma.user.findMany({
    where: { nome: { contains: MARCA } },
    select: { id: true },
  });
  const ids = usuarios.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.rateLimit.deleteMany({
      where: { chave: { in: ids.map((id) => `alerta:atividade:${id}`) } },
    });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
}

// Senha inerte: nenhuma destas contas faz login. O hash é literal e não
// corresponde a senha nenhuma.
const HASH_INERTE = "$2b$10$invalidoinvalidoinvalidoinvalidoinvalidoinvalidoinvalidoinva";

beforeAll(async () => {
  await limpar();

  const suspeito = await prisma.user.create({
    data: {
      nome: `Suspeito ${MARCA}`,
      email: `suspeito-${MARCA.toLowerCase()}@teste.invalid`,
      senhaHash: HASH_INERTE,
      papel: "VENDEDOR",
      ativo: true,
    },
  });
  const adminA = await prisma.user.create({
    data: {
      nome: `AdminA ${MARCA}`,
      email: `admina-${MARCA.toLowerCase()}@teste.invalid`,
      senhaHash: HASH_INERTE,
      papel: "ADMIN",
      ativo: true,
    },
  });
  const adminB = await prisma.user.create({
    data: {
      nome: `AdminB ${MARCA}`,
      email: `adminb-${MARCA.toLowerCase()}@teste.invalid`,
      senhaHash: HASH_INERTE,
      papel: "ADMIN",
      ativo: true,
    },
  });
  idSuspeito = suspeito.id;
  idAdminA = adminA.id;
  idAdminB = adminB.id;
});

afterAll(async () => {
  await limpar();
  await prisma.$disconnect();
});

/** Zera só o rastro entre casos, mantendo os usuários criados no `beforeAll`. */
beforeEach(async () => {
  await prisma.auditLog.deleteMany({ where: { userId: idSuspeito } });
  await prisma.notification.deleteMany({
    where: { userId: { in: [idAdminA, idAdminB, idSuspeito] } },
  });
  await prisma.rateLimit.deleteMany({ where: { chave: `alerta:atividade:${idSuspeito}` } });
});

/** Grava `quantas` ações sensíveis do suspeito, agora. */
async function registrarRajada(quantas: number, acao: string = ACOES_SENSIVEIS[0]) {
  for (let i = 0; i < quantas; i++) {
    await prisma.auditLog.create({
      data: { userId: idSuspeito, acao, entidade: "Task", entidadeId: `alvo-${i}` },
    });
  }
}

async function alertasRecebidos(): Promise<number> {
  return prisma.notification.count({
    where: { userId: { in: [idAdminA, idAdminB] }, tipo: TIPO_ALERTA_ATIVIDADE },
  });
}

describe("alerta de atividade destrutiva em rajada", () => {
  it("abaixo do limite, ninguem e incomodado", async () => {
    await registrarRajada(LIMITE_ALERTA - 1);

    await avaliarAtividadeSuspeita({ userId: idSuspeito, acao: ACOES_SENSIVEIS[0] });

    expect(await alertasRecebidos()).toBe(0);
  });

  it("atingido o limite, TODO admin ativo recebe o alerta", async () => {
    await registrarRajada(LIMITE_ALERTA);

    await avaliarAtividadeSuspeita({ userId: idSuspeito, acao: ACOES_SENSIVEIS[0] });

    const notificacoes = await prisma.notification.findMany({
      where: { userId: { in: [idAdminA, idAdminB] }, tipo: TIPO_ALERTA_ATIVIDADE },
    });
    expect(notificacoes).toHaveLength(2);

    const payload = notificacoes[0].payload as { autorNome: string; total: number };
    expect(payload.autorNome).toContain(MARCA);
    expect(payload.total).toBeGreaterThanOrEqual(LIMITE_ALERTA);
  });

  // Avisar o próprio suspeito não protege ninguém — só entrega que ele foi
  // percebido. Se o saboteur for ADMIN, os OUTROS admins é que precisam saber.
  it("o proprio autor NAO recebe alerta sobre si mesmo, mesmo sendo admin", async () => {
    await prisma.user.update({ where: { id: idSuspeito }, data: { papel: "ADMIN" } });
    try {
      await registrarRajada(LIMITE_ALERTA);

      await avaliarAtividadeSuspeita({ userId: idSuspeito, acao: ACOES_SENSIVEIS[0] });

      expect(
        await prisma.notification.count({
          where: { userId: idSuspeito, tipo: TIPO_ALERTA_ATIVIDADE },
        })
      ).toBe(0);
      expect(await alertasRecebidos()).toBe(2);
    } finally {
      await prisma.user.update({ where: { id: idSuspeito }, data: { papel: "VENDEDOR" } });
    }
  });

  // Sem silêncio, a 11a, 12a, 13a ação destrutiva gerariam um alerta cada —
  // e o sino do admin viraria ruído justamente durante o incidente.
  it("nao repete o alerta a cada acao seguinte dentro da janela de silencio", async () => {
    await registrarRajada(LIMITE_ALERTA);

    await avaliarAtividadeSuspeita({ userId: idSuspeito, acao: ACOES_SENSIVEIS[0] });
    await registrarRajada(3);
    await avaliarAtividadeSuspeita({ userId: idSuspeito, acao: ACOES_SENSIVEIS[0] });
    await avaliarAtividadeSuspeita({ userId: idSuspeito, acao: ACOES_SENSIVEIS[0] });

    expect(await alertasRecebidos()).toBe(2); // um por admin, nao seis
  });

  // Trabalho normal em volume não pode acordar ninguém: mover 40 leads pelo
  // funil numa segunda-feira é uso legítimo e intenso, não sabotagem.
  it("acao fora do conjunto vigiado nao conta e nao dispara", async () => {
    await registrarRajada(LIMITE_ALERTA * 2, "mover_etapa");

    await avaliarAtividadeSuspeita({ userId: idSuspeito, acao: "mover_etapa" });

    expect(await alertasRecebidos()).toBe(0);
  });

  // O teste acima passa pelo guard de entrada (`mover_etapa` nem é ação
  // sensível, então a função retorna antes de consultar) — ou seja, ele NÃO
  // exercita o filtro `acao: { in: ... }` do contador. A sabotagem provou
  // isso: remover aquele filtro deixava os 7 testes verdes.
  //
  // Este caso fecha o buraco: a ação que ENTRA é sensível, então o contador
  // roda de verdade; o ruído de trabalho normal ao redor só pode ser ignorado
  // se o `where` filtrar por ação. Sem o filtro, as 20 movimentações
  // empurrariam o total para 22 e dispararia alarme por trabalho legítimo.
  it("volume de trabalho normal ao redor NAO empurra o contador de acoes sensiveis", async () => {
    await registrarRajada(20, "mover_etapa");
    await registrarRajada(2, ACOES_SENSIVEIS[0]);

    await avaliarAtividadeSuspeita({ userId: idSuspeito, acao: ACOES_SENSIVEIS[0] });

    expect(await alertasRecebidos()).toBe(0);
  });

  // O conjunto é contado JUNTO, de propósito: quem apaga 4 notas, arquiva 4
  // leads e apaga 3 tarefas passaria por baixo de qualquer limite por tipo,
  // enquanto está claramente destruindo coisa.
  it("acoes sensiveis de tipos DIFERENTES somam no mesmo contador", async () => {
    for (let i = 0; i < LIMITE_ALERTA; i++) {
      await prisma.auditLog.create({
        data: {
          userId: idSuspeito,
          acao: ACOES_SENSIVEIS[i % ACOES_SENSIVEIS.length],
          entidade: "Lead",
          entidadeId: `misto-${i}`,
        },
      });
    }

    await avaliarAtividadeSuspeita({ userId: idSuspeito, acao: ACOES_SENSIVEIS[0] });

    expect(await alertasRecebidos()).toBe(2);
  });

  // Ação antiga não pode empurrar o contador: a janela é curta de propósito,
  // porque o que caracteriza sabotagem é a RAJADA, não o total histórico.
  it("acao fora da janela de tempo nao conta", async () => {
    const antigo = new Date(Date.now() - 60 * 60_000);
    for (let i = 0; i < LIMITE_ALERTA * 2; i++) {
      await prisma.auditLog.create({
        data: {
          userId: idSuspeito,
          acao: ACOES_SENSIVEIS[0],
          entidade: "Task",
          entidadeId: `antigo-${i}`,
          criadoEm: antigo,
        },
      });
    }

    await avaliarAtividadeSuspeita({ userId: idSuspeito, acao: ACOES_SENSIVEIS[0] });

    expect(await alertasRecebidos()).toBe(0);
  });
});
