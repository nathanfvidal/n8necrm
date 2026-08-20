// @vitest-environment jsdom
//
// O portão das PÁGINAS de Configurações, que é uma afirmação diferente da do
// portão das actions (`conexoes-actions.test.ts`). As duas precisam existir: a
// action barra o POST direto, a página barra a navegação — e uma página que
// esquecesse o `redirect` entregaria a GESTOR e VENDEDOR a lista de conexões,
// com nome de instância e domínio da empresa, mesmo sem nenhum botão funcionar.
//
// Mesmo padrão de `fluxos-pages-gate.test.tsx`: os Server Components são
// funções async chamadas direto, sem framework de rota, e o elemento que
// devolvem vai para `render()` no jsdom.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import type { UsuarioAtivo } from "../../src/core/auth/usuario-ativo";
import type { ConexaoApresentada } from "../../src/core/conexoes/service";

// `redirect()` de verdade lança um erro de controle de fluxo e NUNCA retorna.
// O mock reproduz isso: sem lançar, uma página que chamasse `redirect` e
// seguisse renderizando passaria neste arquivo — e é exatamente esse o defeito
// (o `redirect` dentro de um `try` que engole o erro, armadilha registrada em
// `login-page-guard.test.tsx`).
const redirectMock = vi.fn((destino: string) => {
  throw new Error(`NEXT_REDIRECT:${destino}`);
});
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => redirectMock(destino),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/configuracoes/conexoes",
}));

const usuarioAtualOuLoginMock = vi.fn();
vi.mock("@/core/auth/session", () => ({
  usuarioAtualOuLogin: () => usuarioAtualOuLoginMock(),
}));

// O serviço inteiro, e não só `listarConexoes`: `vi.mock` troca o MÓDULO. Sem
// as escritas aqui o módulo mockado ficaria sem elas — e o `service.ts` real
// puxa `@/lib/prisma` → `@/lib/env`, que valida em escopo de módulo e
// derrubaria o arquivo por falta de `DATABASE_URL`.
const listarConexoesMock = vi.fn<(companyId: string) => Promise<ConexaoApresentada[]>>();
vi.mock("@/core/conexoes/service", () => ({
  listarConexoes: (companyId: string) => listarConexoesMock(companyId),
  criarConexao: vi.fn(),
  substituirSegredo: vi.fn(),
  atualizarConexao: vi.fn(),
  definirAtiva: vi.fn(),
  regenerarWebhookToken: vi.fn(),
  apagarConexao: vi.fn(),
  ConexaoInvalidaError: class extends Error {},
}));

// As Server Actions são mockadas porque os componentes de cliente as importam
// no topo. Sem isto, o import arrastaria `service.ts` → `@/lib/prisma` para o
// jsdom — mesmo motivo do mock acima, e o mesmo que `fluxos-pages-gate.test.tsx`
// faz com `@/modules/automation/actions`.
vi.mock("@/core/conexoes/actions", () => ({
  criarConexaoAction: vi.fn(),
  substituirSegredoAction: vi.fn(),
  atualizarConexaoAction: vi.fn(),
  definirAtivaAction: vi.fn(),
  regenerarWebhookAction: vi.fn(),
  apagarConexaoAction: vi.fn(),
}));

const { default: ConexoesPage } = await import(
  "../../src/app/(painel)/configuracoes/conexoes/page"
);
const { default: ConfiguracoesPage } = await import("../../src/app/(painel)/configuracoes/page");
const { default: ConfiguracoesLayout } = await import(
  "../../src/app/(painel)/configuracoes/layout"
);

/**
 * `UsuarioAtivo` e não a forma do `User` do Prisma — `User` não tem
 * `companyId`, e uma fixture com aquela forma deixaria a página chamar
 * `listarConexoes(undefined)` com o caso continuando VERDE (o Vitest ignora
 * `undefined` ao comparar objeto parcial). O caso "recebe o `companyId` DA
 * SESSÃO" é o que morde, e só morde por causa desta anotação de tipo.
 */
const EMPRESA = "cmp_configuracoes";
const ADMIN: UsuarioAtivo = {
  id: "usr_admin",
  nome: "Admin",
  email: "admin@teste.invalid",
  ativo: true,
  companyId: EMPRESA,
  papel: "ADMIN",
};
const GESTOR: UsuarioAtivo = { ...ADMIN, papel: "GESTOR" };
const VENDEDOR: UsuarioAtivo = { ...ADMIN, papel: "VENDEDOR" };

