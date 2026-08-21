// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

// `config/client` NÃO é mais mockado aqui: desde o Ciclo 1c os módulos e o
// nome da marca chegam por PROP, vindos do banco por empresa. O mock existia
// para o teste não depender do que o fork tivesse ligado; a prop faz melhor,
// porque cada caso declara na própria linha o que está ligado — e não há mais
// objeto mutável compartilhado entre casos para alguém esquecer de restaurar.

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

/**
 * As duas props obrigatórias do Ciclo 1c em um lugar só. Cada caso sobrepõe o
 * que interessa a ele — antes isso era um objeto `mocks` mutável compartilhado
 * por todo o arquivo, com `afterEach` restaurando o padrão; um caso que
 * esquecesse de restaurar vazava para o seguinte.
 */
function montar(props: Partial<React.ComponentProps<typeof PainelNav>> = {}) {
  return render(<PainelNav modulosAtivos={["whatsapp"]} nomeMarca="AutoCenter" {...props} />);
}

describe("PainelNav", () => {
  afterEach(() => {
    cleanup();
  });

  it("mostra o link de um módulo ativo", () => {
    montar();
    expect(screen.getByRole("link", { name: "Conversas" })).toBeTruthy();
  });

  it("não mostra o link de um módulo desligado", () => {
    montar({ modulosAtivos: [] });
    expect(screen.queryByRole("link", { name: "Conversas" })).toBeNull();
  });

  // Guarda de regressão: `linksDeModulo` já teve entradas para `/catalogo` e
  // `/analytics`, rotas que nunca existiram — o link aparecia e a navegação
  // dava 404. Se alguém reintroduzir um link sem a rota, este teste avisa.
  it("não anuncia catálogo nem analytics, que não têm rota", () => {
    montar({ modulosAtivos: ["catalog", "analytics", "whatsapp"] });
    expect(screen.queryByRole("link", { name: "Catálogo" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Analytics" })).toBeNull();
  });

  // "Equipe" (/usuarios) é filtrado por PAPEL, não por módulo: gestão de
  // usuários é núcleo, existe em todo fork. Esconder o link não é a defesa —
  // a página redireciona e cada Server Action checa a permissão — mas mostrar
  // a um VENDEDOR um link que só leva a um redirecionamento é ruído.
  it("mostra Equipe para ADMIN", () => {
    montar({ papelUsuario: "ADMIN" });
    expect(screen.getByRole("link", { name: "Equipe" })).toBeTruthy();
  });

  it("não mostra Equipe para GESTOR nem VENDEDOR", () => {
    montar({ papelUsuario: "GESTOR" });
    expect(screen.queryByRole("link", { name: "Equipe" })).toBeNull();
    cleanup();

    montar({ papelUsuario: "VENDEDOR" });
    expect(screen.queryByRole("link", { name: "Equipe" })).toBeNull();
  });

  // "Configurações" (/configuracoes) é filtrado por PAPEL, como "Equipe":
  // administração é núcleo, existe em todo fork. Esconder o link não é a
  // defesa — a página redireciona e cada Server Action checa a permissão —
  // mas mostrar a um VENDEDOR um link que só leva a um redirecionamento é
  // ruído.
  it("mostra Configurações para ADMIN", () => {
    montar({ papelUsuario: "ADMIN" });
    expect(screen.getByRole("link", { name: "Configurações" })).toBeTruthy();
  });

  it("não mostra Configurações para GESTOR nem VENDEDOR", () => {
    montar({ papelUsuario: "GESTOR" });
    expect(screen.queryByRole("link", { name: "Configurações" })).toBeNull();
    cleanup();

    montar({ papelUsuario: "VENDEDOR" });
    expect(screen.queryByRole("link", { name: "Configurações" })).toBeNull();
  });

  it("aponta para `/configuracoes`, não para a seção — a URL do menu é estável", () => {
    // Direto em `/configuracoes/conexoes`, o item de menu teria de mudar no
    // dia da segunda seção. `/configuracoes` redireciona para a primeira que a
    // pessoa pode ver.
    montar({ papelUsuario: "ADMIN" });
    expect(screen.getByRole("link", { name: "Configurações" }).getAttribute("href")).toBe(
      "/configuracoes"
    );
  });

  it("omite Equipe quando o papel não é informado — padrão seguro", () => {
    montar();
    expect(screen.queryByRole("link", { name: "Equipe" })).toBeNull();
  });

  it("sempre mostra os links fixos, independente dos módulos", () => {
    montar();
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Leads" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Funil" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Contatos" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Tarefas" })).toBeTruthy();
  });

  it("mostra o botão de sair — sem ele não havia como encerrar a sessão pela interface", () => {
    montar();
    const botao = screen.getByRole("button", { name: "Sair" });
    expect(botao).toBeTruthy();
    // Precisa ser submit de um <form> (POST via Server Action), não link:
    // um GET que desloga é acionável de fora por um simples <img src>.
    expect(botao.getAttribute("type")).toBe("submit");
    expect(botao.closest("form")).toBeTruthy();
  });

  it("mostra quem está logado quando o nome é informado", () => {
    montar({ nomeUsuario: "Maria Vendedora" });
    expect(screen.getByTestId("usuario-logado").textContent).toBe("Maria Vendedora");
  });

  it("não quebra quando o nome não é informado", () => {
    montar();
    expect(screen.queryByTestId("usuario-logado")).toBeNull();
  });

  it("mostra o nome do usuario no rodape da barra", () => {
    montar({ nomeUsuario: "Rodrigo", papelUsuario: "ADMIN" });
    expect(screen.getByTestId("usuario-logado").textContent).toContain("Rodrigo");
  });

  it("mantem o logout como form, nunca como link", () => {
    const { container } = montar({ nomeUsuario: "Rodrigo", papelUsuario: "ADMIN" });
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
    montar({ nomeUsuario: "Rodrigo" });

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

  // A marca por PROP é comportamento novo do Ciclo 1c e sem este caso ninguém
  // cobre: um `nomeMarca` ignorado dentro do componente passaria por todos os
  // outros.
  it("mostra o nome da marca que RECEBEU, não um valor de arquivo", () => {
    // Duas ocorrências: o `<aside>` do desktop e a barra do celular renderizam
    // `<Marca />` cada um (ver o comentário de `conteudo` em painel-nav.tsx).
    montar({ nomeMarca: "Empresa da Sessao" });
    expect(screen.getAllByText("Empresa da Sessao")).toHaveLength(2);
  });

  it("nao renderiza regua para VENDEDOR com o modulo desligado", () => {
    const { container } = montar({ modulosAtivos: [], nomeUsuario: "Ana", papelUsuario: "VENDEDOR" });
    expect(container.querySelectorAll("hr")).toHaveLength(0);
  });
});
