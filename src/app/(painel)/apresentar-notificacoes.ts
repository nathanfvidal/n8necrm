import type { Notification } from "@prisma/client";

import {
  TIPO_ALERTA_ATIVIDADE,
  extrairPayloadAlertaAtividade,
  extrairPayloadNovoLead,
} from "@/core/notifications/types";
import {
  TIPO_CONVERSA_AGUARDANDO,
  extrairPayloadConversaAguardando,
} from "@/modules/whatsapp/notificacao-tipos";

import type { NotificacaoApresentada } from "@/components/notifications/notification-bell";

/**
 * Traduz `Notification` (linha crua do banco) para o que o sino renderiza.
 *
 * ## Por que este arquivo mora aqui, no diretório de rotas
 *
 * Risco corrigido (auditoria da fatia de conversa): o sino
 * (`components/notifications/notification-bell.tsx`) importava
 * `@/modules/whatsapp/notificacao-tipos` para saber renderizar o aviso de
 * conversa aguardando. Um componente compartilhado — presente em toda tela do
 * painel — passava a depender de um módulo OPCIONAL do produto. Um fork com o
 * WhatsApp desligado carregava a dependência assim mesmo, e cada tipo novo de
 * notificação exigiria abrir o sino de novo.
 *
 * A regra do projeto é que `src/core` nunca importa de `src/modules` (erro de
 * ESLint), justamente para o núcleo não depender do que é opcional. Só que a
 * regra não cobre `src/components`, e foi por essa brecha que o acoplamento
 * entrou. Este arquivo fecha a brecha pelo lado certo: `src/app` é a RAIZ DE
 * COMPOSIÇÃO — o lugar onde núcleo e módulos legitimamente se encontram para
 * montar a aplicação concreta. Quem conhece os dois é quem monta, não quem
 * desenha.
 *
 * Resultado: o sino não conhece tipo nenhum de notificação, e um fork que
 * remova o módulo de WhatsApp mexe só neste arquivo.
 *
 * ## Degradação
 *
 * Cada extrator devolve `null` para payload que não bate com o formato
 * esperado (ver os comentários em `core/notifications/types.ts`), e um `tipo`
 * desconhecido — de uma versão futura, ou de um módulo já removido — cai no
 * rótulo genérico. Nunca lança: uma notificação estranha não pode derrubar o
 * cabeçalho de todas as telas do painel.
 */
export function apresentarNotificacoes(
  notificacoes: Array<Pick<Notification, "id" | "tipo" | "payload">>
): NotificacaoApresentada[] {
  return notificacoes.map((notificacao) => {
    if (notificacao.tipo === "NOVO_LEAD") {
      const dados = extrairPayloadNovoLead(notificacao.payload);
      if (dados) {
        return {
          id: notificacao.id,
          titulo: `Novo lead: ${dados.contatoNome}`,
          href: `/leads/${dados.leadId}`,
          textoLink: "Ver lead",
        };
      }
    }

    if (notificacao.tipo === TIPO_CONVERSA_AGUARDANDO) {
      const dados = extrairPayloadConversaAguardando(notificacao.payload);
      if (dados) {
        return {
          id: notificacao.id,
          titulo: `Conversa aguardando: ${dados.nomeExibicao}`,
          href: `/conversas/${dados.conversationId}`,
          textoLink: "Ver conversa",
        };
      }
    }

    if (notificacao.tipo === TIPO_ALERTA_ATIVIDADE) {
      const dados = extrairPayloadAlertaAtividade(notificacao.payload);
      if (dados) {
        return {
          id: notificacao.id,
          titulo: "Atividade incomum",
          detalhe: `${dados.autorNome} fez ${dados.total} ações destrutivas em ${dados.janelaMinutos} minutos.`,
          href: "/",
          textoLink: "Ver atividade recente",
          // Único caso com destaque: os outros dois são avisos de trabalho a
          // fazer, este é possível sabotagem em curso.
          destaque: true,
        };
      }
    }

    return { id: notificacao.id, titulo: "Notificação" };
  });
}
