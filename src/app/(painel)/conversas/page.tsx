import Link from "next/link";

import { exigirModulo } from "@/lib/module-gate";
import { listarConversas } from "@/modules/whatsapp/queries";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatarDataHoraBR } from "@/lib/date";

/**
 * Inbox de conversas do WhatsApp — Fatia 1, SÓ LEITURA (nenhuma ação de
 * mutação aqui: pausar/retomar bot, responder como humano e "criar lead a
 * partir da conversa" são Fatia 2). Segue os mesmos padrões visuais de
 * `(painel)/leads/page.tsx` (Task 16): tabela shadcn, `EmptyState` para
 * lista vazia, a mesma redação "Sem contato identificado" para relação
 * nula.
 *
 * `exigirModulo("whatsapp")` faz esta rota devolver 404 se algum fork
 * desligar o módulo em `config/client.ts` — mesma defesa em profundidade de
 * `moduloAtivo` em `painel-nav.tsx` (o link some do menu, mas digitar a URL
 * direto não pode contornar o gate).
 *
 * `(painel)/layout.tsx` já garante sessão válida antes de qualquer página
 * deste route group renderizar — não repetimos `usuarioAtual()` aqui
 * (mesma observação já feita em `leads/page.tsx`), porque esta página não
 * precisa saber QUEM está logado (sem formulário, sem responsável padrão).
 */
export default async function ConversasPage() {
  exigirModulo("whatsapp");

  const conversas = await listarConversas();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Conversas</h1>
        <p className="text-sm text-muted-foreground">
          Mensagens recebidas e respondidas pelo atendente de WhatsApp.
        </p>
      </div>

      {conversas.length === 0 ? (
        <EmptyState
          title="Nenhuma conversa ainda"
          description="Mensagens recebidas pelo WhatsApp da revenda vão aparecer aqui."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Contato</TableHead>
              <TableHead>Última mensagem</TableHead>
              <TableHead>Quando</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {conversas.map((conversa) => {
              const ultimaMensagem = conversa.mensagens[0];
              return (
                <TableRow key={conversa.id} className="cursor-pointer">
                  <TableCell>
                    <Link href={`/conversas/${conversa.id}`} className="block hover:underline">
                      <span className="font-medium">
                        {conversa.contact?.nome ?? conversa.nomeExibicao ?? "Sem contato identificado"}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground">
                    {ultimaMensagem ? (
                      <>
                        {ultimaMensagem.direcao === "SAIDA" && (
                          <Badge variant="secondary" className="mr-1">
                            {ultimaMensagem.autor === "HUMANO" ? "Você" : "IA"}
                          </Badge>
                        )}
                        {resumoConteudo(ultimaMensagem.tipo, ultimaMensagem.texto)}
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {ultimaMensagem ? formatarDataHoraBR(ultimaMensagem.criadoEm) : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

/**
 * Mesma ideia de fallback de `turno.ts` (`FALLBACK_MIDIA_NAO_SUPORTADA`),
 * mas para EXIBIÇÃO na inbox em vez de resposta ao cliente: uma mensagem de
 * mídia sem texto não pode aparecer como prévia vazia.
 */
function resumoConteudo(tipo: string, texto: string | null): string {
  if (texto && texto.trim().length > 0) return texto;
  const rotulos: Record<string, string> = {
    AUDIO: "[Áudio]",
    IMAGEM: "[Imagem]",
    DOCUMENTO: "[Documento]",
    STICKER: "[Figurinha]",
    OUTRO: "[Mensagem não suportada]",
  };
  return rotulos[tipo] ?? "[Mensagem não suportada]";
}
