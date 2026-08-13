// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";

import { KanbanCard } from "@/components/leads/kanban-card";
import type { LeadDoQuadro } from "@/core/leads/queries";

function leadFake(overrides: Partial<LeadDoQuadro> = {}): LeadDoQuadro {
  return {
    id: "lead-1",
    canal: "MANUAL",
    contatoNome: "Cliente Teste",
    contatoTelefone: "11988887777",
    responsavelNome: "Vendedor Teste",
    valorFormatado: "R$ 1.500,00",
    ...overrides,
  };
}

// `useDraggable` precisa do contexto do dnd-kit para produzir `attributes` —
// é de lá que vêm `role="button"` e `tabIndex`, que são metade do assunto
// destes testes.
function renderizarCartao(lead: LeadDoQuadro = leadFake()) {
  return render(
    <DndContext>
      <KanbanCard lead={lead} />
    </DndContext>
  );
}

const cartao = () => screen.getByRole("button", { name: /^Lead / });
const alternador = () => screen.getByRole("button", { name: /cartão$/ });
const detalhes = () => document.getElementById(alternador().getAttribute("aria-controls") ?? "");

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(cleanup);

describe("KanbanCard — recolher e expandir", () => {
  it("nasce expandido, com os detalhes à vista", () => {
    renderizarCartao();

    expect(alternador().getAttribute("aria-label")).toBe("Recolher cartão");
    expect(alternador().getAttribute("aria-expanded")).toBe("true");
    expect(detalhes()?.hasAttribute("hidden")).toBe(false);
    expect(screen.getByText("11988887777")).toBeTruthy();
    expect(screen.getByText("Vendedor Teste")).toBeTruthy();
  });

  it("recolhido, sobra o nome — e só ele", () => {
    renderizarCartao();

    fireEvent.click(alternador());

    expect(alternador().getAttribute("aria-label")).toBe("Expandir cartão");
    expect(alternador().getAttribute("aria-expanded")).toBe("false");
    // `hidden` tira do layout E da árvore de acessibilidade: o telefone não
    // fica "invisível mas anunciado", que é o defeito clássico deste padrão.
    expect(detalhes()?.hasAttribute("hidden")).toBe(true);
    // O nome é o que identifica o cartão. Recolher não pode deixá-lo anônimo.
    expect(screen.getByText("Cliente Teste")).toBeTruthy();
  });

  it("clicar de novo devolve os detalhes", () => {
    renderizarCartao();

    fireEvent.click(alternador());
    fireEvent.click(alternador());

    expect(alternador().getAttribute("aria-expanded")).toBe("true");
    expect(detalhes()?.hasAttribute("hidden")).toBe(false);
  });

  it("lê a preferência guardada já no primeiro render", () => {
    window.localStorage.setItem("crm:kanban:cartoes-recolhidos", JSON.stringify(["lead-1"]));

    renderizarCartao();

    expect(alternador().getAttribute("aria-expanded")).toBe("false");
    expect(detalhes()?.hasAttribute("hidden")).toBe(true);
  });
});

describe("KanbanCard — acessibilidade do alternador", () => {
  // Sabotagem obrigatória do plano: pôr o `<button>` dentro do `<Card>`.
  //
  // Pela ARIA, `role="button"` (que o dnd-kit aplica ao `<Card>`) tem FILHOS
  // APRESENTACIONAIS — um `<button>` descendente some para o leitor de tela.
  // O `getByRole` do testing-library não implementa essa regra, então o
  // alternador continuaria "encontrável" no teste enquanto estivesse
  // inacessível de verdade. Por isso a asserção é de ESTRUTURA (quem contém
  // quem), a única que enxerga o defeito.
  it("o alternador é irmão do card, nunca descendente", () => {
    renderizarCartao();

    expect(cartao().getAttribute("role")).toBe("button");
    expect(cartao().contains(alternador())).toBe(false);
    expect(alternador().parentElement).toBe(cartao().parentElement);
  });

  // Sabotagem obrigatória do plano: pôr o nome do contato no rótulo do botão.
  // O `<Card>` já se anuncia "Lead Cliente Teste, canal…"; repetir o nome faz
  // `getByRole("button", { name: /Cliente Teste/ })` casar com dois elementos
  // — e é exatamente esse o localizador de `cardEm` no e2e e do teste de
  // teclado em `kanban-board.test.tsx`.
  it("o rótulo do alternador não repete o nome do contato", () => {
    renderizarCartao();

    expect(screen.getAllByRole("button", { name: /Cliente Teste/ })).toHaveLength(1);
    expect(alternador().getAttribute("aria-label")).not.toContain("Cliente Teste");
  });

  it("aria-controls aponta para um elemento que existe, recolhido ou expandido", () => {
    renderizarCartao();

    const alvo = alternador().getAttribute("aria-controls");
    expect(alvo).toBeTruthy();
    expect(document.getElementById(alvo as string)).not.toBeNull();

    fireEvent.click(alternador());
    // Referência pendurada é erro de validação ARIA: o leitor de tela anuncia
    // "controla" e não tem para onde ir. É o preço de renderizar o bloco
    // condicionalmente em vez de escondê-lo.
    expect(document.getElementById(alvo as string)).not.toBeNull();
  });

  it("o card continua alcançável por teclado e com o rótulo de arrasto", () => {
    renderizarCartao();

    expect(cartao().getAttribute("tabindex")).toBe("0");
    expect(cartao().getAttribute("aria-label")).toContain("Lead Cliente Teste, canal Manual");
  });
});

describe("KanbanCard — o que o corpo expandido mostra", () => {
  it("mostra o valor estimado já formatado pelo servidor", () => {
    renderizarCartao();
    expect(screen.getByText("R$ 1.500,00")).toBeTruthy();
  });

  it("sem valor, diz que não há — nunca string vazia", () => {
    renderizarCartao(leadFake({ valorFormatado: null }));
    expect(screen.getByText("Sem valor estimado")).toBeTruthy();
  });

  it("sem contato identificado, cai no rótulo do canal", () => {
    renderizarCartao(leadFake({ contatoNome: null, contatoTelefone: null, canal: "WHATSAPP" }));

    expect(screen.getByText("Sem contato identificado")).toBeTruthy();
    expect(screen.getByText("WhatsApp")).toBeTruthy();
  });

  it("sem responsável, diz que não há", () => {
    renderizarCartao(leadFake({ responsavelNome: null }));
    expect(screen.getByText("Sem responsável")).toBeTruthy();
  });
});
