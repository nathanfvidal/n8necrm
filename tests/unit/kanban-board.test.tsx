// @vitest-environment jsdom
//
// Cobre só a lógica de ramificação do kanban (não layout/estilo, mesma
// instrução da Task 14 para lead-form.test.tsx):
//
// - `useKanbanBoard`: atualização otimista, rollback + mensagem por tipo de
//   falha (sem permissão, sessão rejeitada, etapa inexistente, erro
//   genérico), e os dois no-ops (soltar fora de qualquer coluna, soltar na
//   própria coluna).
// - `KanbanBoard`: contagem/EmptyState por coluna, o card não quebra quando
//   `lead.contact` é null (Task 13/15), e o card fica alcançável por
//   teclado (role="button", tabIndex=0 — atributos padrão do dnd-kit).
//
// Testamos `handleDragEnd` chamando-o diretamente com um evento sintético
// mínimo (`{ active: { id }, over: { id } }`), não simulando um drag real
// via dnd-kit: um `DragEndEvent` de verdade depende de
// `getBoundingClientRect`, que o jsdom não calcula (retorna 0 para tudo),
// tornando qualquer simulação de drag/collision-detection não confiável
// neste ambiente — a decisão da Task 15 foi verificar a lógica de
// movimentação isoladamente do sensor, não fingir que o drag em si foi
// exercitado.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, renderHook, act, cleanup } from "@testing-library/react";
import type { Contact, User } from "@prisma/client";
import type { DragEndEvent } from "@dnd-kit/core";

import type { LeadComRelacoes } from "../../src/core/leads/queries";

const moverLeadDeEtapaMock = vi.fn();
vi.mock("@/core/leads/actions", () => ({
  moverLeadDeEtapa: (...args: unknown[]) => moverLeadDeEtapaMock(...args),
}));

const { useKanbanBoard, KanbanBoard } = await import("../../src/components/leads/kanban-board");

