// @vitest-environment jsdom
//
// Cobre a extensão `exigirDigitar` do `ConfirmarDialogo` (Task 5, Ciclo 4):
// a comparação precisa ser EXATA — sem `trim`, sem ignorar caixa — porque
// metade do valor da proteção está em obrigar a LER o nome do fluxo para
// reproduzi-lo, não em aceitar qualquer coisa parecida.
//
// Adaptado do brief em dois pontos, pelos mesmos motivos já documentados em
// `fluxos-table.test.tsx` (achados da Task 4):
// 1. `@testing-library/user-event` NÃO está instalado neste projeto —
//    confirmado em `node_modules/@testing-library` (só existem `dom/` e
//    `react/`) e em `package.json`. Nenhum outro teste da suíte o importa.
//    Uso `fireEvent` no lugar, mesmo padrão de `etapas-table.test.tsx` e
//    `lead-note-form.test.tsx`.
// 2. `toBeInTheDocument`/`toBeDisabled` (jest-dom) também não estão
//    instalados. Uso `toBeTruthy()`/`toBeNull()` e leitura direta de
//    `.disabled`, mesmo padrão de `etapas-table.test.tsx:129`.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

import { ConfirmarDialogo } from "../../src/components/confirmar-dialogo";

afterEach(() => {
  cleanup();
});

function montar(onConfirmar = vi.fn()) {
  render(
    <ConfirmarDialogo
      gatilho={(abrir) => <button onClick={abrir}>abrir</button>}
      titulo="Apagar Noiva Inteligente?"
      descricao="Isso não tem volta."
      exigirDigitar="Noiva Inteligente"
      rotuloConfirmar="Apagar"
      rotuloConfirmando="Apagando…"
      onConfirmar={onConfirmar}
    />
  );
  return onConfirmar;
}

describe("ConfirmarDialogo com exigirDigitar", () => {
  it("comeca com o botao de confirmar desabilitado", () => {
    montar();
    fireEvent.click(screen.getByText("abrir"));

    const botao = screen.getByRole("button", { name: "Apagar" }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
  });

  it("texto parecido mas diferente NAO habilita", () => {
    montar();
    fireEvent.click(screen.getByText("abrir"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "noiva inteligente" } });

    const botao = screen.getByRole("button", { name: "Apagar" }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
  });

  it("texto exato habilita e confirma", async () => {
    const onConfirmar = montar();
    fireEvent.click(screen.getByText("abrir"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Noiva Inteligente" } });

    const botao = screen.getByRole("button", { name: "Apagar" }) as HTMLButtonElement;
    expect(botao.disabled).toBe(false);
    fireEvent.click(botao);

    await waitFor(() => expect(onConfirmar).toHaveBeenCalledTimes(1));
  });

  it("sem exigirDigitar, o dialogo continua funcionando como antes", async () => {
    const onConfirmar = vi.fn();
    render(
      <ConfirmarDialogo
        gatilho={(abrir) => <button onClick={abrir}>abrir</button>}
        titulo="Remover?"
        descricao="…"
        rotuloConfirmar="Remover"
        rotuloConfirmando="Removendo…"
        onConfirmar={onConfirmar}
      />
    );
    fireEvent.click(screen.getByText("abrir"));

    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remover" }));

    await waitFor(() => expect(onConfirmar).toHaveBeenCalledTimes(1));
  });
});
