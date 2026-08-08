// @vitest-environment jsdom
//
// Cobre só a lógica de ramificação do client component (não layout/estilo,
// por instrução do Task 14): o que é enviado a `criarLeadManual`, como os
// dois modos de falha esperados (telefone inválido / sessão-autorização) e
// um erro genérico viram mensagem em português, que o formulário NÃO perde
// o que a pessoa digitou quando a submissão falha, e que o dropdown de
// responsável só aparece para quem pode atribuir a outra pessoa (Task 13:
// `criarLeadManual` clampa `responsavelId` no servidor para VENDEDOR).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const criarLeadManualMock = vi.fn();
vi.mock("@/core/leads/actions", () => ({
  criarLeadManual: (...args: unknown[]) => criarLeadManualMock(...args),
}));

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

const { LeadForm } = await import("../../src/components/leads/lead-form");

const vendedores = [
  { id: "user-1", nome: "Ana Gestora" },
  { id: "user-2", nome: "Bruno Vendedor" },
];

async function preencher() {
  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Cliente Teste" } });
  fireEvent.change(screen.getByLabelText("Telefone"), { target: { value: "11988887777" } });
}

describe("LeadForm", () => {
  beforeEach(() => {
    criarLeadManualMock.mockReset();
    refreshMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("todo papel vê o select com a lista de vendedores", () => {
    render(
      <LeadForm
        responsavelPadraoId="user-1"
        vendedores={vendedores}
      />
    );

    const select = screen.getByLabelText("Responsável") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(screen.getByRole("option", { name: "Ana Gestora" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Bruno Vendedor" })).toBeTruthy();
  });

  // Esta ramificação foi REMOVIDA, e o teste antigo dizia o contrário do que o
  // sistema faz hoje: até a auditoria de segurança desta branch, um VENDEDOR
  // via um campo desabilitado com o próprio nome, porque `criarLeadManual`
  // clampava a escolha no servidor. O clamp não impedia nada — bastava criar
  // o lead e reatribuir no clique seguinte, já que `atualizarLead` aceita
  // qualquer responsável para quem tem `mover_lead`. Decisão do dono: lead é
  // colaborativo, criar e editar concordam, todo papel escolhe.
  it("o vendedor escolhe outro responsavel — nao ha mais campo travado", () => {
    render(<LeadForm responsavelPadraoId="user-2" vendedores={vendedores} />);

    const select = screen.getByLabelText("Responsável") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(select.disabled).toBe(false);
    expect(select.value).toBe("user-2");
    expect(screen.getByRole("option", { name: "Ana Gestora" })).toBeTruthy();
  });

  it("submete sem enviar nenhum identificador de autor e usa o responsavelId escolhido", async () => {
    criarLeadManualMock.mockResolvedValue({ id: "lead-1" });
    render(
      <LeadForm
        responsavelPadraoId="user-1"
        vendedores={vendedores}
      />
    );

    await preencher();
    fireEvent.change(screen.getByLabelText("Responsável"), { target: { value: "user-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar lead" }));

    await waitFor(() => expect(criarLeadManualMock).toHaveBeenCalledTimes(1));
    expect(criarLeadManualMock).toHaveBeenCalledWith({
      nome: "Cliente Teste",
      telefone: "11988887777",
      email: undefined,
      responsavelId: "user-2",
    });
  });

  it(
    "sem tocar no select, a submissão envia responsavelId === responsavelPadraoId — " +
      "quem não quer mudar o responsável não precisa fazer nada",
    async () => {
      criarLeadManualMock.mockResolvedValue({ id: "lead-1" });
      render(<LeadForm responsavelPadraoId="user-2" vendedores={vendedores} />);

      await preencher();
      fireEvent.click(screen.getByRole("button", { name: "Adicionar lead" }));

      await waitFor(() => expect(criarLeadManualMock).toHaveBeenCalledTimes(1));
      expect(criarLeadManualMock).toHaveBeenCalledWith(
        expect.objectContaining({ responsavelId: "user-2" })
      );
    }
  );

  it("em caso de sucesso, limpa o formulário e atualiza a rota", async () => {
    criarLeadManualMock.mockResolvedValue({ id: "lead-1" });
    render(
      <LeadForm
        responsavelPadraoId="user-1"
        vendedores={vendedores}
      />
    );

    await preencher();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar lead" }));

    await waitFor(() => expect(screen.getByText("Lead criado com sucesso.")).toBeTruthy());
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText("Nome") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Telefone") as HTMLInputElement).value).toBe("");
  });

  it("telefone inválido: mostra a mensagem do servidor e NÃO apaga o que foi digitado", async () => {
    criarLeadManualMock.mockRejectedValue(
      new Error('Telefone inválido: "abc" não contém um número de telefone brasileiro reconhecível')
    );
    render(
      <LeadForm
        responsavelPadraoId="user-1"
        vendedores={vendedores}
      />
    );

    await preencher();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar lead" }));

    await waitFor(() =>
      expect(
        screen.getByText(
          'Telefone inválido: "abc" não contém um número de telefone brasileiro reconhecível'
        )
      ).toBeTruthy()
    );
    expect(refreshMock).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Nome") as HTMLInputElement).value).toBe("Cliente Teste");
    expect((screen.getByLabelText("Telefone") as HTMLInputElement).value).toBe("11988887777");
  });

  it("sessão inválida (usuarioAtual rejeitou): mostra mensagem própria, não o erro cru", async () => {
    criarLeadManualMock.mockRejectedValue(new Error("Não autenticado"));
    render(
      <LeadForm
        responsavelPadraoId="user-1"
        vendedores={vendedores}
      />
    );

    await preencher();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar lead" }));

    await waitFor(() =>
      expect(
        screen.getByText(
          "Sua sessão expirou ou sua conta foi desativada. Atualize a página e faça login novamente."
        )
      ).toBeTruthy()
    );
  });

  it("erro inesperado (ex.: banco fora do ar): cai no fallback genérico, sem vazar detalhe interno", async () => {
    criarLeadManualMock.mockRejectedValue(new Error("connection terminated unexpectedly"));
    render(
      <LeadForm
        responsavelPadraoId="user-1"
        vendedores={vendedores}
      />
    );

    await preencher();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar lead" }));

    await waitFor(() =>
      expect(screen.getByText("Não foi possível criar o lead. Tente novamente em instantes.")).toBeTruthy()
    );
    expect(screen.queryByText("connection terminated unexpectedly")).toBeNull();
  });
});