function contatoFake(overrides: Partial<Contact> = {}): Contact {
  return {
    id: "contact-1",
    nome: "Cliente Teste",
    telefone: "11988887777",
    email: null,
    criadoEm: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function usuarioFake(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    nome: "Vendedor Teste",
    email: "vendedor@teste.local",
    senhaHash: "hash",
    papel: "VENDEDOR",
    ativo: true,
    criadoEm: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function leadFake(overrides: Partial<LeadComRelacoes> = {}): LeadComRelacoes {
  return {
    id: "lead-1",
    contactId: "contact-1",
    itemId: null,
    stageId: "etapa-1",
    responsavelId: "user-1",
    canal: "MANUAL",
    valorEstimado: null,
    sessionId: null,
    utm: null,
    criadoEm: new Date("2026-01-01T00:00:00.000Z"),
    ultimaInteracaoEm: new Date("2026-01-01T00:00:00.000Z"),
    contact: contatoFake(),
    responsavel: usuarioFake(),
    ...overrides,
  };
}

// O handler (`handleDragEnd`) só lê `.id` de `active`/`over` — as demais
// propriedades de `Active`/`Over` do dnd-kit (rect, data, disabled) existem
// só para o motor de colisão real, que este arquivo não exercita (ver nota
// no topo). O cast isola essa omissão deliberada num único lugar, em vez de
// repeti-la em cada teste.
function eventoFake(
  activeId: string,
  overId: string | null
): Pick<DragEndEvent, "active" | "over"> {
  return {
    active: { id: activeId } as DragEndEvent["active"],
    over: overId === null ? null : ({ id: overId } as NonNullable<DragEndEvent["over"]>),
  };
}

const etapasFake = [
  { id: "etapa-1", nome: "Novo", ordem: 0, cor: "#94A3B8", ehGanho: false, ehPerdido: false },
  { id: "etapa-2", nome: "Contato feito", ordem: 1, cor: "#60A5FA", ehGanho: false, ehPerdido: false },
];

beforeEach(() => {
  moverLeadDeEtapaMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("useKanbanBoard", () => {
  it("move otimisticamente o lead para a nova etapa quando a action resolve", async () => {
    moverLeadDeEtapaMock.mockResolvedValue(leadFake({ stageId: "etapa-2" }));
    const { result } = renderHook(() => useKanbanBoard({ "etapa-1": [leadFake()], "etapa-2": [] }));

    await act(async () => {
      await result.current.handleDragEnd(eventoFake("lead-1", "etapa-2"));
    });

    expect(result.current.leadsPorEtapa["etapa-1"]).toHaveLength(0);
    expect(result.current.leadsPorEtapa["etapa-2"]).toHaveLength(1);
    expect(result.current.erro).toBeNull();
    expect(moverLeadDeEtapaMock).toHaveBeenCalledWith({ leadId: "lead-1", novaStageId: "etapa-2" });
    // Nenhum identificador de autor é enviado — só leadId/novaStageId.
    expect(moverLeadDeEtapaMock.mock.calls[0][0]).not.toHaveProperty("usuarioId");
  });

  it("sem permissão mover_lead: desfaz a movimentação e mostra a mensagem do servidor", async () => {
    moverLeadDeEtapaMock.mockRejectedValue(new Error("Sem permissão para mover lead"));
    const { result } = renderHook(() => useKanbanBoard({ "etapa-1": [leadFake()], "etapa-2": [] }));

    await act(async () => {
      await result.current.handleDragEnd(eventoFake("lead-1", "etapa-2"));
    });

    expect(result.current.leadsPorEtapa["etapa-1"]).toHaveLength(1);
    expect(result.current.leadsPorEtapa["etapa-2"]).toHaveLength(0);
    expect(result.current.erro).toBe("Sem permissão para mover lead");
  });

  it("etapa inexistente: desfaz a movimentação e mostra mensagem própria", async () => {
    moverLeadDeEtapaMock.mockRejectedValue(
      new Error('Etapa não encontrada: "x" não corresponde a nenhuma etapa do funil.')
    );
    const { result } = renderHook(() => useKanbanBoard({ "etapa-1": [leadFake()], "etapa-2": [] }));

    await act(async () => {
      await result.current.handleDragEnd(eventoFake("lead-1", "etapa-2"));
    });

    expect(result.current.leadsPorEtapa["etapa-1"]).toHaveLength(1);
    expect(result.current.erro).toBe("Essa etapa não existe mais. Atualize a página.");
  });

  it("sessão rejeitada (sem sessão OU usuário desativado): desfaz e mostra mensagem própria", async () => {
    moverLeadDeEtapaMock.mockRejectedValue(new Error("Não autenticado"));
    const { result } = renderHook(() => useKanbanBoard({ "etapa-1": [leadFake()], "etapa-2": [] }));

    await act(async () => {
      await result.current.handleDragEnd(eventoFake("lead-1", "etapa-2"));
    });

    expect(result.current.leadsPorEtapa["etapa-1"]).toHaveLength(1);
    expect(result.current.erro).toBe(
      "Sua sessão expirou ou sua conta foi desativada. Atualize a página e faça login novamente."
    );
  });

  it("erro inesperado: desfaz e cai no fallback genérico, sem vazar detalhe interno", async () => {
    moverLeadDeEtapaMock.mockRejectedValue(new Error("connection terminated unexpectedly"));
    const { result } = renderHook(() => useKanbanBoard({ "etapa-1": [leadFake()], "etapa-2": [] }));

    await act(async () => {
      await result.current.handleDragEnd(eventoFake("lead-1", "etapa-2"));
    });

    expect(result.current.leadsPorEtapa["etapa-1"]).toHaveLength(1);
    expect(result.current.erro).toBe("Não foi possível mover o lead. Tente novamente em instantes.");
    expect(result.current.erro).not.toContain("connection terminated");
  });

  it("solto fora de qualquer coluna (over null): não chama a action nem muda o estado", async () => {
    const { result } = renderHook(() => useKanbanBoard({ "etapa-1": [leadFake()], "etapa-2": [] }));

    await act(async () => {
      await result.current.handleDragEnd(eventoFake("lead-1", null));
    });

    expect(moverLeadDeEtapaMock).not.toHaveBeenCalled();
    expect(result.current.leadsPorEtapa["etapa-1"]).toHaveLength(1);
  });

  it("solto na própria coluna: não chama a action nem muda o estado", async () => {
    const { result } = renderHook(() => useKanbanBoard({ "etapa-1": [leadFake()], "etapa-2": [] }));

    await act(async () => {
      await result.current.handleDragEnd(eventoFake("lead-1", "etapa-1"));
    });

    expect(moverLeadDeEtapaMock).not.toHaveBeenCalled();
    expect(result.current.leadsPorEtapa["etapa-1"]).toHaveLength(1);
  });

  it(
    "fix 1/5: duas chamadas de handleDragEnd que compartilham o MESMO fechamento, sem re-render " +
      "entre elas, não podem deixar o board e o servidor em desacordo — a segunda precisa " +
      "enxergar o efeito da primeira, não a foto antiga do estado capturada no fechamento",
    async () => {
      moverLeadDeEtapaMock.mockResolvedValue(leadFake());
      const { result } = renderHook(() =>
        useKanbanBoard({ "etapa-1": [leadFake()], "etapa-2": [], "etapa-3": [] })
      );

      // Uma ÚNICA referência de `handleDragEnd`, tirada de um único render —
      // as duas chamadas abaixo compartilham o mesmo fechamento, simulando
      // duas ativações do sensor (ex.: KeyboardSensor disparando rápido, ou
      // um double-fire de sensor) antes de o React re-renderizar entre elas.
      const handleDragEnd = result.current.handleDragEnd;

      await act(async () => {
        // Disparadas de volta a volta, SEM aguardar a primeira: é
        // exatamente esse intervalo síncrono (a parte de `handleDragEnd`
        // antes do primeiro `await`) que reproduz "nenhum re-render entre
        // elas" — a segunda chamada tem que enxergar o efeito síncrono da
        // primeira mesmo sem o React ter re-renderizado ainda.
        const p1 = handleDragEnd(eventoFake("lead-1", "etapa-2"));
        const p2 = handleDragEnd(eventoFake("lead-1", "etapa-3"));
        await Promise.all([p1, p2]);
      });

      // O servidor (mock) recebeu as DUAS movimentações pretendidas: etapa-1
      // -> etapa-2 pela primeira chamada, depois etapa-2 -> etapa-3 pela
      // segunda — a intenção do usuário foi "mover, depois mover de novo".
      expect(moverLeadDeEtapaMock).toHaveBeenNthCalledWith(1, {
        leadId: "lead-1",
        novaStageId: "etapa-2",
      });
      expect(moverLeadDeEtapaMock).toHaveBeenNthCalledWith(2, {
        leadId: "lead-1",
        novaStageId: "etapa-3",
      });

      // O board TEM que concordar com o que o servidor acabou de confirmar:
      // o lead termina em etapa-3 — não "preso" em etapa-2 (nem, pior, ainda
      // em etapa-1) enquanto o banco já registrou etapa-3. Um board que
      // discorda silenciosamente do banco é o tipo de bug que aparece como
      // "o CRM perdeu minha alteração".
      expect(result.current.leadsPorEtapa["etapa-3"].map((lead) => lead.id)).toEqual(["lead-1"]);
      expect(result.current.leadsPorEtapa["etapa-2"]).toHaveLength(0);
      expect(result.current.leadsPorEtapa["etapa-1"]).toHaveLength(0);
      expect(result.current.erro).toBeNull();
    }
  );

  it("limparErro apaga a mensagem de erro exibida", async () => {
    moverLeadDeEtapaMock.mockRejectedValue(new Error("Sem permissão para mover lead"));
    const { result } = renderHook(() => useKanbanBoard({ "etapa-1": [leadFake()], "etapa-2": [] }));

    await act(async () => {
      await result.current.handleDragEnd(eventoFake("lead-1", "etapa-2"));
    });
    expect(result.current.erro).not.toBeNull();

    act(() => result.current.limparErro());
    expect(result.current.erro).toBeNull();
  });
});

describe("KanbanBoard", () => {
  it("renderiza as colunas com a contagem de leads e EmptyState para coluna vazia", () => {
    render(<KanbanBoard etapas={etapasFake} leadsPorEtapa={{ "etapa-1": [leadFake()], "etapa-2": [] }} />);

    expect(screen.getByText("Novo (1)")).toBeTruthy();
    expect(screen.getByText("Contato feito (0)")).toBeTruthy();
    expect(screen.getByText("Sem leads")).toBeTruthy();
  });

  it("lead sem contato identificado (ex.: clique de WhatsApp) não quebra e mostra rótulo explícito", () => {
    render(
      <KanbanBoard
        etapas={etapasFake}
        leadsPorEtapa={{ "etapa-1": [leadFake({ contact: null, canal: "WHATSAPP" })], "etapa-2": [] }}
      />
    );

    expect(screen.getByText("Sem contato identificado")).toBeTruthy();
    // Sem contato, não existe telefone: cai no rótulo do canal, nunca em
    // "undefined" nem numa string vazia.
    expect(screen.getByText("WhatsApp")).toBeTruthy();
  });

  it("lead sem responsável não quebra e mostra rótulo explícito", () => {
    render(
      <KanbanBoard
        etapas={etapasFake}
        leadsPorEtapa={{ "etapa-1": [leadFake({ responsavel: null, responsavelId: null })], "etapa-2": [] }}
      />
    );

    expect(screen.getByText("Sem responsável")).toBeTruthy();
  });

  it("card do lead é alcançável por teclado (role=button, tabIndex=0 — dnd-kit)", () => {
    render(<KanbanBoard etapas={etapasFake} leadsPorEtapa={{ "etapa-1": [leadFake()], "etapa-2": [] }} />);

    const card = screen.getByRole("button", { name: /Cliente Teste/ });
    expect(card.getAttribute("tabindex")).toBe("0");
  });
});
