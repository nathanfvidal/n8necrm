// Este arquivo (junto com dedupe.test.ts, stage-transition.test.ts,
// lead-notes.test.ts, lead-queries.test.ts, seed.test.ts,
// pipeline-stages.test.ts, rate-limit.test.ts, audit-log.test.ts e
// notifications.test.ts) usa o Prisma real contra o Postgres do Supabase,
// então carrega DATABASE_URL do .env aqui — não em vitest.config.ts — para
// não injetar credenciais em testes que não tocam banco. Precisa ser o
// primeiro import: os módulos abaixo (via src/lib/prisma.ts → src/lib/env.ts)
// leem process.env.DATABASE_URL no top-level.
import "dotenv/config";

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// "server-only" só resolve para um no-op sob a condição de resolução
// "react-server" que o Next.js aplica no build — fora desse pipeline (aqui,
// sob Vitest) ele sempre lança, independente de quem importa (ver
// tests/unit/storage.test.ts, onde este mock foi documentado pela primeira
// vez). `src/lib/prisma.ts` e `src/core/notifications/dispatch.ts` têm
// `import "server-only"`; este arquivo importa `prisma` direto (via
// `criarLead`) — sem mockar aqui, TODO teste deste arquivo quebraria na
// importação, não por causa da lógica testada.
vi.mock("server-only", () => ({}));

// Mocka SÓ `notificarNovoLead` — `criarLead` (service.ts) continua usando o
// Prisma REAL para o próprio lead e a auditoria (não mockamos `@/lib/prisma`
// neste arquivo). Isso isola exatamente a pergunta que este arquivo existe
// para responder: quando o módulo de notificação lança, o lead e o
// AuditLog — já gravados antes da chamada a `notificarNovoLead` dentro de
// `criarLead` — sobrevivem?
const notificarNovoLeadMock = vi.fn();
vi.mock("@/core/notifications/dispatch", () => ({
  notificarNovoLead: (...args: unknown[]) => notificarNovoLeadMock(...args),
}));

import { prisma } from "../../src/lib/prisma";
import { criarLead } from "../../src/core/leads/service";

// Telefone JÁ NORMALIZADO que este arquivo grava. Prefixo "119444" é
// exclusivo deste arquivo — não colide com o seed da Task 9
// (`1199999000{0..3}`), dedupe.test.ts ("119977"), lead-notes.test.ts
// ("119555"), stage-transition.test.ts ("119888") nem notifications.test.ts
// ("119666").
const TELEFONE_TESTE = "11944440001";

async function limparDadosDeTeste() {
  // `findFirst`, e nao `findUnique`: desde o Ciclo 1e a chave unica de
  // `Contact` e `@@unique([companyId, telefone])` e o telefone sozinho deixou
  // de existir em `ContactWhereUniqueInput`. Uma linha so continua sendo o
  // esperado aqui — este arquivo reserva uma familia de telefone propria (ver
  // o bloco acima) e todos os casos gravam na mesma empresa.
  const contato = await prisma.contact.findFirst({ where: { telefone: TELEFONE_TESTE } });
  if (!contato) return;

  const leads = await prisma.lead.findMany({ where: { contactId: contato.id } });
  const leadIds = leads.map((l) => l.id);

  // `notificarNovoLead` está mockado neste arquivo (nunca chega a gravar em
  // `prisma.notification` de verdade), então, diferente de
  // lead-notes.test.ts/stage-transition.test.ts, não há `Notification` real
  // deste arquivo para limpar aqui — só AuditLog → Lead → Contact.
  await prisma.auditLog.deleteMany({ where: { entidade: "Lead", entidadeId: { in: leadIds } } });
  await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
  await prisma.contact.deleteMany({ where: { telefone: TELEFONE_TESTE } });
}

/**
 * Fix round 1/5 (Task 19), achado do revisor — CRITICAL: a spec (seção 6,
 * "falha de módulo secundário nunca derruba o principal") é a regra mais
 * explícita deste task, e nada na suíte original protegia o `try/catch` que
 * `criarLead` (`src/core/leads/service.ts`) usa ao redor de
 * `notificarNovoLead`. `notification-email-resilience.test.ts` cobre só o
 * `try/catch` INTERNO a `notificarNovoLead` (a falha do envio de e-mail via
 * Resend) — nunca uma falha na própria gravação da notificação, nem o
 * `try/catch` EXTERNO em `criarLead` que é a barreira real para o lead.
 *
 * Este teste mocka `notificarNovoLead` para sempre lançar (simulando
 * qualquer falha do módulo de notificação, não só a de e-mail) e confirma
 * que o lead e seu `AuditLog` — gravados ANTES da chamada a
 * `notificarNovoLead` dentro de `criarLead` — sobrevivem no Postgres real.
 *
 * Prova de que é load-bearing (não decorativo): comentar o `try/catch`
 * externo em `service.ts` faz este teste FALHAR (a promise de `criarLead`
 * rejeita com o erro simulado, em vez de retornar o lead) — verificado
 * manualmente durante este fix round, ver "FIX 2" em task-19-report.md para
 * a evidência (saída do teste nos dois estados). Não há como automatizar
 * essa segunda verificação dentro da própria suíte (ela provaria a ausência
 * do código que a suíte normal deve continuar exercitando) — por isso ficou
 * documentada no report, não codificada como um segundo teste.
 */
describe("criarLead — resiliência a falha do módulo de notificação (spec seção 6)", () => {
  let autorId: string;

  beforeAll(async () => {
    await limparDadosDeTeste();
    const admin = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN", ativo: true } });
    autorId = admin.id;
  });

  afterAll(limparDadosDeTeste);

  it(
    "lead e AuditLog sobrevivem no banco real quando notificarNovoLead lança — o try/catch " +
      "externo de criarLead (service.ts) é a barreira, não o try/catch interno de " +
      "notificarNovoLead (que só cobre a falha de e-mail)",
    async () => {
      notificarNovoLeadMock.mockRejectedValue(new Error("Falha simulada no módulo de notificação"));

      const lead = await criarLead({
        nome: "Teste Resiliência Notificação",
        telefone: TELEFONE_TESTE,
        responsavelId: autorId,
        autorId,
      });

      expect(lead.id).toBeTruthy();

      const leadNoBanco = await prisma.lead.findUnique({ where: { id: lead.id } });
      expect(leadNoBanco).not.toBeNull();
      expect(leadNoBanco?.id).toBe(lead.id);

      const registrosDeAuditoria = await prisma.auditLog.findMany({
        where: { entidade: "Lead", entidadeId: lead.id, acao: "criar_lead" },
      });
      expect(registrosDeAuditoria.length).toBe(1);

      // Prova que a falha realmente veio de notificarNovoLead sendo
      // chamada (não de um caminho que a pulou por engano).
      // `companyId` como PRIMEIRO parametro desde o Ciclo 1d: `notificarNovoLead`
      // le `Lead` pelo cliente escopado, e `criarLead` ja tinha a empresa em maos.
      expect(notificarNovoLeadMock).toHaveBeenCalledWith(lead.companyId, lead.id);
    }
  );
});
