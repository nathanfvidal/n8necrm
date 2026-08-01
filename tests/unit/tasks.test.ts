// Este arquivo usa o Prisma real contra o Postgres do Supabase (mesmo
// padrão de lead-notes.test.ts, stage-transition.test.ts etc.), então
// carrega DATABASE_URL do .env aqui — não em vitest.config.ts — para não
// injetar credenciais em testes que não tocam banco. Precisa ser o primeiro
// import: `src/core/tasks/service.ts` (via `@/lib/prisma` → `@/lib/env`) lê
// process.env.DATABASE_URL no top-level.
import "dotenv/config";

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// "server-only" só resolve para um no-op sob a condição de resolução
// "react-server" que o Next.js aplica no build — fora desse pipeline (aqui,
// sob Vitest) ele sempre lança, independente de quem importa (ver
// tests/unit/storage.test.ts, onde este mock foi documentado pela primeira
// vez). `src/core/tasks/service.ts` ganhou `import "server-only"` desde o
// início (Task 18, mesma decisão de leads/notes.ts na Task 17) — sem
// mockar aqui, todo teste deste arquivo quebraria na importação, não pela
// lógica testada.
vi.mock("server-only", () => ({}));

import { prisma } from "../../src/lib/prisma";
import { criarTask, concluirTask, listarTasksPendentes } from "../../src/core/tasks/service";

// Prefixo exclusivo deste arquivo — Task não tem nenhum campo único no
// schema (ao contrário de Contact.telefone, usado por lead-notes.test.ts e
// companhia) para limpar depois. Marcar todo `titulo` de teste com este
// prefixo permite um `deleteMany` seguro, tanto antes quanto depois da
// suíte, sem tocar em tarefas reais que alguém tenha criado manualmente
// contra o mesmo banco (dev/verificação manual).
const PREFIXO_TESTE = "[teste-tasks] ";

async function limparDadosDeTeste() {
  await prisma.task.deleteMany({ where: { titulo: { startsWith: PREFIXO_TESTE } } });
}

