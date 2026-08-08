// Prisma real contra o Postgres do Supabase (mesmo padrão de
// lead-queries.test.ts/tasks.test.ts) — carrega DATABASE_URL do .env aqui,
// não em vitest.config.ts, para não injetar credenciais em testes que não
// tocam banco.
import "dotenv/config";

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// "server-only" só resolve para um no-op sob a condição de resolução
// "react-server" que o Next.js aplica no build — fora desse pipeline (aqui,
// sob Vitest) ele sempre lança. `queries.ts` e `service.ts` (Task 18) têm
// `import "server-only"` no topo — sem mockar aqui, todo teste deste
// arquivo quebraria na importação, não pela lógica testada.
vi.mock("server-only", () => ({}));

import { prisma } from "../../src/lib/prisma";
import { criarTask, concluirTask } from "../../src/core/tasks/service";
import { listarTasksPendentesDoLead } from "../../src/core/tasks/queries";

const PREFIXO_TESTE = "[teste-task-queries] ";

async function limparDadosDeTeste() {
  await prisma.task.deleteMany({ where: { titulo: { startsWith: PREFIXO_TESTE } } });
}

describe("listarTasksPendentesDoLead", () => {
  let adminId: string;
  let vendedorId: string;
  let leadId: string;

  beforeAll(async () => {
    await limparDadosDeTeste();

    const admin = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN", ativo: true } });
    adminId = admin.id;
    const vendedor = await prisma.user.findFirstOrThrow({ where: { papel: "VENDEDOR", ativo: true } });
    vendedorId = vendedor.id;

    // Lead real do seed — não criamos um lead novo aqui pelo mesmo motivo
    // documentado em tasks.test.ts.
    const lead = await prisma.lead.findFirstOrThrow();
    leadId = lead.id;
  });

  afterAll(limparDadosDeTeste);

  it(
    "devolve tarefas de MAIS DE UM responsável para o mesmo lead — fix round 1/5, achado do " +
      "revisor: a versão original escopava por responsavelId, escondendo de um colega que outro " +
      "já tinha um lembrete agendado para o mesmo lead (risco de contato duplicado com o cliente)",
    async () => {
      const doAdmin = await criarTask({
        titulo: `${PREFIXO_TESTE}Ligar para Fernanda às 15h`,
        vencimento: new Date(Date.now() + 86_400_000),
        responsavelId: adminId,
        leadId,
      });
      const doVendedor = await criarTask({
        titulo: `${PREFIXO_TESTE}Enviar proposta`,
        vencimento: new Date(Date.now() + 86_400_000),
        responsavelId: vendedorId,
        leadId,
      });

      const tarefas = await listarTasksPendentesDoLead(leadId);
      const ids = tarefas.map((t) => t.id);

      expect(ids).toContain(doAdmin.id);
      expect(ids).toContain(doVendedor.id);
    }
  );

  it("cada tarefa vem com `responsavel` (id/nome) incluído — é o que permite a UI mostrar de quem é cada uma", async () => {
    const task = await criarTask({
      titulo: `${PREFIXO_TESTE}Tarefa com responsavel incluido`,
      vencimento: new Date(Date.now() + 86_400_000),
      responsavelId: vendedorId,
      leadId,
    });

    const tarefas = await listarTasksPendentesDoLead(leadId);
    const encontrada = tarefas.find((t) => t.id === task.id);

    expect(encontrada?.responsavel).toBeTruthy();
    expect(encontrada?.responsavel.id).toBe(vendedorId);
    expect(typeof encontrada?.responsavel.nome).toBe("string");
    // `senhaHash` não pode vazar para a UI a partir daqui — `select` em
    // queries.ts pega só id/nome (mesmo raciocínio de leads/queries.ts).
    expect((encontrada?.responsavel as { senhaHash?: string }).senhaHash).toBeUndefined();
  });

  it("não devolve tarefa já concluída", async () => {
    const task = await criarTask({
      titulo: `${PREFIXO_TESTE}Tarefa que será concluída`,
      vencimento: new Date(Date.now() + 86_400_000),
      responsavelId: adminId,
      leadId,
    });
    await concluirTask({ taskId: task.id, autorId: adminId });

    const tarefas = await listarTasksPendentesDoLead(leadId);
    expect(tarefas.map((t) => t.id)).not.toContain(task.id);
  });

  it("não devolve tarefa vinculada a OUTRO lead", async () => {
    const outroLead = await prisma.lead.findFirstOrThrow({ where: { id: { not: leadId } } });
    const taskDeOutroLead = await criarTask({
      titulo: `${PREFIXO_TESTE}Tarefa de outro lead`,
      vencimento: new Date(Date.now() + 86_400_000),
      responsavelId: adminId,
      leadId: outroLead.id,
    });

    const tarefas = await listarTasksPendentesDoLead(leadId);
    expect(tarefas.map((t) => t.id)).not.toContain(taskDeOutroLead.id);
  });
});
