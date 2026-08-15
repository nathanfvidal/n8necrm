// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

// O estado de navegação vem do Next; aqui ele é a entrada do componente.
// `next/link` inteiro mockado porque `useLinkStatus` sai desse módulo e, fora
// de um `<Link>` de verdade, o hook real não tem contexto para ler.
const mocks = vi.hoisted(() => ({ pending: false }));
vi.mock("next/link", () => ({
  useLinkStatus: () => ({ pending: mocks.pending }),
}));

import { IndicadorDeLink } from "@/components/indicador-de-link";

afterEach(() => {
  cleanup();
  mocks.pending = false;
});

function pista(container: HTMLElement) {
  const elemento = container.querySelector(".pista-de-link");
  if (!elemento) throw new Error("o indicador não renderizou");
  return elemento;
}

describe("IndicadorDeLink", () => {
  // Parado, ele NÃO pode sumir do documento: o espaço tem que ficar
  // reservado, senão o item de menu muda de largura na hora do clique — o
  // layout shift que o doc do `useLinkStatus` alerta. Quem esconde é o CSS
  // (`visibility: hidden`), não a ausência do elemento.
  it("continua no documento quando não há navegação em curso", () => {
    const { container } = render(<IndicadorDeLink />);
    expect(pista(container).className).toBe("pista-de-link");
  });

  it("ganha a classe `pendente` enquanto a navegação está a caminho", () => {
    mocks.pending = true;
    const { container } = render(<IndicadorDeLink />);
    expect(pista(container).className).toContain("pendente");
  });

  // Decoração pura: quem usa leitor de tela já ouve a mudança de página.
  // Um ponto anunciado a cada item de menu seria ruído. Ver o comentário do
  // componente sobre o que este atributo protege de verdade.
  it("é invisível para leitor de tela nos dois estados", () => {
    const { container: parado } = render(<IndicadorDeLink />);
    expect(pista(parado).getAttribute("aria-hidden")).toBe("true");
    cleanup();

    mocks.pending = true;
    const { container: navegando } = render(<IndicadorDeLink />);
    expect(pista(navegando).getAttribute("aria-hidden")).toBe("true");
  });

  // Posicionamento e animação vivem em `globals.css`. Uma prop `style` aqui
  // seria a segunda `style` inline do projeto e tiraria de cima da mesa a
  // possibilidade de endurecer o `style-src` do CSP com uma mudança só.
  it("não escreve style inline", () => {
    mocks.pending = true;
    const { container } = render(<IndicadorDeLink />);
    expect(pista(container).getAttribute("style")).toBeNull();
  });
});
