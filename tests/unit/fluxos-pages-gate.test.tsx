// @vitest-environment jsdom
//
// Achado B2 da revisao final do Ciclo 4: `src/app/(painel)/fluxos/page.tsx`
// e `src/app/(painel)/fluxos/[id]/page.tsx` fazem `notFound()` sem
// `ver_fluxos` e calculam `podeGerenciar` a partir de `gerenciar_fluxos` --
// duas permissoes distintas na MESMA tela -- e ate aqui nenhuma das duas
// tinha teste, so leitura de codigo. Quem mexer em `hasPermission` depois
// nao teria como descobrir que quebrou o gate.
//
// Mesmo padrao de `login-page-guard.test.tsx`: os dois Server Components sao
// funcoes async chamadas diretamente (sem framework de rota), o retorno e um
// elemento React que da pra `render()` no jsdom (fluxos-table.test.tsx e
// confirmar-dialogo-digitar.test.tsx ja prova que os componentes filhos
// (FluxosTable, ConfirmarDialogo, StatusFluxo, EmptyState) renderizam sem
// mock nenhum sob jsdom).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@/modules/automation/actions", () => ({
  ativarFluxoAction: vi.fn(),
  desativarFluxoAction: vi.fn(),
  apagarFluxoAction: vi.fn(),
  reexecutarExecucaoAction: vi.fn(),
}));

// `notFound()` de verdade lanca um erro de controle de fluxo e nunca
// retorna -- o mock reproduz isso, para que um bug que engula o erro dentro
// de um try/catch (a mesma armadilha que `login-page-guard.test.tsx`
// documenta para `redirect()`) apareca como o notFound "nao acontecendo".
// `useRouter` entra no mesmo mock porque `ApagarFluxo`
// (`components/automation/apagar-fluxo.tsx`, renderizado quando
// `podeGerenciar` e verdadeiro) o importa de "next/navigation".
const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  useRouter: () => ({ push: pushMock }),
}));

// `exigirModulo` passou a ler o banco no Ciclo 1c (`CompanyConfig.modulos`).
// Este arquivo testa o gate de PERMISSAO, nao o de modulo -- o de modulo tem
// arquivo proprio (`config-modulos.test.ts`). Mockar aqui mantem os dois
// separados: sem isto, um modulo desligado faria estes casos falharem com
// `notFound` pelo motivo errado.
//
// O mock e `vi.fn()` NOMEADO, e nao um `async () => {}` anonimo, de proposito:
// os casos abaixo afirmam COM QUE `companyId` ele foi chamado. Um mock que so
// engole a chamada deixaria passar exatamente o defeito que este ciclo caca --
// a fixture de sessao sem `companyId`, repassando `undefined` para o portao e
// ficando verde. `User` do Prisma nao tem `companyId`; quem tem e
// `UsuarioAtivo` (`core/auth/usuario-ativo.ts`), e e ele que
// `usuarioAtualOuLogin()` devolve.
const exigirModuloMock = vi.fn<(companyId: string, nome: string) => Promise<void>>(async () => {});
vi.mock("@/core/config/modulos", () => ({
  exigirModulo: (companyId: string, nome: string) => exigirModuloMock(companyId, nome),
}));

const usuarioAtualOuLoginMock = vi.fn();
vi.mock("@/core/auth/session", () => ({ usuarioAtualOuLogin: () => usuarioAtualOuLoginMock() }));

const listarFluxosMock = vi.fn();
vi.mock("@/modules/automation/queries", () => ({ listarFluxos: () => listarFluxosMock() }));

class ErroN8nFake extends Error {
  constructor(
    msg: string,
    readonly tipo: string
  ) {
    super(msg);
    this.name = "ErroN8n";
  }
}
const clienteMock = {
  buscarWorkflow: vi.fn(),
  listarExecucoes: vi.fn(),
};
// `urlBaseN8n` entra aqui mesmo sem ser lido diretamente por este arquivo:
// `fluxos/[id]/page.tsx` monta a URL do editor embutido a partir da env do
// n8n (achado M5 da mesma revisao), e este mock evita que o teste do gate
// dependa de `N8N_API_URL` estar definida no ambiente de teste.
vi.mock("@/modules/automation/n8n", () => ({
  clienteN8n: clienteMock,
  ErroN8n: ErroN8nFake,
  urlBaseN8n: () => "https://n8n.exemplo.invalid",
}));

const { default: FluxosPage } = await import("../../src/app/(painel)/fluxos/page");
const { default: FluxoDetalhePage } = await import("../../src/app/(painel)/fluxos/[id]/page");

