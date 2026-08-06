"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { pausarIaAction, religarIaAction } from "@/modules/whatsapp/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatarDataHoraBR } from "@/lib/date";

/**
 * Estado da IA na conversa, com o botão que inverte esse estado.
 *
 * Mostra QUEM pausou e QUANDO de propósito: sem isso, uma conversa muda é
 * indistinguível de um bug, e a primeira reação de quem vê é reabrir o código.
 *
 * Revisão final da fatia, achado I1: `turno.ts` decide se a IA responde
 * combinando DUAS condições (`!configBot.ativo || !conversaAtual.iaAtiva`) —
 * mas até aqui só a segunda (`iaAtiva`, por conversa) aparecia nesta tela.
 * Com o interruptor GLOBAL desligado e `iaAtiva` ainda `true` (o padrão de
 * toda conversa nova), o selo dizia "IA respondendo" e o botão "Pausar IA":
 * um vendedor lia isso e acreditava que o cliente estava sendo atendido,
 * quando na verdade ninguém responde a ninguém. `botAtivo` traz a mesma
 * checagem para a tela, sem inventar tela nova — o link "Configurar agente"
 * (na página pai, para quem tem permissão) já é onde o interruptor global se
 * liga de novo.
 */
export function ConversaEstadoIa({
  conversationId,
  iaAtiva,
  pausadaEm,
  pausadaPor,
  botAtivo,
}: {
  conversationId: string;
  iaAtiva: boolean;
  pausadaEm: Date | null;
  pausadaPor: string | null;
  botAtivo: boolean;
}) {
  const [processando, iniciar] = useTransition();
  const router = useRouter();

  const [erro, setErro] = useState<string | null>(null);

  function alternar() {
    setErro(null);
    iniciar(async () => {
      const resultado = await (iaAtiva
        ? pausarIaAction(conversationId)
        : religarIaAction(conversationId));
      if (!resultado.ok) {
        setErro(resultado.erro);
        return;
      }
      router.refresh();
    });
  }

  const iaRespondeDeFato = botAtivo && iaAtiva;
  const badgeTexto = !botAtivo ? "IA desligada (bot geral)" : iaAtiva ? "IA respondendo" : "IA pausada";

  return (
    <div className="flex items-center gap-3 rounded-md border p-3">
      <Badge variant={iaRespondeDeFato ? "default" : "secondary"}>{badgeTexto}</Badge>
      {!iaAtiva && pausadaEm && (
        <span className="text-xs text-muted-foreground">
          Pausada por {pausadaPor ?? "alguém"} em {formatarDataHoraBR(pausadaEm)}
        </span>
      )}
      {!botAtivo && (
        <span className="text-xs text-muted-foreground">
          O atendimento automático está desligado para toda a revenda — ligar aqui não muda isso.
        </span>
      )}
      {/* Desabilitado com o bot geral desligado: "Pausar IA" pausaria algo
          que já está calado, e "Religar IA" prometeria uma resposta que o
          interruptor global impede de sair — nenhum dos dois é uma ação
          honesta de mostrar aqui enquanto isso não muda em "Configurar agente". */}
      <Button variant="outline" size="sm" onClick={alternar} disabled={processando || !botAtivo}>
        {iaAtiva ? "Pausar IA" : "Religar IA"}
      </Button>
      {erro && (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      )}
    </div>
  );
}
