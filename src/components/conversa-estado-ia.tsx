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
 */
export function ConversaEstadoIa({
  conversationId,
  iaAtiva,
  pausadaEm,
  pausadaPor,
}: {
  conversationId: string;
  iaAtiva: boolean;
  pausadaEm: Date | null;
  pausadaPor: string | null;
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

  return (
    <div className="flex items-center gap-3 rounded-md border p-3">
      <Badge variant={iaAtiva ? "default" : "secondary"}>
        {iaAtiva ? "IA respondendo" : "IA pausada"}
      </Badge>
      {!iaAtiva && pausadaEm && (
        <span className="text-xs text-muted-foreground">
          Pausada por {pausadaPor ?? "alguém"} em {formatarDataHoraBR(pausadaEm)}
        </span>
      )}
      <Button variant="outline" size="sm" onClick={alternar} disabled={processando}>
        {iaAtiva ? "Pausar IA" : "Religar IA"}
      </Button>
      {erro && <p className="text-sm text-destructive">{erro}</p>}
    </div>
  );
}
