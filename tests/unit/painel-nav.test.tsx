// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

// `config/client` é mockado para que o teste não dependa do que o fork atual
// tem ligado: se alguém mexer em `client.modulos`, estes casos continuam
// válidos.
//
// Mutável (via `vi.hoisted`, porque a fábrica de `vi.mock` é içada acima das
// declarações do arquivo) para que os dois lados da filtragem possam ser
// provados de verdade — antes de 2026-08-07 havia três links de módulo na
// nav, dois deles para rotas inexistentes, e o teste usava um módulo ligado e
// outro desligado. Com um único módulo de verdade (`whatsapp`), provar o caso
// "não aparece" exige trocar a lista entre um teste e outro; um mock fixo só
// conseguiria testar metade.
//
// `nome`/`marca` entraram junto com a reforma da barra lateral: `PainelNav`
// agora renderiza `<Marca />` (Task 5) duas vezes (aside e gaveta), e o
// componente lê `client.nome`/`client.marca.logo` — sem esses dois campos
// aqui, o render quebra com "Cannot read properties of undefined". Mesmo
// formato de `marca.test.tsx`, sem `logo` para cair no caminho de texto.
const mocks = vi.hoisted(() => ({ modulos: ["whatsapp"] as string[] }));

vi.mock("../../config/client", () => ({
  client: {
    get modulos() {
      return mocks.modulos;
    },
    nome: "AutoCenter",
    marca: { nome: "AutoCenter", corPrimaria: "#0F62FE", fonte: "Geist" },
  },
}));

// PainelNav (Task 19) agora renderiza <NotificationBell> como último item —
// um Client Component que importa `marcarNotificacaoComoLidaAction` de
// `@/core/notifications/actions` e chama `useRouter()` de "next/navigation".
// `actions.ts` importa `dispatch.ts` (que tem `import "server-only"`, mesmo
// padrão de `@/core/leads/actions` em `lead-note-form.test.tsx`) — sem
// mockar aqui, a importação quebraria fora do pipeline de build do Next
// (Vitest não aplica a condição de resolução "react-server" que faz
// "server-only" virar no-op). `useRouter()` sem mock lançaria por falta de
// contexto de App Router em jsdom puro (mesmo padrão de `task-list.test.tsx`).
vi.mock("@/core/notifications/actions", () => ({
  marcarNotificacaoComoLidaAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/",
}));

// O botão "Sair" usa uma Server Action de `@/core/auth/actions`, que importa
// `@/lib/auth` → `next-auth` → `next/server`. Esse último só resolve dentro
// do pipeline de build do Next; sob Vitest a importação quebraria antes de
// qualquer teste rodar (mesmo motivo do mock de `@/core/notifications/actions`
// acima). O que interessa aqui é que o botão esteja NA TELA — que ele desloga
// de verdade é provado no e2e, com sessão real.
vi.mock("@/core/auth/actions", () => ({
  sairAction: vi.fn(),
}));

const { PainelNav } = await import("../../src/components/painel-nav");

