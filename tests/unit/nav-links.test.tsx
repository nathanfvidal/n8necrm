// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ caminho: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.caminho }));

// `next/link` mockado para INSPECIONAR as props. `prefetch` não vira atributo
// no DOM, então sem isto não há como provar que a proteção está em todos os
// links — e a alternativa (um atributo espelho `data-prefetch`) colocaria
// artefato de teste no código de produção.
const linksRenderizados = vi.hoisted(() => [] as { href: string; prefetch: unknown }[]);
vi.mock("next/link", () => ({
  default: ({ href, prefetch, children, ...resto }: Record<string, unknown>) => {
    const props = { href, prefetch } as { href: string; prefetch: unknown };
    linksRenderizados.push(props);
    return <a href={props.href} {...(resto as object)}>{children as React.ReactNode}</a>;
  },
  // `useLinkStatus` sai do MESMO módulo que o `<Link>`, e o mock acima
  // substitui o módulo inteiro — sem esta linha, `IndicadorDeLink` (que a
  // nav renderiza dentro de cada link) importa `undefined` e a suíte quebra
  // no render, não numa asserção. `pending: false` é o estado parado, que é
  // o correto para todo teste daqui: nenhum deles navega.
  useLinkStatus: () => ({ pending: false }),
}));

import { NavLinks, type LinkDoPainel } from "@/components/nav-links";

const GRUPO_A: LinkDoPainel[] = [
  { href: "/", label: "Dashboard", icone: "dashboard" },
  { href: "/leads", label: "Leads", icone: "leads" },
  { href: "/leads/kanban", label: "Funil", icone: "funil" },
];

afterEach(() => {
  cleanup();
  mocks.caminho = "/";
  linksRenderizados.length = 0;
});

describe("NavLinks", () => {
  it("marca o item ativo com aria-current", () => {
    mocks.caminho = "/leads";
    render(<NavLinks grupos={[GRUPO_A]} />);
    expect(screen.getByRole("link", { name: /Leads/ }).getAttribute("aria-current")).toBe("page");
  });

  // A regra do href MAIS LONGO. Com `startsWith` simples, /leads e
  // /leads/kanban acendem os dois na página do kanban.
  it("acende só o href mais longo que casa", () => {
    mocks.caminho = "/leads/kanban";
    render(<NavLinks grupos={[GRUPO_A]} />);
    expect(screen.getByRole("link", { name: /Funil/ }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: /Leads/ }).getAttribute("aria-current")).toBeNull();
  });

  it("não deixa a raiz acender em toda rota", () => {
    mocks.caminho = "/contatos";
    render(<NavLinks grupos={[GRUPO_A]} />);
    expect(screen.getByRole("link", { name: /Dashboard/ }).getAttribute("aria-current")).toBeNull();
  });

  // Sem isto, "Sair" deixa de revogar sessão: o Next pré-carrega a rota
  // protegida, a resposta chega depois do logout e o Auth.js reemite o cookie.
  it("põe prefetch=false em TODOS os links", () => {
    render(<NavLinks grupos={[GRUPO_A]} />);
    expect(linksRenderizados).toHaveLength(3);
    for (const link of linksRenderizados) {
      expect(link.prefetch).toBe(false);
    }
  });

  // O e2e navega o painel inteiro por `getByRole("link", { name: "Leads",
  // exact: true })`. `IndicadorDeLink` mora DENTRO de cada `<Link>`, então
  // qualquer texto que apareça nele entra no nome acessível e derruba a
  // suíte inteira de uma vez — em specs que não têm nada a ver com a
  // navegação. Aqui a comparação é por igualdade exata, ao contrário dos
  // testes acima que usam regex: é justamente o que uma sobra de texto no
  // indicador quebraria.
  it("o nome acessível do link continua sendo só o rótulo", () => {
    render(<NavLinks grupos={[GRUPO_A]} />);
    for (const { label } of GRUPO_A) {
      const link = screen.getByRole("link", { name: label });
      expect(link.textContent?.trim()).toBe(label);
    }
  });

  it("não renderiza régua quando só há um grupo com conteúdo", () => {
    const { container } = render(<NavLinks grupos={[GRUPO_A, []]} />);
    expect(container.querySelectorAll("hr")).toHaveLength(0);
  });

  it("renderiza régua entre dois grupos com conteúdo", () => {
    const grupoB: LinkDoPainel[] = [{ href: "/usuarios", label: "Equipe", icone: "equipe" }];
    const { container } = render(<NavLinks grupos={[GRUPO_A, grupoB]} />);
    expect(container.querySelectorAll("hr")).toHaveLength(1);
  });
});
