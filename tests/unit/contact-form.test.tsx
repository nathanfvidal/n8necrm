// @vitest-environment jsdom
//
// Primeiro teste de componente da agenda de contatos. O formulário passou de
// 3 campos numa linha para 10 campos em quatro seções, e o que este arquivo
// protege NÃO é o layout — é o punhado de decisões onde uma mudança inocente
// quebra outra coisa longe daqui:
//
//   1. Os rótulos "Nome" e "Telefone" continuam EXATOS e únicos. O e2e
//      (`tests/e2e/contatos.spec.ts`) usa `getByLabel("Nome", { exact: true })`,
//      e um segundo campo chamado só "Nome" o derrubaria com erro de modo
//      estrito — que parece defeito de aplicação e não é.
//   2. Existe UM `<form>` só. O mesmo e2e localiza o formulário por
//      `page.locator("form")`, e quatro `<fieldset>` numa tela com dois
//      `<form>` quebraria o localizador E o envio.
//   3. Campo apagado vai como string VAZIA para a action, não como
//      `undefined`. É o que torna "limpar a empresa de alguém" alcançável
//      pela tela — `undefined` diria ao Prisma "não mexa nesta coluna".
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const criarContatoActionMock = vi.fn();
const atualizarContatoActionMock = vi.fn();
vi.mock("@/core/contacts/actions", () => ({
  criarContatoAction: (...args: unknown[]) => criarContatoActionMock(...args),
  atualizarContatoAction: (...args: unknown[]) => atualizarContatoActionMock(...args),
}));

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

const { ContactForm } = await import("../../src/components/contacts/contact-form");

const CONTATO = {
  id: "contato-1",
  nome: "Carlos Andrade",
  telefone: "11988887777",
  email: "carlos@acme.com",
  empresa: "Acme Ltda",
  cargo: "Diretor",
  documento: "12345678901",
  endereco: "Rua das Flores, 100",
  cidade: "São Paulo",
  uf: "SP",
  observacoes: "Prefere ligação de manhã.",
};

afterEach(() => {
  cleanup();
  criarContatoActionMock.mockReset();
  atualizarContatoActionMock.mockReset();
  refreshMock.mockReset();
});

describe("localizadores de que o e2e depende", () => {
  it("'Nome' e 'Telefone' casam com exatamente um campo cada", () => {
    render(<ContactForm />);

    // `getByLabelText` com string exata LANÇA se achar mais de um. Este teste
    // fica vermelho no instante em que alguém criar um segundo campo "Nome" —
    // que é o ponto.
    expect(screen.getByLabelText("Nome")).toBeDefined();
    expect(screen.getByLabelText("Telefone")).toBeDefined();
  });

  it("a tela tem um único formulário, mesmo com quatro seções", () => {
    const { container } = render(<ContactForm />);

    expect(container.querySelectorAll("form")).toHaveLength(1);
    expect(container.querySelectorAll("fieldset")).toHaveLength(4);
  });
});

