// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const moverMock = vi.fn();
const definirFechamentoMock = vi.fn();
const excluirMock = vi.fn();
const editarMock = vi.fn();
vi.mock("@/core/pipeline/actions", () => ({
  moverEtapaNaOrdemAction: (...a: unknown[]) => moverMock(...a),
  definirEtapaDeFechamentoAction: (...a: unknown[]) => definirFechamentoMock(...a),
  excluirEtapaAction: (...a: unknown[]) => excluirMock(...a),
  editarEtapaAction: (...a: unknown[]) => editarMock(...a),
}));

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const { EtapasTable } = await import("../../src/components/pipeline/etapas-table");

const ETAPAS = [
  { id: "e-1", nome: "Novo", cor: "#0f62fe", ehGanho: false, leadsAtivos: 4, leadsTotais: 4 },
  { id: "e-2", nome: "Proposta", cor: "#24a148", ehGanho: false, leadsAtivos: 0, leadsTotais: 3 },
  { id: "e-3", nome: "Fechado", cor: "#8a3ffc", ehGanho: true, leadsAtivos: 2, leadsTotais: 2 },
];

afterEach(() => {
  cleanup();
  moverMock.mockReset();
  definirFechamentoMock.mockReset();
  excluirMock.mockReset();
  // Faltava (rodada de correção 1): sem isto, um `mockResolvedValue` de um
  // teste de edição vazava para o próximo — foi essa lacuna que deixou
  // passar o diálogo fechando mesmo quando `editarEtapaAction` recusava.
  editarMock.mockReset();
  refreshMock.mockReset();
});

describe("EtapasTable — setas", () => {
  it("a primeira linha não tem seta para cima", () => {
    render(<EtapasTable etapas={ETAPAS} />);
    const primeira = screen.getByText("Novo").closest("tr")!;
    expect(primeira.querySelector('[aria-label="Subir etapa"]')).toBeNull();
    expect(primeira.querySelector('[aria-label="Descer etapa"]')).not.toBeNull();
  });

  it("a última linha não tem seta para baixo", () => {
    render(<EtapasTable etapas={ETAPAS} />);
    const ultima = screen.getByText("Fechado").closest("tr")!;
    expect(ultima.querySelector('[aria-label="Descer etapa"]')).toBeNull();
    expect(ultima.querySelector('[aria-label="Subir etapa"]')).not.toBeNull();
  });

  it("clicar em subir chama a action com a direção certa", async () => {
    moverMock.mockResolvedValue({ ok: true });
    render(<EtapasTable etapas={ETAPAS} />);

    const linha = screen.getByText("Proposta").closest("tr")!;
    fireEvent.click(linha.querySelector('[aria-label="Subir etapa"]')!);

    await waitFor(() =>
      expect(moverMock).toHaveBeenCalledWith({ etapaId: "e-2", direcao: "cima" })
    );
  });

  it("falha de REDE avisa em vez de ficar em silêncio", async () => {
    const erroDoConsole = vi.spyOn(console, "error").mockImplementation(() => {});
    moverMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<EtapasTable etapas={ETAPAS} />);

    const linha = screen.getByText("Proposta").closest("tr")!;
    fireEvent.click(linha.querySelector('[aria-label="Subir etapa"]')!);

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/falar com o servidor/i)
    );
    erroDoConsole.mockRestore();
  });
});

describe("EtapasTable — marcador de fechamento", () => {
  it("a etapa de fechamento mostra badge, não botão", () => {
    render(<EtapasTable etapas={ETAPAS} />);
    const linha = screen.getByText("Fechado").closest("tr")!;
    expect(linha.textContent).toMatch(/Fechamento/);
    expect(
      Array.from(linha.querySelectorAll("button")).some(
        (b) => b.textContent === "Marcar como fechamento"
      )
    ).toBe(false);
  });

  it("as demais mostram o botão de marcar", () => {
    render(<EtapasTable etapas={ETAPAS} />);
    const linha = screen.getByText("Novo").closest("tr")!;
    expect(
      Array.from(linha.querySelectorAll("button")).some(
        (b) => b.textContent === "Marcar como fechamento"
      )
    ).toBe(true);
  });
});

describe("EtapasTable — contagem", () => {
  // O número que a tela mostra é o ESTRUTURAL. Mostrar só os ativos faria a
  // etapa "Proposta" (0 ativos, 3 arquivados) parecer vazia — e vazia é
  // justamente a que o usuário tenta apagar sem escolher destino.
  it("mostra o total, e separa os ativos quando divergem", () => {
    render(<EtapasTable etapas={ETAPAS} />);
    const linha = screen.getByText("Proposta").closest("tr")!;
    expect(linha.textContent).toMatch(/3/);
    expect(linha.textContent).toMatch(/0 ativos/);
  });

  it("etapa sem divergência mostra um número só", () => {
    render(<EtapasTable etapas={ETAPAS} />);
    const linha = screen.getByText("Novo").closest("tr")!;
    expect(linha.textContent).not.toMatch(/ativos/);
  });
});