const CONEXAO: ConexaoApresentada = {
  id: "conn_1",
  canal: "EVOLUTION",
  nome: "Comercial",
  ativa: true,
  dominio: "https://evo.exemplo.com",
  instancia: "inst-1",
  mascara: "••••••••1a2b",
  segredoAtualizadoEm: new Date("2026-08-20T12:00:00Z"),
  segredoAtualizadoPor: "Admin",
};

beforeEach(() => {
  redirectMock.mockClear();
  usuarioAtualOuLoginMock.mockReset().mockResolvedValue(ADMIN);
  listarConexoesMock.mockReset().mockResolvedValue([CONEXAO]);
});

afterEach(() => {
  cleanup();
});

describe("/configuracoes — o redirecionamento para a primeira seção", () => {
  it("ADMIN vai para a seção de conexões", async () => {
    await expect(ConfiguracoesPage()).rejects.toThrow("NEXT_REDIRECT:/configuracoes/conexoes");
    expect(redirectMock).toHaveBeenCalledWith("/configuracoes/conexoes");
  });

  it("GESTOR e VENDEDOR vão para o painel, não para uma seção", async () => {
    for (const usuario of [GESTOR, VENDEDOR]) {
      redirectMock.mockClear();
      usuarioAtualOuLoginMock.mockResolvedValue(usuario);
      await expect(ConfiguracoesPage()).rejects.toThrow("NEXT_REDIRECT:/");
      expect(redirectMock).toHaveBeenCalledWith("/");
      expect(redirectMock).not.toHaveBeenCalledWith("/configuracoes/conexoes");
    }
  });
});

describe("/configuracoes/conexoes — o portão de permissão", () => {
  it("GESTOR e VENDEDOR são recusados NO SERVIDOR, antes de qualquer leitura", async () => {
    for (const usuario of [GESTOR, VENDEDOR]) {
      listarConexoesMock.mockClear();
      usuarioAtualOuLoginMock.mockResolvedValue(usuario);

      await expect(ConexoesPage()).rejects.toThrow("NEXT_REDIRECT:/");
      // A leitura nem acontece: nome de instância e domínio da empresa não
      // chegam a ser buscados para alguém que não pode vê-los.
      expect(listarConexoesMock).not.toHaveBeenCalled();
    }
  });

  it("ADMIN vê a lista, e a leitura recebe o `companyId` DA SESSÃO", async () => {
    render(await ConexoesPage());

    expect(listarConexoesMock).toHaveBeenCalledWith(EMPRESA);
    expect(redirectMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cadastrar conexão" })).toBeTruthy();
    expect(screen.getByText("Comercial")).toBeTruthy();
  });

  it("a máscara renderizada é a que o SERVIDOR mandou, não uma derivada na tela", async () => {
    // O componente recebe `mascara` pronta e a imprime. Se algum dia alguém
    // trocar isso por um recorte feito no cliente, o valor real teria de
    // viajar até aqui — e este caso é o que registra que hoje não viaja.
    render(await ConexoesPage());

    expect(screen.getByTestId("mascara-conn_1").textContent).toBe("••••••••1a2b");
  });

  it("a tela vazia explica que não existe credencial padrão de ambiente", async () => {
    listarConexoesMock.mockResolvedValue([]);
    render(await ConexoesPage());

    expect(screen.getByText(/Nenhuma conexão cadastrada/)).toBeTruthy();
  });
});

describe("a régua de seções", () => {
  it("mostra Conexões para ADMIN", async () => {
    render(await ConfiguracoesLayout({ children: null }));
    expect(screen.getByRole("link", { name: "Conexões" })).toBeTruthy();
  });

  it("não mostra seção nenhuma para GESTOR nem VENDEDOR", async () => {
    for (const usuario of [GESTOR, VENDEDOR]) {
      usuarioAtualOuLoginMock.mockResolvedValue(usuario);
      render(await ConfiguracoesLayout({ children: null }));
      expect(screen.queryByRole("link", { name: "Conexões" })).toBeNull();
      // A régua inteira some, e não fica um `<nav>` vazio pendurado — mesmo
      // cuidado que `NavLinks` documenta para a linha entre grupos.
      expect(screen.queryByRole("navigation")).toBeNull();
      cleanup();
    }
  });
});
