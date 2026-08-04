// Mesmo motivo de prisma/seed-demo.ts (ver o comentário extenso no topo
// daquele arquivo) para não importar `@/lib/prisma`/`src/core/**`: este
// script roda via `tsx` fora do pipeline de build do Next, e `server-only`
// lança incondicionalmente fora da condição de resolução "react-server".
//
// `TELEFONE_PREFIXO_DEMO` vem de `./seed-demo-shared`, NUNCA de
// `./seed-demo` diretamente — importar `seed-demo.ts` aqui executaria o
// módulo inteiro, inclusive a guarda `if (!process.env.VITEST) { seedDemo()
// ... }` no fim dele, disparando um seed completo como efeito colateral de
// rodar a LIMPEZA. Bug real, reproduzido ao testar este script pela primeira
// vez: `npm run seed:demo:limpar` apagava os dados e, no mesmo processo,
// recriava tudo de novo por causa desse import. `seed-demo-shared.ts` existe
// para não ter esse problema por construção (nenhum efeito colateral de
// topo).
import "dotenv/config";

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { TELEFONE_PREFIXO_DEMO } from "./seed-demo-shared";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
export const prisma = new PrismaClient({ adapter });

export type ResultadoLimpezaDemo = {
  contatos: number;
  leads: number;
  tarefas: number;
  notas: number;
  auditLogs: number;
  notificacoes: number;
};

/**
 * Remove exatamente o que `seedDemo()` (prisma/seed-demo.ts) cria, devolvendo
 * o banco ao estado do seed base (5 etapas, 4 leads, 4 contatos, 2 usuários,
 * 0 notas/tarefas/notificações) — nunca toca etapa, usuário, ou qualquer
 * Contact/Lead fora da faixa de telefone reservada para demo.
 *
 * Ordem de apagar respeita as FKs do schema (prisma/schema.prisma):
 * Task.leadId e AuditLog/Notification (sem FK real, ligados por id em JSON)
 * → Lead (LeadNote cai sozinho via `onDelete: Cascade`) → Contact. Apagar
 * Contact antes de Lead violaria `Lead.contactId` (`ON DELETE SET NULL` — não
 * quebraria, mas deixaria o Lead órfão de contato até a linha do Lead ser
 * apagada no passo seguinte; a ordem abaixo evita esse estado intermediário
 * de qualquer forma).
 */
export async function limparDemo(): Promise<ResultadoLimpezaDemo> {
  const contatosDemo = await prisma.contact.findMany({
    where: { telefone: { startsWith: TELEFONE_PREFIXO_DEMO } },
  });
  const contatoIds = contatosDemo.map((c) => c.id);

  const leadsDemo = await prisma.lead.findMany({ where: { contactId: { in: contatoIds } } });
  const leadIds = leadsDemo.map((l) => l.id);

  const tarefasApagadas = await prisma.task.deleteMany({ where: { leadId: { in: leadIds } } });

  // Notification não tem FK real para Lead (payload é só um leadId solto em
  // JSON — ver src/core/notifications/types.ts) — mesmo raciocínio de
  // limpeza usado em tests/unit/stage-transition.test.ts e companhia:
  // filtra em memória pelo leadId gravado no payload.
  const notificacoesNovoLead = await prisma.notification.findMany({ where: { tipo: "NOVO_LEAD" } });
  const idsNotificacoesDemo = notificacoesNovoLead
    .filter((n) => leadIds.includes((n.payload as { leadId?: string } | null)?.leadId ?? ""))
    .map((n) => n.id);
  const notificacoesApagadas =
    idsNotificacoesDemo.length > 0
      ? await prisma.notification.deleteMany({ where: { id: { in: idsNotificacoesDemo } } })
      : { count: 0 };

  const auditLogsApagados = await prisma.auditLog.deleteMany({
    where: { entidade: "Lead", entidadeId: { in: leadIds } },
  });

  // LeadNote não precisa de deleteMany separado: `onDelete: Cascade` em
  // LeadNote.leadId (schema.prisma) apaga junto quando o Lead é apagado
  // abaixo. Contamos antes só para o relatório de quantas linhas saíram.
  const notasQueSeraoApagadas = await prisma.leadNote.count({ where: { leadId: { in: leadIds } } });

  const leadsApagados = await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
  const contatosApagados = await prisma.contact.deleteMany({
    where: { telefone: { startsWith: TELEFONE_PREFIXO_DEMO } },
  });

  const resultado: ResultadoLimpezaDemo = {
    contatos: contatosApagados.count,
    leads: leadsApagados.count,
    tarefas: tarefasApagadas.count,
    notas: notasQueSeraoApagadas,
    auditLogs: auditLogsApagados.count,
    notificacoes: notificacoesApagadas.count,
  };

  console.log(
    `Limpeza de demo concluída: ${resultado.contatos} contatos, ${resultado.leads} leads, ` +
      `${resultado.tarefas} tarefas, ${resultado.notas} notas, ${resultado.auditLogs} auditLogs, ` +
      `${resultado.notificacoes} notificações removidos.`
  );

  return resultado;
}

if (!process.env.VITEST) {
  limparDemo()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
