import { notFound } from "next/navigation";
import Link from "next/link";

import { exigirModulo } from "@/lib/module-gate";
import { usuarioAtualOuLogin } from "@/core/auth/session";
import { hasPermission } from "@/core/auth/permissions";
import { buscarConversaComMensagens } from "@/modules/whatsapp/queries";
import { lerConfigBot } from "@/modules/whatsapp/agente";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { ConversaEstadoIa } from "@/components/conversa-estado-ia";
import { ConversaResponder } from "@/components/conversa-responder";
import { formatarDataHoraBR } from "@/lib/date";
import { cn } from "@/lib/utils";

/**
 * Thread de uma conversa — Fatia 2: o humano assume. Layout de bolhas
 * simples (ENTRADA à esquerda, SAIDA à direita), o suficiente para conferir
 * o que o cliente perguntou e o que o atendente de IA (ou o humano) respondeu,
 * com `ConversaEstadoIa` para pausar/religar a IA e `ConversaResponder` para
 * responder de verdade.
 */
export default async function ConversaDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  exigirModulo("whatsapp");

  const { id } = await params;
  // `usuarioAtual()` aqui não repete a checagem de sessão de `(painel)/layout.tsx`
  // (que já garante sessão válida antes de qualquer página deste route group
  // renderizar) — só lê o papel para decidir se mostra o link "Configurar
  // agente" (rodada de correção 1, achado M4: antes, o link aparecia para
  // todo mundo, e um VENDEDOR/GESTOR que clicasse caía num redirect de volta
  // pra cá em `/conversas/agente/page.tsx` — beco sem saída, não falha de
  // segurança, mas sem motivo para expor o link a quem não pode usá-lo).
  const usuario = await usuarioAtualOuLogin();
  const conversa = await buscarConversaComMensagens(usuario.companyId, id);

  if (!conversa) {
    notFound();
  }

  // Revisão final, achado I1: `ConversaEstadoIa` precisa do interruptor
  // GLOBAL, não só do estado desta conversa — ver o comentário no componente.
  const configBot = await lerConfigBot(usuario.companyId);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/conversas" className="text-sm text-muted-foreground hover:underline">
            ← Conversas
          </Link>
          <h1 className="text-xl font-semibold">
            {conversa.contact?.nome ?? conversa.nomeExibicao ?? "Sem contato identificado"}
          </h1>
          <p className="text-sm text-muted-foreground">{conversa.telefone ?? conversa.waId}</p>
        </div>
        {hasPermission(usuario.papel, "configurar_agente") && (
          <Link href="/conversas/agente" className="text-sm text-muted-foreground hover:underline">
            Configurar agente
          </Link>
        )}
      </div>

      <ConversaEstadoIa
        conversationId={conversa.id}
        iaAtiva={conversa.iaAtiva}
        pausadaEm={conversa.iaPausadaEm}
        pausadaPor={conversa.iaPausadaPor?.nome ?? null}
        botAtivo={configBot.ativo}
      />

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
                  {/* "Equipe", não "Você": `WhatsappMessage` não guarda QUAL humano
                      escreveu, e mais de um atendente usa a mesma inbox — "Você"
                      afirmaria um fato verificável e falso sempre que quem está
                      olhando a tela não foi quem mandou a mensagem (revisão final
                      da fatia, achado sem número). Registrar o autor de verdade é
                      decisão da próxima fatia (coluna nova + migração). */}
                  {!deEntrada && (
                    <Badge variant="secondary">{mensagem.autor === "HUMANO" ? "Equipe" : "IA"}</Badge>
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

      <ConversaResponder conversationId={conversa.id} />
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
