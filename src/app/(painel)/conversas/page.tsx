import Link from "next/link";

import { exigirModulo } from "@/core/config/modulos";
import { usuarioAtualOuLogin } from "@/core/auth/session";
import { listarConversas } from "@/modules/whatsapp/queries";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatarDataHoraBR, formatarDuracaoDesde } from "@/lib/date";

/**
 * Inbox de conversas do WhatsApp — esta tela continua SÓ LEITURA (pausar/
 * retomar bot e responder como humano ficam na tela de detalhe, Fatia 2,
 * Task 6). Segue os mesmos padrões visuais de `(painel)/leads/page.tsx`
 * (Task 16): tabela shadcn, `EmptyState` para lista vazia, a mesma redação
 * "Sem contato identificado" para relação nula.
 *
 * O selo "IA pausada" ao lado do nome do contato (Task 6) é o que evita uma
 * conversa pausada e esquecida: sem ele, o estado só aparecia depois de abrir
 * a conversa, e ninguém percebe que algo está esperando sem entrar em cada
 * linha para checar.
 *
 * O selo "Aguardando há Xh" (`Conversation.aguardandoHumanoDesde`, Task 1
 * desta fatia) é o mesmo raciocínio aplicado a QUANDO alguém precisa agir:
 * o sino (`NotificationBell`) avisa uma vez, no instante em que a espera
 * começa, mas some da tela ao ser marcado como lido — o selo aqui é visível
 * toda vez que a inbox é aberta, enquanto a espera durar. `variant="destructive"`
 * (mesmo componente do selo "IA pausada", variante diferente) porque este é
 * o único selo desta lista que pede AÇÃO, não só descreve um estado; na
 * prática o tom é discreto (fundo em baixa opacidade, ver `badge.tsx`), não
 * um vermelho sólido — não compete visualmente com "IA pausada" ao lado.
 *
 * `exigirModulo(usuario.companyId, "whatsapp")` faz esta rota devolver 404 se
 * a EMPRESA desta sessão não tiver o módulo ligado (`CompanyConfig.modulos`,
 * com `config/client.ts` como padrão quando não há linha) — mesma defesa em
 * profundidade de `modulosAtivos` em `painel-nav.tsx` (o link some do menu, mas
 * digitar a URL direto não pode contornar o portão). Roda DEPOIS de
 * `usuarioAtualOuLogin()` porque agora precisa saber de qual empresa é a
 * pergunta.
 *
 * `(painel)/layout.tsx` já garante sessão válida antes de qualquer página
 * deste route group renderizar, e esta página não usava `usuarioAtual()` por
 * não precisar saber QUEM está logado (sem formulário, sem responsável
 * padrão). O Ciclo 1d mudou isso: ela precisa saber em QUAL EMPRESA, que é
 * outra pergunta. `listarConversas` passou a exigir `companyId`, e a origem
 * é `usuarioAtualOuLogin().companyId` — enquanto não era, a inbox listava
 * conversa de todo cliente do banco.
 */
export default async function ConversasPage() {
  const usuario = await usuarioAtualOuLogin();
  await exigirModulo(usuario.companyId, "whatsapp");

  const conversas = await listarConversas(usuario.companyId);

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
                    <Link
                      href={`/conversas/${conversa.id}`}
                      className="flex items-center gap-2 hover:underline"
                    >
                      <span className="font-medium">
                        {conversa.contact?.nome ?? conversa.nomeExibicao ?? "Sem contato identificado"}
                      </span>
                      {!conversa.iaAtiva && <Badge variant="secondary">IA pausada</Badge>}
                      {conversa.aguardandoHumanoDesde && (
                        <Badge variant="destructive">
                          Aguardando há {formatarDuracaoDesde(conversa.aguardandoHumanoDesde)}
                        </Badge>
                      )}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground">
                    {ultimaMensagem ? (
                      <>
                        {/* "Equipe", não "Você" — ver o mesmo comentário em
                            `conversas/[id]/page.tsx`: `WhatsappMessage` não
                            guarda qual humano escreveu, e mais de um atendente
                            usa a mesma inbox. */}
                        {ultimaMensagem.direcao === "SAIDA" && (
                          <Badge variant="secondary" className="mr-1">
                            {ultimaMensagem.autor === "HUMANO" ? "Equipe" : "IA"}
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