describe("EtapasTable — exclusão", () => {
  it("etapa COM leads exige destino: confirmar fica desabilitado até escolher", async () => {
    render(<EtapasTable etapas={ETAPAS} />);
    const linha = screen.getByText("Proposta").closest("tr")!;
    fireEvent.click(linha.querySelector('[aria-label="Remover etapa"]')!);

    const confirmar = await screen.findByRole("button", { name: "Remover etapa" });
    expect((confirmar as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Mover os leads para"), { target: { value: "e-1" } });
    await waitFor(() => expect((confirmar as HTMLButtonElement).disabled).toBe(false));
  });

  it("etapa SEM lead nenhum não pede destino", async () => {
    const vazia = [
      { id: "e-9", nome: "Vazia", cor: "#000000", ehGanho: false, leadsAtivos: 0, leadsTotais: 0 },
      ...ETAPAS,
    ];
    render(<EtapasTable etapas={vazia} />);
    const linha = screen.getByText("Vazia").closest("tr")!;
    fireEvent.click(linha.querySelector('[aria-label="Remover etapa"]')!);

    await screen.findByRole("button", { name: "Remover etapa" });
    expect(screen.queryByLabelText("Mover os leads para")).toBeNull();
  });
});

describe("EtapasTable — edição", () => {
  // Rodada de correção 1, achado 2: nenhum teste abria o diálogo de editar.
  // Foi essa lacuna que deixou passar o achado 1 (diálogo fechando mesmo
  // quando a action recusava).
  it("editar com sucesso chama a action com os dados certos e fecha o diálogo", async () => {
    editarMock.mockResolvedValue({ ok: true });
    render(<EtapasTable etapas={ETAPAS} />);

    const linha = screen.getByText("Novo").closest("tr")!;
    fireEvent.click(linha.querySelector('[aria-label="Editar etapa"]')!);

    const campoNome = await screen.findByLabelText("Nome");
    fireEvent.change(campoNome, { target: { value: "Novo lead" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(editarMock).toHaveBeenCalledWith({ etapaId: "e-1", nome: "Novo lead", cor: "#0f62fe" })
    );
    // A action deu certo: o diálogo fecha, e o campo "Nome" some da tela.
    await waitFor(() => expect(screen.queryByLabelText("Nome")).toBeNull());
  });

  // Achado da revisão final: `useState(nomeAtual)` em `EditarEtapaDialogo`
  // só lia a prop na primeira renderização — abrir, digitar, Cancelar e
  // reabrir mostrava a edição abandonada como se fosse o nome atual.
  it("abrir, digitar, Cancelar e reabrir mostra o nome ORIGINAL — não a edição abandonada", async () => {
    render(<EtapasTable etapas={ETAPAS} />);
    const linha = screen.getByText("Novo").closest("tr")!;

    fireEvent.click(linha.querySelector('[aria-label="Editar etapa"]')!);
    const campoNome = await screen.findByLabelText("Nome");
    fireEvent.change(campoNome, { target: { value: "Edição abandonada" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByLabelText("Nome")).toBeNull());

    fireEvent.click(linha.querySelector('[aria-label="Editar etapa"]')!);
    const campoNomeReaberto = await screen.findByLabelText("Nome");
    expect((campoNomeReaberto as HTMLInputElement).value).toBe("Novo");

    // A action nunca foi chamada: nada disto foi salvo, é só estado local do diálogo.
    expect(editarMock).not.toHaveBeenCalled();
  });

  it("editar recusado mantém o diálogo aberto", async () => {
    editarMock.mockResolvedValue({ ok: false, erro: 'Já existe uma etapa chamada "Novo".' });
    render(<EtapasTable etapas={ETAPAS} />);

    const linha = screen.getByText("Proposta").closest("tr")!;
    fireEvent.click(linha.querySelector('[aria-label="Editar etapa"]')!);

    const campoNome = await screen.findByLabelText("Nome");
    fireEvent.change(campoNome, { target: { value: "Novo" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(editarMock).toHaveBeenCalled());
    // O diálogo NÃO fechou: o campo "Nome" continua na tela, e a mensagem
    // de erro aparece — sem os dois, alguém reintroduz o fechamento
    // prematuro e nenhum teste acusa.
    expect(screen.getByLabelText("Nome")).not.toBeNull();
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Já existe uma etapa/)
    );
  });
});

describe("EtapasTable — exclusão recusada", () => {
  it("excluir recusado mantém o diálogo aberto", async () => {
    excluirMock.mockResolvedValue({
      ok: false,
      erro: "Não é possível remover a etapa de fechamento.",
    });
    const vazia = [
      { id: "e-9", nome: "Vazia", cor: "#000000", ehGanho: false, leadsAtivos: 0, leadsTotais: 0 },
      ...ETAPAS,
    ];
    render(<EtapasTable etapas={vazia} />);
    const linha = screen.getByText("Vazia").closest("tr")!;
    fireEvent.click(linha.querySelector('[aria-label="Remover etapa"]')!);

    const confirmar = await screen.findByRole("button", { name: "Remover etapa" });
    fireEvent.click(confirmar);

    await waitFor(() => expect(excluirMock).toHaveBeenCalled());
    // O diálogo NÃO fechou: o botão "Remover etapa" continua na tela.
    expect(screen.getByRole("button", { name: "Remover etapa" })).not.toBeNull();
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/etapa de fechamento/)
    );
  });
});
