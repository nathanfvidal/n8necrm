// @vitest-environment jsdom
//
// Teste do mapeamento status → variante de `StatusExecucao`
// (`src/components/automation/status-execucao.tsx`). Existe por causa do bug
// original em `execucoes-table.tsx`: `variant={status === "success" ?
// "default" : "destructive"}` pintava de vermelho TUDO que não é sucesso,
// inclusive `running` e `waiting` — uma execução rodando normalmente agora
// aparecia como falha na tela de diagnóstico. O caso mais importante aqui é
// justamente provar que isso não volta a acontecer.
//
// `toBeInTheDocument`/`toHaveClass` (jest-dom) não estão instalados neste
// projeto — mesmo padrão de `fluxos-table.test.tsx`: leitura de propriedade
// (`element.className`) e `toBeTruthy()`/`.not.toContain()`.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { StatusExecucao } from "../../src/components/automation/status-execucao";
import type { StatusExecucao as TipoStatusExecucao } from "../../src/modules/automation/n8n";

afterEach(() => {
  cleanup();
});

describe("StatusExecucao", () => {
  it("mostra o rótulo em português de cada status", () => {
    const casos: Array<[TipoStatusExecucao, string]> = [
      ["success", "Sucesso"],
      ["error", "Erro"],
      ["waiting", "Aguardando"],
      ["running", "Rodando"],
      ["canceled", "Cancelado"],
      ["crashed", "Falhou"],
      ["new", "Novo"],
      ["unknown", "Desconhecido"],
    ];

    for (const [status, rotulo] of casos) {
      const { unmount } = render(<StatusExecucao status={status} />);
      expect(screen.getByText(rotulo)).toBeTruthy();
      unmount();
    }
  });

  // O bug em si: `running` e `waiting` são execuções em andamento, não
  // falhas — não podem carregar a classe de baixa-opacidade vermelha
  // (`bg-destructive/10`, ver `badge.tsx`) que a variante `destructive` usa.
  it("running e waiting NÃO recebem o tratamento visual de erro (destructive)", () => {
    for (const status of ["running", "waiting"] as const) {
      const { unmount } = render(<StatusExecucao status={status} />);
      const badge = screen.getByText(status === "running" ? "Rodando" : "Aguardando");
      expect(badge.className).not.toContain("bg-destructive");
      unmount();
    }
  });

  it("error e crashed são a ÚNICA família com o tratamento visual de erro (destructive)", () => {
    for (const status of ["error", "crashed"] as const) {
      const { unmount } = render(<StatusExecucao status={status} />);
      const badge = screen.getByText(status === "error" ? "Erro" : "Falhou");
      expect(badge.className).toContain("bg-destructive");
      unmount();
    }
  });

  it("success, canceled e unknown não recebem tratamento de erro nem a cor primária de ação", () => {
    for (const status of ["success", "canceled", "unknown"] as const) {
      const rotulo = { success: "Sucesso", canceled: "Cancelado", unknown: "Desconhecido" }[status];
      const { unmount } = render(<StatusExecucao status={status} />);
      const badge = screen.getByText(rotulo);
      expect(badge.className).not.toContain("bg-destructive");
      expect(badge.className).not.toContain("bg-primary");
      unmount();
    }
  });

  it("new também é tratado como 'em andamento', sem alarme", () => {
    render(<StatusExecucao status="new" />);
    const badge = screen.getByText("Novo");
    expect(badge.className).not.toContain("bg-destructive");
  });
});
