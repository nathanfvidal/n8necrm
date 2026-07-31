// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const signInMock = vi.fn();
const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => signInMock(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

// Importado após os mocks acima, para que o componente use os stubs.
const { default: LoginPage } = await import("../../src/app/(painel)/login/page");

describe("LoginPage", () => {
  beforeEach(() => {
    signInMock.mockReset();
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  async function preencherESubmeter() {
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText("E-mail"), {
      target: { value: "usuario@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Senha"), {
      target: { value: "qualquer-senha" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
  }

  it("trata resultado undefined do signIn (fetch de providers falhou) como falha, não sucesso", async () => {
    // Reproduz o comportamento real de next-auth/react quando `getProviders()`
    // falha: `signIn()` resolve para `undefined` em vez de um objeto com `.error`.
    signInMock.mockResolvedValueOnce(undefined);

    await preencherESubmeter();

    await waitFor(() => {
      expect(screen.getByText("E-mail ou senha inválidos.")).toBeTruthy();
    });
    expect(pushMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("trata credenciais inválidas normais (CredentialsSignin) como falha, com a mesma mensagem genérica", async () => {
    signInMock.mockResolvedValueOnce({
      error: "CredentialsSignin",
      code: undefined,
      status: 401,
      ok: false,
      url: null,
    });

    await preencherESubmeter();

    await waitFor(() => {
      expect(screen.getByText("E-mail ou senha inválidos.")).toBeTruthy();
    });
    expect(pushMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("navega para a home em caso de sucesso real (sem regressão)", async () => {
    signInMock.mockResolvedValueOnce({
      error: undefined,
      code: undefined,
      status: 200,
      ok: true,
      url: "/",
    });

    await preencherESubmeter();

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/");
    });
    expect(refreshMock).toHaveBeenCalled();
    expect(screen.queryByText("E-mail ou senha inválidos.")).toBeNull();
  });
});
