// @vitest-environment jsdom
//
// Cobre só a lógica de ramificação do client component (mesma instrução das
// Tasks 15/16/18 para os outros testes de componente): marcar como lida
// remove a notificação da lista (otimista) e atualiza a contagem do sino;
// rollback + mensagem de erro quando o servidor rejeita (checagem de dono em
// `marcarComoLida`, `notifications/dispatch.ts`, Task 19); e o fallback
// defensivo quando `payload` não tem o formato esperado de "NOVO_LEAD"
// (`extrairPayloadNovoLead`, `notifications/types.ts`) — o caso de um lead
// apagado depois da notificação (payload malformado/nulo) ou de um `tipo`
// futuro com outro formato de payload.
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
  {
    id: "notif-1",
    tipo: "NOVO_LEAD",
    payload: { leadId: "lead-1", contatoNome: "Carlos Silva" },
    criadoEm: new Date("2026-08-01T10:00:00.000Z"),
  },
  {
    id: "notif-2",
    tipo: "NOVO_LEAD",
    payload: { leadId: "lead-2", contatoNome: "Fernanda Lima" },
    criadoEm: new Date("2026-08-01T11:00:00.000Z"),
  },
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

  it(
    "payload sem o formato esperado de NOVO_LEAD (lead apagado desde a criação da notificação, " +
      "payload nulo, ou tipo futuro desconhecido): mostra fallback 'Notificação' em vez de quebrar",
    () => {
      render(
        <NotificationBell
          notificacoes={[
            { id: "notif-3", tipo: "NOVO_LEAD", payload: null, criadoEm: new Date("2026-08-01T00:00:00.000Z") },
            {
              id: "notif-4",
              tipo: "OUTRO_TIPO_FUTURO",
              payload: { leadId: "lead-9", contatoNome: "Alguém" },
              criadoEm: new Date("2026-08-01T00:00:00.000Z"),
            },
          ]}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: "Notificações" }));
      expect(screen.getAllByText("Notificação")).toHaveLength(2);
    }
  );

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
          tipo: "NOVO_LEAD",
          payload: { leadId: "lead-5", contatoNome: "Lead Novíssimo" },
          criadoEm: new Date("2026-08-01T12:00:00.000Z"),
        },
      ];
      rerender(<NotificationBell notificacoes={comMaisUma} />);

      expect(screen.getByText("3")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Notificações" }));
      expect(screen.getByText(/Lead Novíssimo/)).toBeTruthy();
    }
  );
});
