// @vitest-environment jsdom
//
// Cobre só a lógica de ramificação do client component (mesma instrução das
// Tasks 15/16/18 para os outros testes de componente): marcar como lida
// remove a notificação da lista (otimista) e atualiza a contagem do sino, e
// rollback + mensagem de erro quando o servidor rejeita (checagem de dono em
// `marcarComoLida`, `notifications/dispatch.ts`).
//
// A tradução de `Notification` (tipo + payload cru) para o que se vê na tela
// saiu daqui: mora em `app/(painel)/apresentar-notificacoes.ts` e tem teste
// próprio (`apresentar-notificacoes.test.ts`). Este componente agora recebe
// texto e link já prontos e não conhece tipo nenhum — foi assim que o
// acoplamento com `modules/whatsapp` saiu do sino.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const marcarNotificacaoComoLidaActionMock = vi.fn();
vi.mock("@/core/notifications/actions", () => ({
  marcarNotificacaoComoLidaAction: (...args: unknown[]) => marcarNotificacaoComoLidaActionMock(...args),
}));

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

const { NotificationBell } = await import("../../src/components/notifications/notification-bell");

const NOTIFICACOES_TESTE = [
  { id: "notif-1", titulo: "Novo lead: Carlos Silva", href: "/leads/lead-1", textoLink: "Ver lead" },
  { id: "notif-2", titulo: "Novo lead: Fernanda Lima", href: "/leads/lead-2", textoLink: "Ver lead" },
];

afterEach(() => {
  cleanup();
  marcarNotificacaoComoLidaActionMock.mockReset();
  refreshMock.mockReset();
});

describe("NotificationBell", () => {
  it("mostra a contagem de notificações não lidas no sino", () => {
    render(<NotificationBell notificacoes={NOTIFICACOES_TESTE} />);
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("sem notificações: o sino não mostra nenhuma contagem", () => {
    render(<NotificationBell notificacoes={[]} />);
    expect(screen.queryByText("0")).toBeNull();
  });

  it("clicar no sino abre o painel com as notificações não lidas", () => {
    render(<NotificationBell notificacoes={NOTIFICACOES_TESTE} />);
    fireEvent.click(screen.getByRole("button", { name: "Notificações" }));
    expect(screen.getByText(/Carlos Silva/)).toBeTruthy();
    expect(screen.getByText(/Fernanda Lima/)).toBeTruthy();
  });

  it(
    "marcar como lida com sucesso: remove a notificação da lista (otimista), atualiza a " +
      "contagem e chama router.refresh()",
    async () => {
      marcarNotificacaoComoLidaActionMock.mockResolvedValue(undefined);
      render(<NotificationBell notificacoes={NOTIFICACOES_TESTE} />);
      fireEvent.click(screen.getByRole("button", { name: "Notificações" }));

      fireEvent.click(screen.getAllByRole("button", { name: "Marcar como lida" })[0]);

      await waitFor(() => expect(screen.queryByText(/Carlos Silva/)).toBeNull());
      expect(screen.getByText(/Fernanda Lima/)).toBeTruthy();
      expect(screen.getByText("1")).toBeTruthy();
      expect(marcarNotificacaoComoLidaActionMock).toHaveBeenCalledWith("notif-1");
      await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    }
  );

  it(
    "marcar como lida rejeitada pelo servidor (checagem de dono, notificação de outra pessoa " +
      "ou já lida): reinsere a notificação (rollback) e mostra mensagem de erro, sem chamar router.refresh()",
    async () => {
      marcarNotificacaoComoLidaActionMock.mockRejectedValue(new Error("Notificação não encontrada"));
      render(<NotificationBell notificacoes={NOTIFICACOES_TESTE} />);
      fireEvent.click(screen.getByRole("button", { name: "Notificações" }));

      fireEvent.click(screen.getAllByRole("button", { name: "Marcar como lida" })[0]);

      await waitFor(() => {
        expect(screen.getByRole("alert").textContent).toMatch(/Não foi possível marcar como lida/);
      });
      expect(screen.getByText(/Carlos Silva/)).toBeTruthy();
      expect(screen.getByText("2")).toBeTruthy();
      expect(refreshMock).not.toHaveBeenCalled();
    }
  );

  // Sem `href`/`textoLink` — o caso que `apresentarNotificacoes` produz para
  // payload malformado ou tipo desconhecido — nenhum link é desenhado, e o
  // componente não quebra tentando montar uma rota a partir de `undefined`.
  it("notificacao sem link renderiza so o titulo, sem <a>", () => {
    render(<NotificationBell notificacoes={[{ id: "notif-3", titulo: "Notificação" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Notificações" }));

    expect(screen.getByText("Notificação")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  // Detalhe e destaque só existem para o alerta de atividade — o único aviso
  // que pede atenção imediata em vez de sinalizar trabalho de rotina.
  it("notificacao com detalhe e destaque mostra as duas linhas", () => {
    render(
      <NotificationBell
        notificacoes={[
          {
            id: "notif-6",
            titulo: "Atividade incomum",
            detalhe: "Fulano fez 12 ações destrutivas em 5 minutos.",
            href: "/",
            textoLink: "Ver atividade recente",
            destaque: true,
          },
        ]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Notificações" }));

    expect(screen.getByText("Atividade incomum")).toBeTruthy();
    expect(screen.getByText("Fulano fez 12 ações destrutivas em 5 minutos.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ver atividade recente" })).toBeTruthy();
  });

  it(
    "ressincroniza com a lista quando o servidor manda uma PROP nova (router.refresh() após criar " +
      "lead, sem remount) — bug real: useState(iniciais) só lê o valor inicial na primeira montagem, " +
      "então sem a ressincronização o sino ficaria travado na contagem do primeiro carregamento",
    () => {
      const { rerender } = render(<NotificationBell notificacoes={NOTIFICACOES_TESTE} />);
      expect(screen.getByText("2")).toBeTruthy();

      const comMaisUma = [
        ...NOTIFICACOES_TESTE,
        {
          id: "notif-5",
          titulo: "Novo lead: Lead Novíssimo",
          href: "/leads/lead-5",
          textoLink: "Ver lead",
        },
      ];
      rerender(<NotificationBell notificacoes={comMaisUma} />);

      expect(screen.getByText("3")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Notificações" }));
      expect(screen.getByText(/Lead Novíssimo/)).toBeTruthy();
    }
  );
});
