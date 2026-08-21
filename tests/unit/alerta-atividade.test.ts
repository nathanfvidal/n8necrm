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
// Empresa do suspeito e dos dois ADMINs "normais" deste arquivo. A suíte
// inteira, salvo o caso de isolamento por empresa abaixo, roda dentro dela —
// mesma suposição de `prisma/seed.ts`, que só semeia uma. O caso que prova
// isolamento cria a SEGUNDA empresa localmente e a desfaz no próprio `finally`,
// sem tocar nesta.
let companyId = "";

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

  const empresa = await prisma.company.findFirstOrThrow();
  companyId = empresa.id;

  const suspeito = await prisma.user.create({
    data: {
      nome: `Suspeito ${MARCA}`,
      email: `suspeito-${MARCA.toLowerCase()}@teste.invalid`,
      senhaHash: HASH_INERTE,
      ativo: true,
    },
  });
  // O vínculo continua obrigatório aqui, mas por outro motivo desde o Ciclo 1d:
  // `avaliarAtividadeSuspeita` já NÃO resolve a empresa do suspeito (ela chega
  // por parâmetro, de `ParamsDeAuditoria.companyId`) — é a busca de
  // DESTINATÁRIOS que parte de `Membership`, e é ela que define quem é ADMIN
  // desta empresa. Sem o vínculo, o suspeito e os admins seriam invisíveis para
  // aquela consulta e nenhum alerta sairia.
  await prisma.membership.create({
    data: { userId: suspeito.id, companyId, papel: "VENDEDOR" },
  });
  const adminA = await prisma.user.create({
    data: {
      nome: `AdminA ${MARCA}`,
      email: `admina-${MARCA.toLowerCase()}@teste.invalid`,
      senhaHash: HASH_INERTE,
      ativo: true,
    },
  });
  const adminB = await prisma.user.create({
    data: {
      nome: `AdminB ${MARCA}`,
      email: `adminb-${MARCA.toLowerCase()}@teste.invalid`,
      senhaHash: HASH_INERTE,
      ativo: true,
    },
  });
  // Os dois precisam de `Membership` ADMIN NESTA `companyId` — desde o reparo
  // de escopo por empresa, `avaliarAtividadeSuspeita` busca destinatários em
  // `prisma.membership`, não mais em `prisma.user`. Sem este vínculo, os dois
  // ficam invisíveis para a consulta e todo teste que espera notificação
  // falha com zero destinatários — foi exatamente o que aconteceu ao rodar a
  // suíte antes desta correção: `User.papel = "ADMIN"` sozinho não basta mais,
  // é `Membership.papel = "ADMIN"` na empresa certa que conta.
  await prisma.membership.create({
    data: { userId: adminA.id, companyId, papel: "ADMIN" },
  });
  await prisma.membership.create({
    data: { userId: adminB.id, companyId, papel: "ADMIN" },
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
      data: { companyId, userId: idSuspeito, acao, entidade: "Task", entidadeId: `alvo-${i}` },
    });
  }
}

/**
 * Alertas recebidos pelos admins deste teste **sobre o suspeito deste teste**.
 *
 * O filtro por `autorNome` não é zelo: os dois admins criados aqui são ADMIN
 * ATIVO de verdade, então enquanto este arquivo roda eles são destinatários
 * elegíveis de qualquer alerta disparado por OUTRO arquivo da suíte — e a
 * suíte roda em paralelo. `users-service.test.ts` sozinho produz 7 ações
 * sensíveis; somadas às de outros arquivos com o mesmo autor do seed, cruzam
 * o gatilho de 10 em 5 minutos e o alerta pousa aqui.
 *
 * Foi exatamente isso: uma falha em três execuções da suíte completa, verde
 * quando rodado isolado. Contar por `tipo` sozinho fazia este teste depender
 * do que os vizinhos estavam fazendo.
 */
