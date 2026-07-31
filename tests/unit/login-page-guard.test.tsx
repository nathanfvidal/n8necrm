// Unidade pura (sem DOM, sem Prisma) do Server Component de
// src/app/login/page.tsx — fix round 2/5. Prova a regra que impede o loop
// de redirecionamento encontrado ao verificar com HTTP real: quando
// usuarioAtual() rejeita (sessão ausente OU usuário desativado — fix round
// 1/5), a página NUNCA chama redirect(); ela só redireciona quando
// usuarioAtual() resolve de verdade. Se essa página redirecionasse com
// base em qualquer critério mais fraco (ex.: "existe cookie"), um usuário
// desativado cairia num loop infinito com (painel)/layout.tsx — reproduzido
// ao vivo contra o dev server antes deste fix (ver task-13-report.md).
import { describe, it, expect, vi, beforeEach } from "vitest";

const usuarioAtualMock = vi.fn();
vi.mock("@/core/auth/session", () => ({ usuarioAtual: () => usuarioAtualMock() }));

// redirect() de verdade lança um erro de controle de fluxo e nunca retorna
// — o mock reproduz exatamente isso, para que um bug que "engula" o erro
// dentro de um try/catch (o mesmo tipo de erro que a doc do Next.js avisa)
// apareça como o redirect "não acontecendo" de verdade num teste.
const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirectMock(url) }));

const { default: LoginPage } = await import("../../src/app/login/page");

describe("LoginPage (Server Component) — guarda que substituiu o bounce do proxy", () => {
  beforeEach(() => {
    usuarioAtualMock.mockReset();
    redirectMock.mockClear();
  });

  it("redireciona para '/' quando usuarioAtual() resolve (sessão válida e usuário ativo)", async () => {
    usuarioAtualMock.mockResolvedValue({ id: "u1", ativo: true });

    await expect(LoginPage()).rejects.toThrow("NEXT_REDIRECT:/");

    expect(redirectMock).toHaveBeenCalledWith("/");
    expect(redirectMock).toHaveBeenCalledTimes(1);
  });

  it(
    "NÃO redireciona (renderiza o formulário) quando usuarioAtual() rejeita — cobre tanto 'sem sessão' " +
      "quanto 'usuário desativado com cookie ainda válido', o caso que causava o loop com o proxy antigo",
    async () => {
      usuarioAtualMock.mockRejectedValue(new Error("Não autenticado"));

      const elemento = await LoginPage();

      expect(redirectMock).not.toHaveBeenCalled();
      expect(elemento).toBeTruthy();
    }
  );
});
