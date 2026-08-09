// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  marca: { nome: "AutoCenter", corPrimaria: "#0F62FE", fonte: "Geist" } as {
    nome: string;
    corPrimaria: string;
    fonte: string;
    logo?: string;
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
    expect(screen.getByText("AutoCenter")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("com logo, mostra a imagem com o nome como texto alternativo", () => {
    mocks.marca = { ...mocks.marca, logo: "/logo.svg" };
    render(<Marca />);
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "/logo.svg");
    expect(img).toHaveAttribute("alt", "AutoCenter");
  });
});