describe("PainelNav", () => {
  afterEach(() => {
    cleanup();
    // Restaura o padrão para não vazar o estado de um teste para o seguinte —
    // `mocks` é um objeto único compartilhado por todo o arquivo.
    mocks.modulos = ["whatsapp"];
  });

  it("mostra o link de um módulo ativo", () => {
    render(<PainelNav />);
    expect(screen.getByRole("link", { name: "Conversas" })).toBeTruthy();
  });

  it("não mostra o link de um módulo desligado", () => {
    mocks.modulos = [];
    render(<PainelNav />);
    expect(screen.queryByRole("link", { name: "Conversas" })).toBeNull();
  });

  // Guarda de regressão: `linksDeModulo` já teve entradas para `/catalogo` e
  // `/analytics`, rotas que nunca existiram — o link aparecia e a navegação
  // dava 404. Se alguém reintroduzir um link sem a rota, este teste avisa.
  it("não anuncia catálogo nem analytics, que não têm rota", () => {
    mocks.modulos = ["catalog", "analytics", "whatsapp"];
    render(<PainelNav />);
    expect(screen.queryByRole("link", { name: "Catálogo" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Analytics" })).toBeNull();
  });

  // "Equipe" (/usuarios) é filtrado por PAPEL, não por módulo: gestão de
  // usuários é núcleo, existe em todo fork. Esconder o link não é a defesa —
  // a página redireciona e cada Server Action checa a permissão — mas mostrar
  // a um VENDEDOR um link que só leva a um redirecionamento é ruído.
  it("mostra Equipe para ADMIN", () => {
    render(<PainelNav papelUsuario="ADMIN" />);
    expect(screen.getByRole("link", { name: "Equipe" })).toBeTruthy();
  });

  it("não mostra Equipe para GESTOR nem VENDEDOR", () => {
    render(<PainelNav papelUsuario="GESTOR" />);
    expect(screen.queryByRole("link", { name: "Equipe" })).toBeNull();
    cleanup();

    render(<PainelNav papelUsuario="VENDEDOR" />);
    expect(screen.queryByRole("link", { name: "Equipe" })).toBeNull();
  });

  it("omite Equipe quando o papel não é informado — padrão seguro", () => {
    render(<PainelNav />);
    expect(screen.queryByRole("link", { name: "Equipe" })).toBeNull();
  });

  it("sempre mostra os links fixos, independente dos módulos", () => {
    render(<PainelNav />);
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Leads" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Funil" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Contatos" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Tarefas" })).toBeTruthy();
  });

  it("mostra o botão de sair — sem ele não havia como encerrar a sessão pela interface", () => {
    render(<PainelNav />);
    const botao = screen.getByRole("button", { name: "Sair" });
    expect(botao).toBeTruthy();
    // Precisa ser submit de um <form> (POST via Server Action), não link:
    // um GET que desloga é acionável de fora por um simples <img src>.
    expect(botao.getAttribute("type")).toBe("submit");
    expect(botao.closest("form")).toBeTruthy();
  });

  it("mostra quem está logado quando o nome é informado", () => {
    render(<PainelNav nomeUsuario="Maria Vendedora" />);
    expect(screen.getByTestId("usuario-logado").textContent).toBe("Maria Vendedora");
  });

  it("não quebra quando o nome não é informado", () => {
    render(<PainelNav />);
    expect(screen.queryByTestId("usuario-logado")).toBeNull();
  });

  it("mostra o nome do usuario no rodape da barra", () => {
    render(<PainelNav nomeUsuario="Rodrigo" papelUsuario="ADMIN" />);
    expect(screen.getByTestId("usuario-logado").textContent).toContain("Rodrigo");
  });

  it("mantem o logout como form, nunca como link", () => {
    const { container } = render(<PainelNav nomeUsuario="Rodrigo" papelUsuario="ADMIN" />);
    // GET que desloga e disparavel por <img src> de qualquer site.
    expect(container.querySelector("form")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Sair/ })).toBeNull();
  });

  // A gaveta do celular é um `role="dialog"`. Sem nome acessível, o leitor de
  // tela anuncia só "diálogo" e quem não enxerga não sabe o que abriu — falha
  // WCAG 4.1.2. Achado dirigindo um navegador de verdade a 390x844; nenhuma
  // análise estática pega, porque o defeito é a AUSÊNCIA de um atributo.
  //
  // O nome fica invisível (`sr-only`) de propósito: a gaveta já mostra a
  // marca no topo, então repetir na tela seria ruído para quem enxerga.
  it("a gaveta do celular abre com nome acessivel, nao so como dialogo anonimo", async () => {
    render(<PainelNav nomeUsuario="Rodrigo" />);

    fireEvent.click(screen.getByRole("button", { name: "Abrir menu" }));

    const gaveta = await waitFor(() => {
      const el = document.querySelector('[data-slot="sheet-content"]');
      if (!el) throw new Error("gaveta nao abriu");
      return el as HTMLElement;
    });

    expect(gaveta.getAttribute("role")).toBe("dialog");

    // O nome pode chegar por `aria-label` ou por `aria-labelledby` apontando
    // para um elemento com texto. Aceita os dois: o que não pode é nenhum.
    const rotulo = gaveta.getAttribute("aria-label");
    const idDoRotulo = gaveta.getAttribute("aria-labelledby");
    const textoApontado = idDoRotulo
      ? document.getElementById(idDoRotulo)?.textContent?.trim()
      : undefined;

    expect(rotulo || textoApontado, "a gaveta abriu sem nome acessivel").toBeTruthy();
  });

  it("nao renderiza regua para VENDEDOR com o modulo desligado", () => {
    mocks.modulos = [];
    const { container } = render(<PainelNav nomeUsuario="Ana" papelUsuario="VENDEDOR" />);
    expect(container.querySelectorAll("hr")).toHaveLength(0);
  });
});