describe("tarefas", () => {
  let usuarioId: string;
  let outroUsuarioId: string;
  let leadId: string;

  beforeAll(async () => {
    await limparDadosDeTeste();

    const usuario = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN" } });
    usuarioId = usuario.id;

    // Segundo usuário real (papel diferente) para o teste de checagem de
    // dono abaixo — precisa ser outro `id` de usuário existente, não um
    // valor forjado, para provar que a rejeição é sobre PROPRIEDADE da
    // tarefa, não sobre o usuário não existir.
    const outroUsuario = await prisma.user.findFirstOrThrow({ where: { papel: "VENDEDOR" } });
    outroUsuarioId = outroUsuario.id;

    // Lead real do seed (Task 9: 4 leads) para o teste de vínculo — não
    // criamos um lead novo aqui para não duplicar a responsabilidade de
    // limpeza de dedupe.test.ts/stage-transition.test.ts.
    const lead = await prisma.lead.findFirstOrThrow();
    leadId = lead.id;
  });

  afterAll(limparDadosDeTeste);

  it("cria uma tarefa sem lead vinculado", async () => {
    const task = await criarTask({
      titulo: `${PREFIXO_TESTE}Ligar para fornecedor`,
      vencimento: new Date(Date.now() + 86_400_000),
      responsavelId: usuarioId,
    });
    expect(task.titulo).toBe(`${PREFIXO_TESTE}Ligar para fornecedor`);
    expect(task.leadId).toBeNull();
  });

  it("cria uma tarefa vinculada a um lead existente", async () => {
    const task = await criarTask({
      titulo: `${PREFIXO_TESTE}Follow-up do lead`,
      vencimento: new Date(Date.now() + 86_400_000),
      responsavelId: usuarioId,
      leadId,
    });
    expect(task.leadId).toBe(leadId);
  });

  it("rejeita leadId que não corresponde a nenhum lead, sem gravar nada", async () => {
    await expect(
      criarTask({
        titulo: `${PREFIXO_TESTE}Lead inexistente`,
        vencimento: new Date(Date.now() + 86_400_000),
        responsavelId: usuarioId,
        leadId: "lead-que-nao-existe",
      })
    ).rejects.toThrow(/Lead não encontrado/);
  });

  it("apara e rejeita título vazio/só-espaço", async () => {
    await expect(
      criarTask({
        titulo: "   ",
        vencimento: new Date(Date.now() + 86_400_000),
        responsavelId: usuarioId,
      })
    ).rejects.toThrow(/Título obrigatório/);
  });

  it("rejeita vencimento inválido (Date NaN) — última linha de defesa além de parseDataCivil", async () => {
    await expect(
      criarTask({
        titulo: `${PREFIXO_TESTE}Vencimento ruim`,
        vencimento: new Date("data-nao-e-uma-data"),
        responsavelId: usuarioId,
      })
    ).rejects.toThrow(/Vencimento inválido/);
  });

  it("marca uma tarefa como concluída pelo próprio dono", async () => {
    const task = await criarTask({
      titulo: `${PREFIXO_TESTE}Enviar proposta`,
      vencimento: new Date(Date.now() + 86_400_000),
      responsavelId: usuarioId,
    });
    const concluida = await concluirTask({ taskId: task.id, autorId: usuarioId });
    expect(concluida.concluidaEm).not.toBeNull();
  });

  it(
    "rejeita conclusão por quem NÃO é dono da tarefa — decisão de segurança central da " +
      "Task 18, deliberadamente diferente de moverEtapa (leads/service.ts), que nunca checa dono",
    async () => {
      const task = await criarTask({
        titulo: `${PREFIXO_TESTE}Tarefa de outro dono`,
        vencimento: new Date(Date.now() + 86_400_000),
        responsavelId: usuarioId,
      });

      await expect(concluirTask({ taskId: task.id, autorId: outroUsuarioId })).rejects.toThrow(
        "Tarefa não encontrada"
      );

      // A tentativa rejeitada não pode ter efeito colateral nenhum: a
      // tarefa continua pendente, exatamente como antes da chamada.
      const aindaPendente = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
      expect(aindaPendente.concluidaEm).toBeNull();
    }
  );

  it("rejeita conclusão de um id de tarefa inexistente com a MESMA mensagem (não distingue os dois casos)", async () => {
    await expect(
      concluirTask({ taskId: "task-que-nao-existe", autorId: usuarioId })
    ).rejects.toThrow("Tarefa não encontrada");
  });

  it(
    "rejeita conclusão por um colega ATIVO quando a tarefa pertence a um usuário DESATIVADO — " +
      "cenário citado explicitamente no brief da Task 18. concluirTask checa posse por id " +
      "(task.responsavelId === autorId), não permissão/estado da conta; o dono estar desativado " +
      "não abre uma exceção para outra pessoa concluir em nome dele. (usuarioAtual(), Task 13, já " +
      "impediria o PRÓPRIO dono desativado de sequer chegar a esta função via Server Action — mas " +
      "essa é outra camada, e não é o que este teste cobre.)",
    async () => {
      const usuarioDesativado = await prisma.user.create({
        data: {
          nome: `${PREFIXO_TESTE}Usuário Desativado`,
          email: `teste-tasks-desativado-${Date.now()}@teste.local`,
          senhaHash: "hash-fake-nunca-usado-em-login",
          papel: "VENDEDOR",
          ativo: false,
        },
      });

      try {
        const task = await criarTask({
          titulo: `${PREFIXO_TESTE}Tarefa de usuário desativado`,
          vencimento: new Date(Date.now() + 86_400_000),
          responsavelId: usuarioDesativado.id,
        });

        await expect(
          concluirTask({ taskId: task.id, autorId: outroUsuarioId })
        ).rejects.toThrow("Tarefa não encontrada");

        const aindaPendente = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
        expect(aindaPendente.concluidaEm).toBeNull();
      } finally {
        // Ordem importa por causa da FK (Task.responsavelId → User.id, sem
        // onDelete em cascade no schema): apagar a tarefa antes do usuário,
        // sempre, mesmo se alguma asserção acima falhar (try/finally, não
        // só o `afterAll` prefixado — este usuário não é coberto por
        // `limparDadosDeTeste`).
        await prisma.task.deleteMany({ where: { responsavelId: usuarioDesativado.id } });
        await prisma.user.delete({ where: { id: usuarioDesativado.id } });
      }
    }
  );

  it("lista apenas tarefas pendentes de um responsável", async () => {
    const pendente = await criarTask({
      titulo: `${PREFIXO_TESTE}Tarefa pendente`,
      vencimento: new Date(Date.now() + 86_400_000),
      responsavelId: usuarioId,
    });
    const concluida = await criarTask({
      titulo: `${PREFIXO_TESTE}Tarefa que será concluída`,
      vencimento: new Date(Date.now() + 86_400_000),
      responsavelId: usuarioId,
    });
    await concluirTask({ taskId: concluida.id, autorId: usuarioId });

    const pendentes = await listarTasksPendentes(usuarioId);
    const ids = pendentes.map((t) => t.id);
    expect(ids).toContain(pendente.id);
    expect(ids).not.toContain(concluida.id);
  });
});
