// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@/modules/automation/actions", () => ({
  ativarFluxoAction: vi.fn(),
  desativarFluxoAction: vi.fn(),
  apagarFluxoAction: vi.fn(),
}));

import { FluxosTable } from "../../src/components/automation/fluxos-table";

// `ultimaExecucao` entrou aqui por causa do Step 3 do brief: `listarFluxos`
// devolve `FluxoComUltimaExecucao[]`, não `WorkflowResumo[]` puro — a tabela
// ganhou uma coluna "Última execução" e o tipo da prop mudou junto. Um fluxo
// com `ultimaExecucao: null` (nunca rodou, ou rodou fora da janela das 100
// execuções recentes) é o caso real mais comum numa instância com 6 workflows.
const fluxos = [
  {
    id: "a",
    nome: "Noiva Inteligente",
    ativo: true,
    nos: 65,
    tags: ["prod"],
    atualizadoEm: "2026-08-19T21:00:00.000Z",
    ultimaExecucao: {
      id: "exec-1",
      workflowId: "a",
      status: "success" as const,
      modo: "webhook",
      iniciadoEm: "2026-08-19T21:05:00.000Z",
      terminadoEm: "2026-08-19T21:05:03.000Z",
    },
  },
  {
    id: "b",
    nome: "My workflow",
    ativo: false,
    nos: 11,
    tags: [],
    atualizadoEm: "2026-08-10T10:00:00.000Z",
    ultimaExecucao: null,
  },
];

// `toBeInTheDocument` (jest-dom) não está instalado neste projeto — nenhum
// outro teste da suíte usa esse matcher (ver `etapas-table.test.tsx`, que
// usa `.not.toBeNull()`/`.toBeTruthy()`). O texto do brief citava
// `toBeInTheDocument` como se estivesse disponível; a suíte real não tem
// `@testing-library/jest-dom` instalado nem carregado em `vitest.config.ts`,
// então os testes abaixo seguem o padrão que o resto do projeto já usa.
// Sem `cleanup()` entre casos, cada `render()` soma ao DOM em vez de
// substituir o anterior — foi isso que fez o teste "sem permissão" enxergar
// o botão "Desativar" deixado pelo `render()` anterior, com `podeGerenciar`
// diferente. Mesmo padrão de `afterEach` de `etapas-table.test.tsx`.
afterEach(() => {
  cleanup();
});

describe("FluxosTable", () => {
  it("mostra nome, contagem de nos e o estado de cada fluxo", () => {
    render(<FluxosTable fluxos={fluxos} podeGerenciar={true} />);

    expect(screen.getByText("Noiva Inteligente")).toBeTruthy();
    expect(screen.getByText("65")).toBeTruthy();
    expect(screen.getByText("Ativo")).toBeTruthy();
    expect(screen.getByText("Desligado")).toBeTruthy();
  });

  it("sem permissao de gerenciar, nao renderiza nenhum botao de acao destrutiva", () => {
    render(<FluxosTable fluxos={fluxos} podeGerenciar={false} />);

    expect(screen.queryByRole("button", { name: /desativar/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /apagar/i })).toBeNull();
  });

  it("com permissao, o fluxo ativo oferece desativar e o desligado oferece ativar", () => {
    render(<FluxosTable fluxos={fluxos} podeGerenciar={true} />);

    // Nome EXATO, não `/ativar/i`: "Desativar" contém "ativar" como
    // substring ("des-ATIVAR"), então uma regex solta casa os dois botões
    // e `getByRole` lança por encontrar mais de um elemento.
    expect(screen.getByRole("button", { name: "Desativar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ativar" })).toBeTruthy();
  });

  it("fluxo sem ultima execucao mostra travessao na coluna de ultima execucao", () => {
    render(<FluxosTable fluxos={fluxos} podeGerenciar={true} />);

    const linha = screen.getByText("My workflow").closest("tr")!;
    expect(linha.textContent).toMatch(/—/);
  });
});
