"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bell } from "lucide-react";

import { marcarNotificacaoComoLidaAction } from "@/core/notifications/actions";
import { registrarFalhaDeRede } from "@/lib/acao";

/**
 * O que o sino precisa para desenhar uma linha — e nada além disso.
 *
 * Este componente NÃO conhece tipo de notificação. Antes conhecia: importava
 * `core/notifications/types` E `modules/whatsapp/notificacao-tipos`, e assim um
 * componente presente em toda tela do painel dependia de um módulo OPCIONAL do
 * produto (risco registrado na auditoria). A tradução de `Notification` para
 * esta forma mora em `app/(painel)/apresentar-notificacoes.ts`, a raiz de
 * composição — leia o comentário de lá para o raciocínio completo.
 *
 * O ganho prático: tipo novo de notificação não abre este arquivo, e um fork
 * que remova o módulo de WhatsApp também não.
 */
export type NotificacaoApresentada = {
  id: string;
  titulo: string;
  /** Segunda linha, opcional. Hoje só o alerta de atividade usa. */
  detalhe?: string;
  href?: string;
  /** Rótulo do link. Sem ele (ou sem `href`), nenhum link é renderizado. */
  textoLink?: string;
  /** Aviso que pede atenção imediata, não trabalho de rotina. */
  destaque?: boolean;
};

/**
 * Rede de segurança para a falha que NÃO chega como `{ ok: false }`.
 *
 * Substituiu um `mensagemDeErroMarcarLida` que comparava `erro.message` com
 * "Não autenticado" — texto do servidor, casado por string aqui. A frase mora
 * agora em `core/notifications/actions.ts`, junto com a de "notificação não
 * encontrada", que este componente nunca chegou a traduzir: a checagem de dono
 * em `marcarComoLida` produzia esse erro e o sino mostrava o genérico.
 *
 * O que sobra é o transporte: a action promete não lançar, a rede não promete
 * nada.
 */
function mensagemDeFalhaDeRede(erro: unknown): string {
  return registrarFalhaDeRede("Falha ao marcar notificação como lida", erro);
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
 * mount. Criar um lead atualiza a contagem no banco e `criarLeadManualAction`
 * (`leads/actions.ts`) já chama `revalidatePath("/(painel)", "layout")`, o
 * que invalida o cache do servidor e faz a resposta da própria action trazer
 * a árvore re-renderizada — mas isso só faz o Next mesclar uma PROP nova no
 * componente já montado; sem
 * ressincronizar o estado, o sino continuava mostrando a contagem antiga do
 * primeiro mount até um reload de página inteira (que remonta o componente
 * do zero). Mesmo padrão de "ajustar estado quando algo muda" de
 * `LeadNoteForm` (`leads/lead-note-form.tsx`, Task 17): compara a PROP com a
 * cópia da última vez que foi processada DURANTE a renderização (não dentro
 * de um Effect — `react-hooks/set-state-in-effect` é erro de lint neste
 * projeto) e, se mudou, sincroniza ali mesmo.
 */
export function NotificationBell({ notificacoes: iniciais }: { notificacoes: NotificacaoApresentada[] }) {
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

    // Rollback pelos DOIS caminhos: a recusa do servidor (id de outra pessoa,
    // ou que já não existe — mesma checagem de dono de `concluirTask`) chega
    // como `{ ok: false }`, e a falha de rede como exceção. Um sino que só
    // olhasse o `catch` deixaria a notificação sumida da lista sem ter sido
    // marcada — ela reapareceria no próximo carregamento de página, o que é
    // pior que nunca ter sumido: parece que o sistema esqueceu.
    const desfazer = (mensagem: string) => {
      setNotificacoes(anterior);
      setErro(mensagem);
    };

    try {
      const resultado = await marcarNotificacaoComoLidaAction(id);
      if (!resultado.ok) {
        desfazer(resultado.erro);
        return;
      }
      router.refresh();
    } catch (erroCapturado) {
      desfazer(mensagemDeFalhaDeRede(erroCapturado));
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
                return (
                  <li
                    key={notificacao.id}
                    className="flex items-start justify-between gap-2 rounded p-2 text-sm hover:bg-muted"
                  >
                    <div>
                      <p className={notificacao.destaque ? "font-medium text-red-600" : undefined}>
                        {notificacao.titulo}
                      </p>
                      {notificacao.detalhe && <p>{notificacao.detalhe}</p>}
                      {/* `prefetch={false}` no `<Link>` abaixo vale para TODO
                          `<Link>` do painel: a pré-busca leva o cookie de
                          sessão ao servidor e o Auth.js o reemite — o defeito
                          de logout de `0a81737` (AGENTS.md). O sino é o vizinho
                          mais próximo do botão "Sair" no cabeçalho. Cobrado por
                          `tests/unit/prefetch-do-painel.test.ts`. */}
                      {notificacao.href && notificacao.textoLink && (
                        <Link
                          href={notificacao.href}
                          prefetch={false}
                          className="text-xs text-primary underline"
                          onClick={() => setAberto(false)}
                        >
                          {notificacao.textoLink}
                        </Link>
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