// `companyId` entrou nas tres fixturas no Ciclo 1c, e nao e enfeite: as duas
// paginas passaram a fazer `exigirModulo(usuario.companyId, "automation")`.
// Sem o campo, o portao receberia `undefined` e os casos continuariam verdes
// -- o modo de falha que este arquivo agora afirma contra, no caso
// "o portao de modulo recebe o companyId DA SESSAO".
const EMPRESA = "cmp_fluxos";
const ADMIN = { papel: "ADMIN", companyId: EMPRESA } as const;
const GESTOR = { papel: "GESTOR", companyId: EMPRESA } as const;
const VENDEDOR = { papel: "VENDEDOR", companyId: EMPRESA } as const;

const FLUXO_MOCK = {
  id: "wf-1",
  nome: "Noiva Inteligente",
  ativo: true,
  nos: 5,
  tags: [],
  atualizadoEm: "",
};

afterEach(() => {
  cleanup();
});

describe("FluxosPage (lista) — gate de ver_fluxos e de gerenciar_fluxos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listarFluxosMock.mockResolvedValue({ ok: true, fluxos: [{ ...FLUXO_MOCK, ultimaExecucao: null }] });
  });

  it("VENDEDOR: sem ver_fluxos, a pagina lanca notFound() e nem chega a consultar o n8n", async () => {
    usuarioAtualOuLoginMock.mockResolvedValue(VENDEDOR);

    await expect(FluxosPage()).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFoundMock).toHaveBeenCalledTimes(1);
    expect(listarFluxosMock).not.toHaveBeenCalled();
  });

  it("o portao de modulo recebe o companyId DA SESSAO, nao undefined", async () => {
    usuarioAtualOuLoginMock.mockResolvedValue(ADMIN);

    await FluxosPage();

    expect(exigirModuloMock).toHaveBeenCalledWith(EMPRESA, "automation");
  });

  it("GESTOR: renderiza a lista, mas podeGerenciar e falso — sem a coluna \"Ações\"", async () => {
    usuarioAtualOuLoginMock.mockResolvedValue(GESTOR);

    const elemento = await FluxosPage();
    render(elemento);

    expect(notFoundMock).not.toHaveBeenCalled();
    expect(screen.getByText("Noiva Inteligente")).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "Ações" })).toBeNull();
  });

  it("ADMIN: renderiza a lista com podeGerenciar verdadeiro — coluna \"Ações\" presente", async () => {
    usuarioAtualOuLoginMock.mockResolvedValue(ADMIN);

    const elemento = await FluxosPage();
    render(elemento);

    expect(notFoundMock).not.toHaveBeenCalled();
    expect(screen.getByRole("columnheader", { name: "Ações" })).toBeTruthy();
  });
});

describe("FluxoDetalhePage (detalhe) — mesmo gate de ver_fluxos e de gerenciar_fluxos", () => {
  const params = Promise.resolve({ id: "wf-1" });
  const searchParams = Promise.resolve({});

  beforeEach(() => {
    vi.clearAllMocks();
    clienteMock.buscarWorkflow.mockResolvedValue(FLUXO_MOCK);
    clienteMock.listarExecucoes.mockResolvedValue({ itens: [], proximoCursor: null });
  });

  it("VENDEDOR: sem ver_fluxos, a pagina lanca notFound() antes de tocar o n8n", async () => {
    usuarioAtualOuLoginMock.mockResolvedValue(VENDEDOR);

    await expect(FluxoDetalhePage({ params, searchParams })).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFoundMock).toHaveBeenCalledTimes(1);
    expect(clienteMock.buscarWorkflow).not.toHaveBeenCalled();
  });

  it("o portao de modulo recebe o companyId DA SESSAO, nao undefined", async () => {
    usuarioAtualOuLoginMock.mockResolvedValue(ADMIN);

    await FluxoDetalhePage({ params, searchParams });

    expect(exigirModuloMock).toHaveBeenCalledWith(EMPRESA, "automation");
  });

  it("GESTOR: renderiza o detalhe, mas sem o botão \"Apagar fluxo\" (podeGerenciar falso)", async () => {
    usuarioAtualOuLoginMock.mockResolvedValue(GESTOR);

    const elemento = await FluxoDetalhePage({ params, searchParams });
    render(elemento);

    expect(notFoundMock).not.toHaveBeenCalled();
    expect(screen.getByText("Noiva Inteligente")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Apagar fluxo" })).toBeNull();
  });

  it("ADMIN: renderiza o detalhe com o botão \"Apagar fluxo\" (podeGerenciar verdadeiro)", async () => {
    usuarioAtualOuLoginMock.mockResolvedValue(ADMIN);

    const elemento = await FluxoDetalhePage({ params, searchParams });
    render(elemento);

    expect(notFoundMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Apagar fluxo" })).toBeTruthy();
  });
});
