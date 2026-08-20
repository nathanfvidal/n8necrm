// Prisma e o SDK do Resend mockados (sem rede, sem credenciais, sem Postgres
// real) — mesmo raciocínio de tests/unit/storage.test.ts para a suíte do
// SupabaseStorage: prova o comportamento de RESILIÊNCIA de `dispatch.ts` que
// tests/unit/notifications.test.ts (Prisma real) NÃO consegue cobrir, porque
// `RESEND_API_KEY` não existe no `.env` deste projeto — decisão deliberada
// da Task 19, sem conta Resend real disponível. Este arquivo cobre os dois
// ramos que dependem de uma chave configurada:
//
// 1. Sem RESEND_API_KEY: `resend` é `null` no módulo — o e-mail nunca é
//    sequer tentado, só a notificação in-app é gravada.
// 2. Com RESEND_API_KEY configurada e o envio FALHANDO (Resend fora do ar,
//    ou qualquer erro do SDK): a notificação in-app já foi gravada antes, e
//    a função resolve sem lançar — spec seção 6, "falha de módulo secundário
//    nunca derruba o principal".
//
// `vi.resetModules()` + import dinâmico depois de setar `process.env.RESEND_API_KEY`
// é necessário porque `dispatch.ts` decide `resend = ... ? new Resend(...) : null`
// uma única vez, no top-level do módulo, na primeira importação — mesmo
// padrão usado por tests/unit/storage.test.ts para reconfigurar
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY entre casos.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { prismaFalsoEscopavel } from "./helpers/prisma-falso-escopavel";

vi.mock("server-only", () => ({}));

// `findFirstOrThrow`, e nao `findUniqueOrThrow`: o escopo por empresa recusa a
// segunda em modelo de tenant, lancando (ver "Recusa, lancando" em
// `core/tenancy/escopo.ts`). `Lead` e modelo de tenant.
const {
  leadFindFirstOrThrowMock,
  notificationCreateMock,
} = vi.hoisted(() => ({
  leadFindFirstOrThrowMock: vi.fn(),
  notificationCreateMock: vi.fn(),
}));

// O `$extends` de verdade (ver `tests/unit/helpers/prisma-falso-escopavel.ts`):
// `dispatch.ts` alcanca o banco por `prismaDaEmpresa(companyId)`, e um mock sem
// `$extends` quebra com `TypeError`.
vi.mock("@/lib/prisma", () => ({
  prisma: prismaFalsoEscopavel({
    lead: { findFirstOrThrow: leadFindFirstOrThrowMock },
    notification: { create: notificationCreateMock },
  }),
}));

const { resendSendMock, ResendMock } = vi.hoisted(() => {
  const resendSendMock = vi.fn();
  // `dispatch.ts` chama `new Resend(...)` — precisa ser algo instanciável
  // com `new`, não uma arrow function (que `new` rejeita em runtime).
  const ResendMock = vi.fn(function Resend() {
    return { emails: { send: resendSendMock } };
  });
  return { resendSendMock, ResendMock };
});
vi.mock("resend", () => ({ Resend: ResendMock }));

const EMPRESA = "empresa-1";
const LEAD_FAKE = {
  id: "lead-1",
  companyId: EMPRESA,
  contact: { id: "contact-1", nome: "Carlos Silva" },
  stage: { id: "stage-1", nome: "Novo" },
  responsavel: { id: "user-1", email: "responsavel@exemplo.com" },
};

const ORIGINAL_RESEND_API_KEY = process.env.RESEND_API_KEY;

async function importarDispatch() {
  vi.resetModules();
  const mod = await import("../../src/core/notifications/dispatch");
  return mod;
}

describe("notificarNovoLead — resiliência do envio de e-mail (Resend mockado)", () => {
  beforeEach(() => {
    leadFindFirstOrThrowMock.mockReset();
    notificationCreateMock.mockReset();
    ResendMock.mockClear();
    resendSendMock.mockReset();
    leadFindFirstOrThrowMock.mockResolvedValue(LEAD_FAKE);
    notificationCreateMock.mockResolvedValue({});
  });

  afterEach(() => {
    if (ORIGINAL_RESEND_API_KEY === undefined) {
      delete process.env.RESEND_API_KEY;
    } else {
      process.env.RESEND_API_KEY = ORIGINAL_RESEND_API_KEY;
    }
  });

  it(
    "sem RESEND_API_KEY (caso real deste projeto): grava a notificação in-app e NUNCA " +
      "instancia o cliente Resend nem tenta enviar e-mail",
    async () => {
      delete process.env.RESEND_API_KEY;
      const { notificarNovoLead } = await importarDispatch();

      await notificarNovoLead(EMPRESA, "lead-1");

      expect(notificationCreateMock).toHaveBeenCalledTimes(1);
      expect(ResendMock).not.toHaveBeenCalled();
      expect(resendSendMock).not.toHaveBeenCalled();
    }
  );

  it(
    "com RESEND_API_KEY configurada e o envio falhando: a notificação in-app já foi gravada " +
      "e a função resolve sem lançar — falha de e-mail não derruba o resto do fluxo",
    async () => {
      process.env.RESEND_API_KEY = "chave-de-teste";
      resendSendMock.mockRejectedValue(new Error("Resend fora do ar"));
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { notificarNovoLead } = await importarDispatch();

      await expect(notificarNovoLead(EMPRESA, "lead-1")).resolves.toBeUndefined();

      expect(notificationCreateMock).toHaveBeenCalledTimes(1);
      expect(resendSendMock).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    }
  );

  it("lead sem responsável: não grava notificação nem tenta enviar e-mail", async () => {
    delete process.env.RESEND_API_KEY;
    leadFindFirstOrThrowMock.mockResolvedValue({ ...LEAD_FAKE, responsavel: null });
    const { notificarNovoLead } = await importarDispatch();

    await notificarNovoLead(EMPRESA, "lead-1");

    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(resendSendMock).not.toHaveBeenCalled();
  });
});