async function alertasRecebidos(): Promise<number> {
  const todos = await prisma.notification.findMany({
    where: { userId: { in: [idAdminA, idAdminB] }, tipo: TIPO_ALERTA_ATIVIDADE },
  });
  return todos.filter((n) =>
    String((n.payload as { autorNome?: string } | null)?.autorNome ?? "").includes(MARCA)
  ).length;
}

describe("alerta de atividade destrutiva em rajada", () => {
  it("abaixo do limite, ninguem e incomodado", async () => {
    await registrarRajada(LIMITE_ALERTA - 1);

    await avaliarAtividadeSuspeita({ companyId, userId: idSuspeito, acao: ACOES_SENSIVEIS[0] });

    expect(await alertasRecebidos()).toBe(0);
  });

  it("atingido o limite, TODO admin ativo DESTA EMPRESA recebe o alerta", async () => {
    await registrarRajada(LIMITE_ALERTA);

    await avaliarAtividadeSuspeita({ companyId, userId: idSuspeito, acao: ACOES_SENSIVEIS[0] });

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
    // Só `Membership.papel`: é de lá que a consulta de destinatários lê
    // (`core/audit/alerta.ts`, escopado por empresa desde 3744e64), e a coluna
    // espelho `User.papel`, que este bloco também atualizava, deixou de ser
    // escrita no Ciclo 1f. O `finally` desfaz só esta linha pelo mesmo motivo.
    await prisma.membership.updateMany({
      where: { userId: idSuspeito, companyId },
      data: { papel: "ADMIN" },
    });
    try {
      await registrarRajada(LIMITE_ALERTA);

      await avaliarAtividadeSuspeita({ companyId, userId: idSuspeito, acao: ACOES_SENSIVEIS[0] });

      // Mesmo escopo por `autorNome` de `alertasRecebidos`, e pela mesma
      // razão: aqui o suspeito está temporariamente ADMIN e ATIVO, então ele
      // também é destinatário elegível de alerta disparado por outro arquivo
      // da suíte rodando em paralelo.
      const doSuspeito = await prisma.notification.findMany({
        where: { userId: idSuspeito, tipo: TIPO_ALERTA_ATIVIDADE },
      });
      const sobreEleMesmo = doSuspeito.filter((n) =>
        String((n.payload as { autorNome?: string } | null)?.autorNome ?? "").includes(MARCA)
      );
      expect(sobreEleMesmo).toHaveLength(0);
      expect(await alertasRecebidos()).toBe(2);
    } finally {
      await prisma.membership.updateMany({
        where: { userId: idSuspeito, companyId },
        data: { papel: "VENDEDOR" },
      });
    }
  });

  // Sem silêncio, a 11a, 12a, 13a ação destrutiva gerariam um alerta cada —
  // e o sino do admin viraria ruído justamente durante o incidente.
  it("nao repete o alerta a cada acao seguinte dentro da janela de silencio", async () => {
    await registrarRajada(LIMITE_ALERTA);

    await avaliarAtividadeSuspeita({ companyId, userId: idSuspeito, acao: ACOES_SENSIVEIS[0] });
    await registrarRajada(3);
    await avaliarAtividadeSuspeita({ companyId, userId: idSuspeito, acao: ACOES_SENSIVEIS[0] });
    await avaliarAtividadeSuspeita({ companyId, userId: idSuspeito, acao: ACOES_SENSIVEIS[0] });

    expect(await alertasRecebidos()).toBe(2); // um por admin, nao seis
  });

  // Trabalho normal em volume não pode acordar ninguém: mover 40 leads pelo
  // funil numa segunda-feira é uso legítimo e intenso, não sabotagem.
  it("acao fora do conjunto vigiado nao conta e nao dispara", async () => {
    await registrarRajada(LIMITE_ALERTA * 2, "mover_etapa");

    await avaliarAtividadeSuspeita({ companyId, userId: idSuspeito, acao: "mover_etapa" });

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

    await avaliarAtividadeSuspeita({ companyId, userId: idSuspeito, acao: ACOES_SENSIVEIS[0] });

    expect(await alertasRecebidos()).toBe(0);
  });

  // O conjunto é contado JUNTO, de propósito: quem apaga 4 notas, arquiva 4
  // leads e apaga 3 tarefas passaria por baixo de qualquer limite por tipo,
  // enquanto está claramente destruindo coisa.
  it("acoes sensiveis de tipos DIFERENTES somam no mesmo contador", async () => {
    for (let i = 0; i < LIMITE_ALERTA; i++) {
      await prisma.auditLog.create({
        data: {
          companyId,
          userId: idSuspeito,
          acao: ACOES_SENSIVEIS[i % ACOES_SENSIVEIS.length],
          entidade: "Lead",
          entidadeId: `misto-${i}`,
        },
      });
    }

    await avaliarAtividadeSuspeita({ companyId, userId: idSuspeito, acao: ACOES_SENSIVEIS[0] });

    expect(await alertasRecebidos()).toBe(2);
  });

  // Ação antiga não pode empurrar o contador: a janela é curta de propósito,
  // porque o que caracteriza sabotagem é a RAJADA, não o total histórico.
  it("acao fora da janela de tempo nao conta", async () => {
    const antigo = new Date(Date.now() - 60 * 60_000);
    for (let i = 0; i < LIMITE_ALERTA * 2; i++) {
      await prisma.auditLog.create({
        data: {
          companyId,
          userId: idSuspeito,
          acao: ACOES_SENSIVEIS[0],
          entidade: "Task",
          entidadeId: `antigo-${i}`,
          criadoEm: antigo,
        },
      });
    }

    await avaliarAtividadeSuspeita({ companyId, userId: idSuspeito, acao: ACOES_SENSIVEIS[0] });

    expect(await alertasRecebidos()).toBe(0);
  });

  // O entregável real do reparo: antes, a consulta de destinatários vinha de
  // `prisma.user` direto, sem `companyId` nenhum, e QUALQUER ADMIN ativo no
  // banco era notificado — inclusive o de uma empresa que não tem nada a ver
  // com a rajada. Este caso cria uma SEGUNDA empresa, com seu próprio ADMIN,
  // e prova que o alerta da empresa do suspeito não vaza para ela: alerta de
  // segurança de um cliente não pode chegar a outro.
  it("ADMIN de OUTRA empresa nao recebe alerta de rajada desta empresa", async () => {
    const outraEmpresa = await prisma.company.create({
      data: { nome: `${MARCA} Outra Empresa` },
    });
    const adminOutraEmpresa = await prisma.user.create({
      data: {
        nome: `AdminOutraEmpresa ${MARCA}`,
        email: `admin-outra-empresa-${MARCA.toLowerCase()}@teste.invalid`,
        senhaHash: HASH_INERTE,
        ativo: true,
      },
    });
    await prisma.membership.create({
      data: { userId: adminOutraEmpresa.id, companyId: outraEmpresa.id, papel: "ADMIN" },
    });

    try {
      await registrarRajada(LIMITE_ALERTA);

      await avaliarAtividadeSuspeita({ companyId, userId: idSuspeito, acao: ACOES_SENSIVEIS[0] });

      const doOutraEmpresa = await prisma.notification.findMany({
        where: { userId: adminOutraEmpresa.id, tipo: TIPO_ALERTA_ATIVIDADE },
      });
      expect(doOutraEmpresa).toHaveLength(0);

      // A exclusão é por empresa, não uma falha geral de envio: os ADMINs da
      // MESMA empresa do suspeito continuam recebendo normalmente.
      expect(await alertasRecebidos()).toBe(2);
    } finally {
      // Nesta ordem: User (cascade leva o Membership) antes da Company,
      // mesmo raciocínio do `recusa editar quem não tem vínculo com esta
      // empresa` em `users-service.test.ts`.
      await prisma.notification.deleteMany({ where: { userId: adminOutraEmpresa.id } });
      await prisma.user.delete({ where: { id: adminOutraEmpresa.id } });
      await prisma.company.delete({ where: { id: outraEmpresa.id } });
    }
  });
});
