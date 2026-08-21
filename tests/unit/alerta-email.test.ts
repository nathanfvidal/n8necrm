// O alerta de rajada destrutiva sai TAMBÉM por e-mail — achado 40 da
// auditoria de segurança.
//
// ## O que este arquivo prova, e o que ele deliberadamente NÃO prova
//
// A DETECÇÃO (janela, conjunto de ações, escopo por empresa) é provada contra
// o Postgres real em `alerta-atividade.test.ts`, e com razão: um `where`
// errado passa por qualquer mock. Aqui o Prisma é mockado de propósito, porque
// o que se prova é outra coisa — o DESPACHO: quem recebe e-mail, em que ordem
// em relação à notificação in-app, e o que acontece quando `RESEND_API_KEY`
// não existe (o caso real deste projeto, em que o caminho de rede NUNCA é
// exercitado contra o banco de verdade).
//
// Mesma divisão de trabalho que `notification-email-resilience.test.ts` tem
// com `notifications.test.ts` para o caminho de novo lead.
//
// `vi.resetModules()` + import dinâmico depois de mexer em
// `process.env.RESEND_API_KEY` é obrigatório: `email-envio.ts` decide
// `resend = ... ? new Resend(...) : null` uma vez só, no topo do módulo, na
// primeira importação.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { prismaFalsoEscopavel } from "./helpers/prisma-falso-escopavel";

vi.mock("server-only", () => ({}));

const {
  auditLogCountMock,
  membershipFindManyMock,
  userFindUniqueMock,
  notificationCreateManyMock,
} = vi.hoisted(() => ({
  auditLogCountMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  notificationCreateManyMock: vi.fn(),
}));

// `$extends` de verdade (ver o helper): `alerta.ts` alcança o banco por
// `prismaDaEmpresa(companyId)`, e um mock sem `$extends` quebra com TypeError.
vi.mock("@/lib/prisma", () => ({
  prisma: prismaFalsoEscopavel({
    auditLog: { count: auditLogCountMock },
    membership: { findMany: membershipFindManyMock },
    user: { findUnique: userFindUniqueMock },
    notification: { createMany: notificationCreateManyMock },
  }),
}));

const { checarRateLimitMock } = vi.hoisted(() => ({ checarRateLimitMock: vi.fn() }));
vi.mock("@/core/rate-limit/limiter", () => ({
  checarRateLimit: (...args: unknown[]) => checarRateLimitMock(...args),
}));

const { resendSendMock, ResendMock } = vi.hoisted(() => {
  const resendSendMock = vi.fn();
  // Precisa ser instanciável com `new` — arrow function é recusada em runtime.
  const ResendMock = vi.fn(function Resend() {
    return { emails: { send: resendSendMock } };
  });
  return { resendSendMock, ResendMock };
});
vi.mock("resend", () => ({ Resend: ResendMock }));

const EMPRESA = "empresa-1";
const SUSPEITO = "user-suspeito";
const ADMIN_A = { userId: "admin-a", user: { email: "admin-a@exemplo.com" } };
const ADMIN_B = { userId: "admin-b", user: { email: "admin-b@exemplo.com" } };

const ORIGINAL_RESEND_API_KEY = process.env.RESEND_API_KEY;

async function importarAlerta() {
  vi.resetModules();
  return import("../../src/core/audit/alerta");
}

/** Uma rajada fechada: contagem no limite, silêncio livre, dois ADMINs. */
function cenarioDeRajada() {
  auditLogCountMock.mockResolvedValue(999);
  checarRateLimitMock.mockResolvedValue(true);
  membershipFindManyMock.mockResolvedValue([ADMIN_A, ADMIN_B]);
  userFindUniqueMock.mockResolvedValue({ nome: "Fulano Suspeito" });
  notificationCreateManyMock.mockResolvedValue({ count: 2 });
}

