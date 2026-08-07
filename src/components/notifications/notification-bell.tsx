"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bell } from "lucide-react";

import { marcarNotificacaoComoLidaAction } from "@/core/notifications/actions";
import { extrairPayloadNovoLead } from "@/core/notifications/types";
import {
  TIPO_CONVERSA_AGUARDANDO,
  extrairPayloadConversaAguardando,
} from "@/modules/whatsapp/notificacao-tipos";

export type NotificacaoNaoLida = {
  id: string;
  tipo: string;
  payload: unknown;
  criadoEm: Date;
};

/**
 * Traduz o que `marcarNotificacaoComoLidaAction` pode lançar numa mensagem
 * segura — mesmo padrão de `mensagemDeErroConcluir` (`tasks/task-list.tsx`,
 * Task 18). O caso central é "Notificação não encontrada" (checagem de dono
 * em `marcarComoLida`, `notifications/dispatch.ts`).
 */
function mensagemDeErroMarcarLida(erro: unknown): string {
  if (erro instanceof Error && erro.message === "Não autenticado") {
    return "Sua sessão expirou ou sua conta foi desativada. Atualize a página e faça login novamente.";
  }
  return "Não foi possível marcar como lida. Tente novamente em instantes.";
}

/**
 * Sino de notificações, item final de `PainelNav` (`painel-nav.tsx`).
 *
 * Client Component desde o início (diferente de `PainelNav`, que continua
 * síncrona) porque precisa de estado local para duas coisas que um Server
 * Component não resolve sozinho: abrir/fechar o painel de notificações, e
 * remover uma notificação da lista de forma OTIMISTA ao marcar como lida
 * (mesmo raciocínio de `useTaskList`, `tasks/task-list.tsx`, Task 18 — o
 * clique precisa parecer instantâneo, sem esperar o round-trip do servidor).
 *
 * `notificacoes` chega por PROP, já buscada no servidor — `(painel)/layout.tsx`
 * chama `listarNotificacoesNaoLidas(usuario.id)` (o mesmo `usuario` que já
 * resolveu para checar a sessão, sem uma segunda consulta a `User`) e repassa
 * o resultado para `PainelNav`, que repassa para este componente. Este
 * componente NUNCA importa `notifications/dispatch.ts` diretamente — esse
 * módulo tem `import "server-only"` (mesmo padrão de `leads/notes.ts`), e
 * qualquer import daqui a partir de um Client Component quebraria o build
 * com um erro explícito, não silenciosamente.
 *
 * Ressincroniza `notificacoes` (estado local) sempre que `iniciais` (a PROP)
 * muda — bug real encontrado ao verificar ao vivo contra o dev server: sem
 * isto, `useState(iniciais)` só lê o valor inicial UMA VEZ, no primeiro
 * mount. Criar um lead atualiza a contagem no banco e `criarLeadManual`
 * (`leads/actions.ts`) já chama `revalidatePath("/", "layout")` para
 * invalidar o cache do servidor, e `LeadForm` chama `router.refresh()` — mas
 * isso só faz o Next mesclar uma PROP nova no componente já montado; sem
 * ressincronizar o estado, o sino continuava mostrando a contagem antiga do
 * primeiro mount até um reload de página inteira (que remonta o componente
 * do zero). Mesmo padrão de "ajustar estado quando algo muda" de
 * `LeadNoteForm` (`leads/lead-note-form.tsx`, Task 17): compara a PROP com a
 * cópia da última vez que foi processada DURANTE a renderização (não dentro
 * de um Effect — `react-hooks/set-state-in-effect` é erro de lint neste
 * projeto) e, se mudou, sincroniza ali mesmo.
 */
export function NotificationBell({ notificacoes: iniciais }: { notificacoes: NotificacaoNaoLida[] }) {
  const router = useRouter();
  const [notificacoes, setNotificacoes] = useState(iniciais);
  const [iniciaisProcessadas, setIniciaisProcessadas] = useState(iniciais);
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (iniciais !== iniciaisProcessadas) {
    setIniciaisProcessadas(iniciais);
    setNotificacoes(iniciais);
  }

  async function marcarComoLida(id: string) {
    setErro(null);
    const anterior = notificacoes;
    // Remoção otimista: some da lista antes da confirmação do servidor.
    setNotificacoes((atual) => atual.filter((n) => n.id !== id));

    try {
      await marcarNotificacaoComoLidaAction(id);
      router.refresh();
    } catch (erroCapturado) {
      // Rollback: reinsere se o servidor rejeitou (ex.: id de outra pessoa,
      // ou já não existe mais — mesma checagem de dono de `concluirTask`).
      setNotificacoes(anterior);
      setErro(mensagemDeErroMarcarLida(erroCapturado));
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Notificações"
        aria-haspopup="true"
        aria-expanded={aberto}
        onClick={() => setAberto((atual) => !atual)}
        className="relative inline-flex size-8 items-center justify-center rounded-lg hover:bg-muted"
      >
        <Bell className="size-4" aria-hidden />
        {notificacoes.length > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] text-white">
            {notificacoes.length}
          </span>
        )}
      </button>

      {aberto && (
        <div
          role="region"
          aria-label="Notificações não lidas"
          className="absolute right-0 z-10 mt-2 w-80 rounded-md border bg-background p-2 shadow-lg"
        >
          {erro && (
            <p role="alert" className="mb-2 text-xs text-red-600">
              {erro}
            </p>
          )}

          {notificacoes.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">Nenhuma notificação nova.</p>
          ) : (
            <ul className="space-y-1">
              {notificacoes.map((notificacao) => {
                // `extrairPayloadNovoLead` devolve `null` tanto para um
                // payload malformado quanto para um lead que já foi apagado
                // desde a criação da notificação (o payload é uma cópia
                // congelada de `contatoNome`, então isso raramente acontece
                // — mas o link "Ver lead" abaixo pode dar 404 se o lead foi
                // removido depois; ver comentário em `notifications/types.ts`).
                const dadosNovoLead =
                  notificacao.tipo === "NOVO_LEAD" ? extrairPayloadNovoLead(notificacao.payload) : null;
                const dadosConversa =
                  notificacao.tipo === TIPO_CONVERSA_AGUARDANDO
                    ? extrairPayloadConversaAguardando(notificacao.payload)
                    : null;

                return (
                  <li
                    key={notificacao.id}
                    className="flex items-start justify-between gap-2 rounded p-2 text-sm hover:bg-muted"
                  >
                    <div>
                      {dadosNovoLead ? (
                        <>
                          <p>Novo lead: {dadosNovoLead.contatoNome}</p>
                          <Link
                            href={`/leads/${dadosNovoLead.leadId}`}
                            className="text-xs text-primary underline"
                            onClick={() => setAberto(false)}
                          >
                            Ver lead
                          </Link>
                        </>
                      ) : dadosConversa ? (
                        <>
                          <p>Conversa aguardando: {dadosConversa.nomeExibicao}</p>
                          <Link
                            href={`/conversas/${dadosConversa.conversationId}`}
                            className="text-xs text-primary underline"
                            onClick={() => setAberto(false)}
                          >
                            Ver conversa
                          </Link>
                        </>
                      ) : (
                        <p>Notificação</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => marcarComoLida(notificacao.id)}
                      className="shrink-0 text-xs text-muted-foreground underline"
                    >
                      Marcar como lida
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