describe("campos do cadastro", () => {
  it("mostra os dez campos para quem pode ver o documento", () => {
    render(<ContactForm podeVerDocumento />);

    for (const rotulo of [
      "Nome",
      "Telefone",
      "E-mail",
      "Empresa",
      "Cargo",
      "Documento",
      "Logradouro",
      "Cidade",
      "UF",
      "Observações",
    ]) {
      expect(screen.getByLabelText(rotulo), `campo ausente: ${rotulo}`).toBeDefined();
    }
  });

  // Achado R2 da auditoria. Esconder aqui é conforto, não proteção — as duas
  // camadas que contam são a consulta (que devolve `documento: null`) e a
  // action (que descarta o campo). Mas o conforto importa: um campo desenhado
  // e sempre vazio faria a pessoa achar que o CRM perdeu o CPF.
  it("esconde o Documento de quem não tem permissão, e mantém os outros nove", () => {
    render(<ContactForm />);

    expect(screen.queryByLabelText("Documento")).toBeNull();
    for (const rotulo of ["Nome", "Telefone", "Empresa", "Cargo", "Cidade", "UF", "Observações"]) {
      expect(screen.getByLabelText(rotulo), `campo sumiu junto: ${rotulo}`).toBeDefined();
    }
  });

  // O padrão da prop é `false`. Um uso novo que esqueça de passá-la esconde o
  // CPF em vez de expor — errar para o lado seguro é o ponto.
  it("o padrão da prop é esconder", () => {
    render(<ContactForm contato={CONTATO} />);

    expect(screen.queryByLabelText("Documento")).toBeNull();
  });

  it("a UF oferece as 27 siglas mais a opção vazia", () => {
    render(<ContactForm />);

    const seletor = screen.getByLabelText("UF") as HTMLSelectElement;
    expect(seletor.options).toHaveLength(28);
    expect(seletor.options[0].value).toBe("");
  });

  it("em modo edição, começa preenchido com o que já está gravado", () => {
    render(<ContactForm contato={CONTATO} podeVerDocumento />);

    expect((screen.getByLabelText("Empresa") as HTMLInputElement).value).toBe("Acme Ltda");
    expect((screen.getByLabelText("Documento") as HTMLInputElement).value).toBe("12345678901");
    expect((screen.getByLabelText("UF") as HTMLSelectElement).value).toBe("SP");
    expect((screen.getByLabelText("Observações") as HTMLTextAreaElement).value).toBe(
      "Prefere ligação de manhã."
    );
  });

  it("campo nulo no banco vira campo vazio, e não a palavra 'null' na tela", () => {
    render(<ContactForm contato={{ ...CONTATO, empresa: null, uf: null }} />);

    expect((screen.getByLabelText("Empresa") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("UF") as HTMLSelectElement).value).toBe("");
  });
});

describe("envio", () => {
  it("manda os campos novos para a action de criação", async () => {
    criarContatoActionMock.mockResolvedValue({ ok: true });
    render(<ContactForm />);

    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Nova Pessoa" } });
    fireEvent.change(screen.getByLabelText("Telefone"), { target: { value: "11999998888" } });
    fireEvent.change(screen.getByLabelText("Empresa"), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText("UF"), { target: { value: "RJ" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar contato" }));

    await waitFor(() => expect(criarContatoActionMock).toHaveBeenCalledTimes(1));
    expect(criarContatoActionMock.mock.calls[0][0]).toMatchObject({
      nome: "Nova Pessoa",
      empresa: "Acme",
      uf: "RJ",
    });
  });

  // O comportamento que torna "apagar um campo" possível pela tela. Se o
  // formulário mandasse `undefined` no lugar da string vazia, o `update` do
  // Prisma entenderia "não mexa nesta coluna" e a empresa ficaria lá para
  // sempre, sem nenhum erro e sem nenhuma pista.
  it("campo esvaziado chega à action como string vazia, nunca como undefined", async () => {
    atualizarContatoActionMock.mockResolvedValue({ ok: true });
    render(<ContactForm contato={CONTATO} />);

    fireEvent.change(screen.getByLabelText("Empresa"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() => expect(atualizarContatoActionMock).toHaveBeenCalledTimes(1));
    const enviado = atualizarContatoActionMock.mock.calls[0][0] as Record<string, unknown>;
    expect(enviado.empresa).toBe("");
    expect("empresa" in enviado).toBe(true);
  });

  it("erro do servidor aparece na tela e o que foi digitado permanece", async () => {
    criarContatoActionMock.mockResolvedValue({
      ok: false,
      erro: "Este telefone já está cadastrado para Maria.",
    });
    render(<ContactForm />);

    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Nova Pessoa" } });
    fireEvent.change(screen.getByLabelText("Telefone"), { target: { value: "11999998888" } });
    fireEvent.change(screen.getByLabelText("Empresa"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar contato" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("já está cadastrado para Maria")
    );
    // Nada de `reset` no erro: a mensagem diz de QUEM é o telefone, e apagar o
    // formulário tiraria o contexto junto com o trabalho da pessoa.
    expect((screen.getByLabelText("Empresa") as HTMLInputElement).value).toBe("Acme");
  });
});
