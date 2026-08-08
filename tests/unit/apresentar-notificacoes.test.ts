// Tradução de `Notification` (tipo + payload cru do banco) para o que o sino
// desenha.
//
// Esta lógica vivia DENTRO de `notification-bell.tsx`, que por isso importava
// `@/core/notifications/types` e `@/modules/whatsapp/notificacao-tipos` — um
// componente presente em toda tela do painel dependendo de um módulo opcional
// do produto (risco registrado na auditoria). Ela mudou para a raiz de
// composição, `app/(painel)/apresentar-notificacoes.ts`, e ganhou este teste
// próprio: função pura, sem React, sem banco.
//
// A cobertura que este arquivo herdou de `notification-bell-conversa.test.tsx`
// (removido, porque testava exatamente esta tradução através da UI): o aviso
// de conversa aguardando e a degradação com payload malformado.
import { describe, it, expect } from "vitest";

import { apresentarNotificacoes } from "../../src/app/(painel)/apresentar-notificacoes";

function apresentarUma(tipo: string, payload: unknown) {
  return apresentarNotificacoes([{ id: "n1", tipo, payload: payload as never }])[0];
}

describe("apresentarNotificacoes", () => {
  it("NOVO_LEAD vira titulo com o nome do contato e link para o lead", () => {
    const r = apresentarUma("NOVO_LEAD", { leadId: "lead-1", contatoNome: "Carlos Silva" });

    expect(r.titulo).toBe("Novo lead: Carlos Silva");
    expect(r.href).toBe("/leads/lead-1");
    expect(r.textoLink).toBe("Ver lead");
    expect(r.destaque).toBeUndefined();
  });

  it("CONVERSA_AGUARDANDO vira titulo com o nome e link para a conversa", () => {
    const r = apresentarUma("CONVERSA_AGUARDANDO", {
      conversationId: "c1",
      nomeExibicao: "Maria Souza",
    });

    expect(r.titulo).toBe("Conversa aguardando: Maria Souza");
    expect(r.href).toBe("/conversas/c1");
    expect(r.textoLink).toBe("Ver conversa");
  });

  it("ALERTA_ATIVIDADE traz detalhe e e' o unico com destaque", () => {
    const r = apresentarUma("ALERTA_ATIVIDADE", {
      autorNome: "Fulano",
      total: 12,
      janelaMinutos: 5,
    });

    expect(r.titulo).toBe("Atividade incomum");
    expect(r.detalhe).toBe("Fulano fez 12 ações destrutivas em 5 minutos.");
    expect(r.destaque).toBe(true);
  });

  // Degradação: nenhum destes pode lançar. O sino fica no cabeçalho de TODA
  // tela do painel — uma notificação estranha derrubando esta função levaria
  // o painel inteiro junto.
  describe("degradacao", () => {
    it("payload nulo cai no rotulo generico, sem link", () => {
      const r = apresentarUma("NOVO_LEAD", null);

      expect(r.titulo).toBe("Notificação");
      expect(r.href).toBeUndefined();
    });

    it("payload com formato errado cai no rotulo generico", () => {
      const r = apresentarUma("CONVERSA_AGUARDANDO", { foo: "bar" });

      expect(r.titulo).toBe("Notificação");
    });

    it("tipo desconhecido (versao futura, ou modulo removido) cai no rotulo generico", () => {
      const r = apresentarUma("TIPO_QUE_AINDA_NAO_EXISTE", { qualquer: "coisa" });

      expect(r.titulo).toBe("Notificação");
    });

    it("campo numerico chegando como string nao passa por valido", () => {
      const r = apresentarUma("ALERTA_ATIVIDADE", {
        autorNome: "Fulano",
        total: "12",
        janelaMinutos: 5,
      });

      expect(r.titulo).toBe("Notificação");
    });
  });

  it("preserva o id e a ordem da lista recebida", () => {
    const saida = apresentarNotificacoes([
      { id: "a", tipo: "NOVO_LEAD", payload: { leadId: "l1", contatoNome: "Um" } as never },
      { id: "b", tipo: "DESCONHECIDO", payload: null as never },
    ]);

    expect(saida.map((n) => n.id)).toEqual(["a", "b"]);
  });
});
