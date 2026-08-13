// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  marca: { nome: "AutoCenter", corPrimaria: "#0F62FE", fonte: "Geist" } as {
    nome: string;
    corPrimaria: string;
    fonte: string;
    logo?: { claro: string; escuro: string };
  },
}));

vi.mock("../../config/client", () => ({
  client: {
    get nome() {
      return mocks.marca.nome;
    },
    get marca() {
      return mocks.marca;
    },
  },
}));

import { Marca } from "@/components/marca";

afterEach(() => {
  cleanup();
  mocks.marca = { nome: "AutoCenter", corPrimaria: "#0F62FE", fonte: "Geist" };
});

describe("Marca", () => {
  it("sem logo, mostra o nome do cliente em texto", () => {
    render(<Marca />);
    expect(screen.getByText("AutoCenter")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("com logo, monta as duas artes e deixa o CSS escolher", () => {
    mocks.marca = {
      ...mocks.marca,
      logo: { claro: "/logo-preto.svg", escuro: "/logo-branco.svg" },
    };
    const { container } = render(<Marca />);

    // As DUAS ficam no DOM: quem esconde uma é a variante `dark:` do
    // Tailwind, que roda junto com o resto do tema. Trocar `src` por
    // JavaScript pediria componente de cliente e traria o logo errado no
    // primeiro quadro — o mesmo tipo de defeito que o `aria-label` do
    // alternador teve.
    const imgs = container.querySelectorAll("img");
    expect(imgs).toHaveLength(2);
    expect(imgs[0].getAttribute("src")).toBe("/logo-preto.svg");
    expect(imgs[1].getAttribute("src")).toBe("/logo-branco.svg");

    // A do tema claro some no escuro, e vice-versa. Sem estas classes as
    // duas apareceriam empilhadas, que é como este defeito se manifesta.
    expect(imgs[0].className).toContain("dark:hidden");
    expect(imgs[1].className).toContain("hidden");
    expect(imgs[1].className).toContain("dark:block");
  });

  it("com logo, a arte fica sozinha e carrega o nome no alt", () => {
    mocks.marca = {
      ...mocks.marca,
      logo: { claro: "/logo-preto.svg", escuro: "/logo-branco.svg" },
    };
    const { container } = render(<Marca />);

    // A barra mostra a marca DO CLIENTE, sem o nome repetido em texto ao
    // lado. Como a arte fica sozinha, ela é a única identificação: `alt`
    // vazio deixaria a barra anônima para quem usa leitor de tela.
    expect(container.textContent).toBe("");
    for (const img of container.querySelectorAll("img")) {
      expect(img.getAttribute("alt")).toBe("AutoCenter");
    }

    // Só a visível é anunciada — a escondida sai da árvore de
    // acessibilidade pelo `display:none` da variante `dark:`.
    expect(screen.getAllByRole("img")).toHaveLength(2);
  });
});
