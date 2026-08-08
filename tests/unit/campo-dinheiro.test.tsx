// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import { CampoDinheiro } from "../../src/components/leads/campo-dinheiro";

// `vitest.config.ts` não liga `globals`, então o RTL não registra a limpeza
// automática. Sem isto os `render` se acumulam no mesmo document e, como o
// input tem `id` fixo, o `getByLabelText` do segundo teste devolveria o
// campo renderizado pelo primeiro — o mock novo nunca seria chamado.
afterEach(cleanup);

describe("CampoDinheiro", () => {
  it("monta o valor pela direita conforme digita", () => {
    const aoMudar = vi.fn();
    render(<CampoDinheiro value="" onChange={aoMudar} label="Valor estimado" />);

    const campo = screen.getByLabelText("Valor estimado");
    fireEvent.change(campo, { target: { value: "150050" } });

    expect(aoMudar).toHaveBeenCalledWith("1.500,50");
  });

  it("ignora o que nao e algarismo", () => {
    const aoMudar = vi.fn();
    render(<CampoDinheiro value="" onChange={aoMudar} label="Valor estimado" />);

    fireEvent.change(screen.getByLabelText("Valor estimado"), {
      target: { value: "abc150abc" },
    });

    expect(aoMudar).toHaveBeenCalledWith("1,50");
  });

  it("usa inputMode numerico para abrir o teclado certo no celular", () => {
    render(<CampoDinheiro value="" onChange={vi.fn()} label="Valor estimado" />);
    expect(screen.getByLabelText("Valor estimado").getAttribute("inputmode")).toBe("numeric");
  });

  // Apagar tudo precisa chegar como string vazia ao formulário — é assim que
  // "limpar o valor" vira `null` no banco. Se a máscara devolvesse "0,00", o
  // campo nunca poderia ser esvaziado.
  it("apagar tudo devolve string vazia, nao zero", () => {
    const aoMudar = vi.fn();
    render(<CampoDinheiro value="1.500,50" onChange={aoMudar} label="Valor estimado" />);

    fireEvent.change(screen.getByLabelText("Valor estimado"), { target: { value: "" } });

    expect(aoMudar).toHaveBeenCalledWith("");
  });
});
