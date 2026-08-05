import { notFound } from "next/navigation";
import Link from "next/link";

import { exigirModulo } from "@/lib/module-gate";
import { buscarConversaComMensagens } from "@/modules/whatsapp/queries";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { formatarDataHoraBR } from "@/lib/date";
import { cn } from "@/lib/utils";

/**
 * Thread de uma conversa — Fatia 1, SÓ LEITURA (sem campo de resposta: essa
 * é a Fatia 2, "o humano assume"). Layout de bolhas simples (ENTRADA à
 * esquerda, SAIDA à direita), o suficiente para conferir o que o cliente
 * perguntou e o que o atendente de IA respondeu, sem construir um chat
 * completo para uma fatia que ainda não escreve mensagem nenhuma por aqui.
 */
export default async function ConversaDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  exigirModulo("whatsapp");

  const { id } = await params;
  const conversa = await buscarConversaComMensagens(id);

  if (!conversa) {
    notFound();
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link href="/conversas" className="text-sm text-muted-foreground hover:underline">
          ← Conversas
        </Link>
        <h1 className="text-xl font-semibold">
          {conversa.contact?.nome ?? conversa.nomeExibicao ?? "Sem contato identificado"}
        </h1>
        <p className="text-sm text-muted-foreground">{conversa.telefone ?? conversa.waId}</p>
      </div>

      {conversa.mensagens.length === 0 ? (
        <EmptyState
          title="Sem mensagens"
          description="Nenhuma mensagem registrada nesta conversa ainda."
        />
      ) : (
        <div className="space-y-3">
          {conversa.mensagens.map((mensagem) => {
            const deEntrada = mensagem.direcao === "ENTRADA";
            return (
              <div key={mensagem.id} className={cn("flex", deEntrada ? "justify-start" : "justify-end")}>
                <div
                  className={cn(
                    "max-w-md space-y-1 rounded-lg border p-3 text-sm",
                    deEntrada ? "bg-muted" : "bg-primary/10"
                  )}
                >
                  {!deEntrada && (
                    <Badge variant="secondary">{mensagem.autor === "HUMANO" ? "Você" : "IA"}</Badge>
                  )}
                  {/* Mesma justificativa de whitespace-pre-wrap/break-words de
                      leads/[id]/page.tsx: preserva quebras de linha reais e
                      evita que texto sem espaço (link colado etc.) estoure a
                      largura do balão. React escapa o conteúdo por padrão —
                      sem dangerouslySetInnerHTML em lugar nenhum. */}
                  <p className="whitespace-pre-wrap break-words">
                    {mensagem.texto ?? conteudoNaoSuportado(mensagem.tipo)}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatarDataHoraBR(mensagem.criadoEm)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function conteudoNaoSuportado(tipo: string): string {
  const rotulos: Record<string, string> = {
    AUDIO: "[Áudio recebido — ainda não processado nesta fase]",
    IMAGEM: "[Imagem recebida — ainda não processada nesta fase]",
    DOCUMENTO: "[Documento recebido — ainda não processado nesta fase]",
    STICKER: "[Figurinha recebida]",
    OUTRO: "[Mensagem de um tipo não suportado nesta fase]",
  };
  return rotulos[tipo] ?? "[Mensagem de um tipo não suportado nesta fase]";
}