describe("alerta de rajada — despacho por e-mail (Resend mockado)", () => {
  beforeEach(() => {
    auditLogCountMock.mockReset();
    membershipFindManyMock.mockReset();
    userFindUniqueMock.mockReset();
    notificationCreateManyMock.mockReset();
    checarRateLimitMock.mockReset();
    ResendMock.mockClear();
    resendSendMock.mockReset().mockResolvedValue({ id: "email-1" });
    cenarioDeRajada();
  });

  afterEach(() => {
    if (ORIGINAL_RESEND_API_KEY === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = ORIGINAL_RESEND_API_KEY;
  });

  // O achado 40, em uma frase: lead novo rendia e-mail, rajada destrutiva
  // rendia só um badge no sino.
  it("com RESEND_API_KEY: cada ADMIN destinatário recebe UM e-mail, além do sino", async () => {
    process.env.RESEND_API_KEY = "chave-de-teste";
    const { avaliarAtividadeSuspeita, ACOES_SENSIVEIS } = await importarAlerta();

    await avaliarAtividadeSuspeita({
      companyId: EMPRESA,
      userId: SUSPEITO,
      acao: ACOES_SENSIVEIS[0],
    });

    expect(notificationCreateManyMock).toHaveBeenCalledTimes(1);
    expect(resendSendMock).toHaveBeenCalledTimes(2);

    const destinos = resendSendMock.mock.calls.map((c) => (c[0] as { to: string }).to);
    expect(destinos.sort()).toEqual(["admin-a@exemplo.com", "admin-b@exemplo.com"]);
  });

  // Um `to: [a, b]` num envio só exporia a caixa de cada ADMIN para os outros,
  // e uma recusa a um endereço derrubaria a mensagem dos demais.
  it("um envio POR destinatário, nunca um envio com a lista toda no `to`", async () => {
    process.env.RESEND_API_KEY = "chave-de-teste";
    const { avaliarAtividadeSuspeita, ACOES_SENSIVEIS } = await importarAlerta();

    await avaliarAtividadeSuspeita({
      companyId: EMPRESA,
      userId: SUSPEITO,
      acao: ACOES_SENSIVEIS[0],
    });

    for (const chamada of resendSendMock.mock.calls) {
      expect(Array.isArray((chamada[0] as { to: unknown }).to)).toBe(false);
    }
  });

  // A ordem é a mesma regra de `dispatch.ts`: o canal que não depende de
  // terceiro é o que não pode faltar. Se o e-mail fosse primeiro, um Resend
  // pendurado atrasaria a gravação do alerta que já podia estar no sino.
  it("grava o sino ANTES de tentar e-mail", async () => {
    process.env.RESEND_API_KEY = "chave-de-teste";
    const ordem: string[] = [];
    notificationCreateManyMock.mockImplementation(async () => {
      ordem.push("sino");
      return { count: 2 };
    });
    resendSendMock.mockImplementation(async () => {
      ordem.push("email");
      return { id: "email-1" };
    });

    const { avaliarAtividadeSuspeita, ACOES_SENSIVEIS } = await importarAlerta();
    await avaliarAtividadeSuspeita({
      companyId: EMPRESA,
      userId: SUSPEITO,
      acao: ACOES_SENSIVEIS[0],
    });

    expect(ordem).toEqual(["sino", "email", "email"]);
  });

  // O caso real deste projeto hoje: a chave fica de fora do `.env` (Task 19,
  // sem conta Resend). O caminho tem que degradar, não quebrar — e o
  // comportamento observável volta a ser exatamente o de antes do achado 40.
  it("sem RESEND_API_KEY: o sino é gravado, o cliente Resend nem é instanciado", async () => {
    delete process.env.RESEND_API_KEY;
    const { avaliarAtividadeSuspeita, ACOES_SENSIVEIS } = await importarAlerta();

    await expect(
      avaliarAtividadeSuspeita({ companyId: EMPRESA, userId: SUSPEITO, acao: ACOES_SENSIVEIS[0] })
    ).resolves.toBeUndefined();

    expect(notificationCreateManyMock).toHaveBeenCalledTimes(1);
    expect(ResendMock).not.toHaveBeenCalled();
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  it("Resend fora do ar: o sino já está gravado e a função resolve sem lançar", async () => {
    process.env.RESEND_API_KEY = "chave-de-teste";
    resendSendMock.mockRejectedValue(new Error("Resend fora do ar"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { avaliarAtividadeSuspeita, ACOES_SENSIVEIS } = await importarAlerta();

    await expect(
      avaliarAtividadeSuspeita({ companyId: EMPRESA, userId: SUSPEITO, acao: ACOES_SENSIVEIS[0] })
    ).resolves.toBeUndefined();

    expect(notificationCreateManyMock).toHaveBeenCalledTimes(1);
    // Os DOIS foram tentados: uma falha para o primeiro ADMIN não pode calar o
    // alerta do segundo.
    expect(resendSendMock).toHaveBeenCalledTimes(2);
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  // O silêncio de 30 min é a razão de o e-mail ser aceitável: sem ele, a 11ª,
  // 12ª e 13ª ação da rajada renderiam um e-mail cada, e o ADMIN criaria uma
  // regra de caixa de entrada para o alerta — o controle morreria em silêncio.
  it("dentro da janela de silêncio, NEM sino NEM e-mail: a trava vale para os dois", async () => {
    process.env.RESEND_API_KEY = "chave-de-teste";
    checarRateLimitMock.mockResolvedValue(false);

    const { avaliarAtividadeSuspeita, ACOES_SENSIVEIS } = await importarAlerta();
    await avaliarAtividadeSuspeita({
      companyId: EMPRESA,
      userId: SUSPEITO,
      acao: ACOES_SENSIVEIS[0],
    });

    expect(notificationCreateManyMock).not.toHaveBeenCalled();
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  // Abaixo do limite nada acontece — e, sobretudo, o e-mail não pode ter
  // criado um caminho que escape do gatilho.
  it("abaixo do limite: nenhum e-mail, nenhuma consulta de destinatário", async () => {
    process.env.RESEND_API_KEY = "chave-de-teste";
    const { avaliarAtividadeSuspeita, ACOES_SENSIVEIS, LIMITE_ALERTA } = await importarAlerta();
    auditLogCountMock.mockResolvedValue(LIMITE_ALERTA - 1);

    await avaliarAtividadeSuspeita({
      companyId: EMPRESA,
      userId: SUSPEITO,
      acao: ACOES_SENSIVEIS[0],
    });

    expect(membershipFindManyMock).not.toHaveBeenCalled();
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  // O e-mail vai para quem a consulta de destinatários devolveu, e ela parte de
  // `Membership` ESCOPADO na empresa (correção de 3744e64, Ciclo 1a). Este caso
  // é a metade que o mock consegue provar: o `where` chega com `companyId` da
  // empresa do suspeito, e o autor está no `notIn` — avisar o suspeito não
  // protege ninguém, e por e-mail seria pior ainda (ele saberia na hora).
  it("a lista de e-mails sai do Membership escopado na empresa, sem o autor", async () => {
    process.env.RESEND_API_KEY = "chave-de-teste";
    const { avaliarAtividadeSuspeita, ACOES_SENSIVEIS } = await importarAlerta();

    await avaliarAtividadeSuspeita({
      companyId: EMPRESA,
      userId: SUSPEITO,
      acao: ACOES_SENSIVEIS[0],
    });

    const argumentos = membershipFindManyMock.mock.calls[0]![0] as {
      where: { companyId: string; papel: string; userId: { notIn: string[] } };
      select: Record<string, unknown>;
    };
    // `companyId` não está escrito em `alerta.ts` — quem o injeta é o escopo,
    // e é por isso que o helper aplica a extensão de verdade.
    expect(argumentos.where.companyId).toBe(EMPRESA);
    expect(argumentos.where.papel).toBe("ADMIN");
    expect(argumentos.where.userId.notIn).toContain(SUSPEITO);
    // `user: true` traria `senhaHash` — a consulta pede o e-mail e nada mais.
    expect(argumentos.select.user).toEqual({ select: { email: true } });
  });
});
