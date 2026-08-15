// @vitest-environment jsdom
//
// Cobre só a lógica de ramificação do client component (não layout/estilo,
// por instrução do Task 14): o que é enviado a `criarLeadManualAction`, como os
// dois modos de falha esperados (telefone inválido / sessão-autorização) e
// um erro genérico viram mensagem em português, que o formulário NÃO perde
// o que a pessoa digitou quando a submissão falha, e que o dropdown de
// responsável só aparece para quem pode atribuir a outra pessoa (Task 13:
// `criarLeadManualAction` clampa `responsavelId` no servidor para VENDEDOR).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const criarLeadManualMock = vi.fn();
vi.mock("@/core/leads/actions", () => ({
  criarLeadManualAction: (...args: unknown[]) => criarLeadManualMock(...args),
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
  // via um campo desabilitado com o próprio nome, porque `criarLeadManualAction`
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
    criarLeadManualMock.mockResolvedValue({ ok: true });
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
      criarLeadManualMock.mockResolvedValue({ ok: true });
      render(<LeadForm responsavelPadraoId="user-2" vendedores={vendedores} />);

      await preencher();
      fireEvent.click(screen.getByRole("button", { name: "Adicionar lead" }));

      await waitFor(() => expect(criarLeadManualMock).toHaveBeenCalledTimes(1));
      expect(criarLeadManualMock).toHaveBeenCalledWith(
        expect.objectContaining({ responsavelId: "user-2" })
      );
    }
  );

  /**
   * A asserção `expect(refreshMock).toHaveBeenCalledTimes(1)` virou o
   * OPOSTO, e isso é a mudança, não um teste enfraquecido.
   *
   * `criarLeadManualAction` chama `revalidatePath("/(painel)", "layout")`, e
   * o Next devolve a árvore re-renderizada junto da resposta da própria
   * action. O `router.refresh()` que existia aqui pagava um SEGUNDO render
   * completo da rota em cima disso — medido: criar um lead custava 25
   * consultas ao Postgres e ~3,8 s, com a mesma consulta de `PipelineStage`
   * aparecendo quatro vezes.
   *
   * Quem prova que a tabela CONTINUA atualizando é `lead-to-won.spec.ts`, e
   * só ele pode: clica em "Adicionar lead" e exige a linha nova na tela sem
   * nenhum `goto` nem `reload` no meio. Um teste de unidade não enxerga
   * revalidação de servidor — o máximo que ele pode fazer é o que faz aqui,
   * travar que o componente não dispara um segundo render por conta própria.
   */
  it("em caso de sucesso, limpa o formulário e NÃO pede um segundo render", async () => {
    criarLeadManualMock.mockResolvedValue({ ok: true });
    render(
      <LeadForm
        responsavelPadraoId="user-1"
        vendedores={vendedores}
      />
    );

    await preencher();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar lead" }));

    await waitFor(() => expect(screen.getByText("Lead criado com sucesso.")).toBeTruthy());
    expect(refreshMock).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Nome") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Telefone") as HTMLInputElement).value).toBe("");
  });

  it("telefone inválido: mostra a mensagem do servidor e NÃO apaga o que foi digitado", async () => {
    criarLeadManualMock.mockResolvedValue({
      ok: false,
      erro: 'Telefone inválido: "abc" não contém um número de telefone brasileiro reconhecível',
    });
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

  it("sessão inválida: mostra a frase do servidor, sem reescrever", async () => {
    criarLeadManualMock.mockResolvedValue({
      ok: false,
      erro: "Sua sessão expirou. Recarregue a página e entre de novo.",
    });
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
        screen.getByText("Sua sessão expirou. Recarregue a página e entre de novo.")
      ).toBeTruthy()
    );
  });

  // ─── A falha que o resultado NÃO cobre ────────────────────────────────
  //
  // Este teste pegou uma regressão real desta entrega: ao trocar o `catch` por
  // `if (!resultado.ok)`, o formulário ficou SEM tratamento para a promise
  // rejeitada. `criarLeadManualAction` não lança — mas a rede lança, e nesse
  // caso o botão voltava ao normal sem mensagem nenhuma, como se nada tivesse
  // sido tentado. Ver `registrarFalhaDeRede` em `src/lib/acao.ts`.
  it("falha de REDE: mostra aviso próprio e NÃO apaga o que foi digitado", async () => {
    const erroDoConsole = vi.spyOn(console, "error").mockImplementation(() => {});
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
      expect(screen.getByRole("alert").textContent).toMatch(/falar com o servidor/i)
    );
    expect(screen.queryByText("connection terminated unexpectedly")).toBeNull();
    expect(refreshMock).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Nome") as HTMLInputElement).value).toBe("Cliente Teste");
    erroDoConsole.mockRestore();
  });
});
