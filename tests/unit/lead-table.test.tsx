// @vitest-environment jsdom
//
// Cobre só a lógica de ramificação da tabela (não layout/estilo, mesma
// instrução das Tasks 14/15 para lead-form.test.tsx/kanban-board.test.tsx):
// os filtros (etapa, responsável, intervalo de data, busca livre) narrowing
// as linhas exibidas, e que a tabela não quebra com dados nulos (contato
// sem telefone) — a mesma preocupação de nullability da Task 15
// (kanban-card), agora na tabela.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { LeadChannel } from "@prisma/client";

const { LeadTable } = await import("../../src/components/leads/lead-table");
import type { LeadLinha } from "../../src/components/leads/lead-table";

function linhaFake(overrides: Partial<LeadLinha> = {}): LeadLinha {
  return {
    id: "lead-1",
    contatoNome: "Carlos Silva",
    telefone: "11999990000",
    etapaNome: "Novo",
    responsavelNome: "Admin Exemplo",
    canal: "MANUAL" as LeadChannel,
    criadoEm: "01/01/2026",
    criadoEmISO: "2026-01-01",
    ...overrides,
  };
}

const linhas: LeadLinha[] = [
  linhaFake({ id: "lead-1", contatoNome: "Carlos Silva", etapaNome: "Novo", responsavelNome: "Admin Exemplo", criadoEmISO: "2026-01-01", criadoEm: "01/01/2026" }),
  linhaFake({ id: "lead-2", contatoNome: "Fernanda Lima", etapaNome: "Contato feito", responsavelNome: "Vendedor Exemplo", criadoEmISO: "2026-01-15", criadoEm: "15/01/2026", telefone: "11999990001" }),
  linhaFake({ id: "lead-3", contatoNome: "João Pereira", etapaNome: "Novo", responsavelNome: "Admin Exemplo", criadoEmISO: "2026-02-01", criadoEm: "01/02/2026", telefone: "11999990002" }),
];

afterEach(() => cleanup());

describe("LeadTable", () => {
  it("renderiza uma linha por lead recebido", () => {
    render(<LeadTable dados={linhas} etapas={["Novo", "Contato feito"]} responsaveis={["Admin Exemplo", "Vendedor Exemplo"]} />);

    expect(screen.getByText("Carlos Silva")).toBeTruthy();
    expect(screen.getByText("Fernanda Lima")).toBeTruthy();
    expect(screen.getByText("João Pereira")).toBeTruthy();
  });

  it("filtro de etapa restringe as linhas exibidas", () => {
    render(<LeadTable dados={linhas} etapas={["Novo", "Contato feito"]} responsaveis={["Admin Exemplo", "Vendedor Exemplo"]} />);

    fireEvent.change(screen.getByLabelText("Etapa"), { target: { value: "Contato feito" } });

    expect(screen.queryByText("Carlos Silva")).toBeNull();
    expect(screen.getByText("Fernanda Lima")).toBeTruthy();
    expect(screen.queryByText("João Pereira")).toBeNull();
  });

  it("filtro de responsável restringe as linhas exibidas", () => {
    render(<LeadTable dados={linhas} etapas={["Novo", "Contato feito"]} responsaveis={["Admin Exemplo", "Vendedor Exemplo"]} />);

    fireEvent.change(screen.getByLabelText("Responsável"), { target: { value: "Vendedor Exemplo" } });

    expect(screen.queryByText("Carlos Silva")).toBeNull();
    expect(screen.getByText("Fernanda Lima")).toBeTruthy();
    expect(screen.queryByText("João Pereira")).toBeNull();
  });

  it("intervalo de data (de/até) restringe as linhas exibidas", () => {
    render(<LeadTable dados={linhas} etapas={["Novo", "Contato feito"]} responsaveis={["Admin Exemplo", "Vendedor Exemplo"]} />);

    fireEvent.change(screen.getByLabelText("Criado a partir de"), { target: { value: "2026-01-10" } });

    expect(screen.queryByText("Carlos Silva")).toBeNull();
    expect(screen.getByText("Fernanda Lima")).toBeTruthy();
    expect(screen.getByText("João Pereira")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Criado até"), { target: { value: "2026-01-20" } });

    expect(screen.getByText("Fernanda Lima")).toBeTruthy();
    expect(screen.queryByText("João Pereira")).toBeNull();
  });

  it("busca livre filtra por qualquer coluna (ex.: nome do contato)", () => {
    render(<LeadTable dados={linhas} etapas={["Novo", "Contato feito"]} responsaveis={["Admin Exemplo", "Vendedor Exemplo"]} />);

    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "fernanda" } });

    expect(screen.queryByText("Carlos Silva")).toBeNull();
    expect(screen.getByText("Fernanda Lima")).toBeTruthy();
    expect(screen.queryByText("João Pereira")).toBeNull();
  });

  it("filtros combinados sem nenhum resultado mostram o EmptyState, não uma tabela vazia", () => {
    render(<LeadTable dados={linhas} etapas={["Novo", "Contato feito"]} responsaveis={["Admin Exemplo", "Vendedor Exemplo"]} />);

    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "ninguem-com-esse-nome" } });

    expect(screen.getByText("Nenhum lead encontrado")).toBeTruthy();
  });

  it("lead sem contato identificado (canal WhatsApp) não quebra: mostra o rótulo consistente com o kanban (Task 15) e telefone como traço", () => {
    render(
      <LeadTable
        dados={[linhaFake({ contatoNome: "Sem contato identificado", telefone: null, canal: "WHATSAPP" as LeadChannel })]}
        etapas={["Novo"]}
        responsaveis={["Admin Exemplo"]}
      />
    );

    expect(screen.getByText("Sem contato identificado")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText("WhatsApp")).toBeTruthy();
  });

  it("lead sem responsável não quebra: mostra o mesmo rótulo do kanban (Task 15)", () => {
    render(
      <LeadTable
        dados={[linhaFake({ responsavelNome: "Sem responsável" })]}
        etapas={["Novo"]}
        responsaveis={["Admin Exemplo"]}
      />
    );

    expect(screen.getByText("Sem responsável")).toBeTruthy();
  });

  it(
    "o nome do contato é texto simples, não um link — fix round 1/5: /leads/:id só chega na " +
      "Task 17, um <Link> aqui hoje sempre daria 404",
    () => {
      render(<LeadTable dados={[linhaFake({ id: "lead-42", contatoNome: "Carlos Silva" })]} etapas={["Novo"]} responsaveis={["Admin Exemplo"]} />);

      expect(screen.getByText("Carlos Silva")).toBeTruthy();
      expect(screen.queryByRole("link", { name: "Carlos Silva" })).toBeNull();
    }
  );
});
