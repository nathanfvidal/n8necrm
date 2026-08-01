"use client";

import { useActionState, useState } from "react";

import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { adicionarNotaAction, type SalvarNotaState } from "@/core/leads/actions";

const estadoInicial: SalvarNotaState = { erro: null };

/**
 * Formulário de nota da página de detalhe do lead.
 *
 * Client Component só por causa de `useActionState` (fix round 1/5): uma
 * nota acima de `TEXTO_MAX_LENGTH` faz `adicionarNotaAction` devolver
 * `{ erro: "Nota muito longa: ..." }` em vez de lançar sem tratamento — mas
 * mostrar essa mensagem SEM perder o texto que a pessoa já digitou exige
 * estado no navegador. Um Server Component puro (a versão anterior desta
 * página) não tem onde guardar esse estado entre a submissão e a
 * re-renderização; a alternativa seria um redirect com o erro numa query
 * string, mas isso não preserva o texto digitado (e colocar o TEXTO da nota
 * numa URL seria expor dado potencialmente sensível de cliente onde não
 * deveria estar — logs de acesso, histórico do navegador).
 *
 * A autorização não muda: `adicionarNotaAction` (src/core/leads/actions.ts)
 * continua derivando o autor via `usuarioAtual()` no servidor, nunca deste
 * componente. `leadId` chega por prop e é passado à action via `.bind` —
 * não é segredo, já é público na URL da página.
 *
 * `<Textarea>` é CONTROLADO (`value`/`onChange` em `texto`, estado próprio
 * deste componente) de propósito, não uma escolha estética: React reseta
 * automaticamente os campos não-controlados de um `<form action={...}>`
 * sempre que a action termina sem lançar — e `adicionarNotaAction` retorna
 * normalmente mesmo no caso de erro (`{ erro: "..." }` é um retorno, não uma
 * exceção). Um campo não-controlado seria limpo nos dois casos (sucesso E
 * "nota muito longa"), exatamente o comportamento que este fix existe para
 * evitar.
 *
 * Limpar o campo quando `estado` muda: de propósito NÃO usa `useEffect`
 * (fix round 2/5, achado do revisor — `react-hooks/set-state-in-effect` é
 * erro de lint neste projeto: `setState` síncrono dentro de um Effect força
 * um ciclo extra de render/commit a cada submissão). Em vez disso, compara
 * `estado` com a cópia guardada em `estadoProcessado` DURANTE a
 * renderização e, se mudou, chama `setState` ali mesmo — o padrão
 * "ajustar estado quando algo muda" documentado em
 * react.dev/learn/you-might-not-need-an-effect#adjusting-state-when-a-prop-changes:
 * React re-renderiza imediatamente com o estado atualizado antes de pintar
 * a tela, sem o commit+Effect+re-commit extra, e sem disparar a regra de
 * lint (que mira especificamente `setState` dentro do corpo de um Effect,
 * não durante a renderização). A guarda `estado !== estadoProcessado` evita
 * loop infinito: só executa uma vez por identidade nova de `estado` (ou
 * seja, uma vez por submissão que de fato terminou).
 *
 * `textoMaxLength` chega por PROP, calculada no Server Component
 * (`page.tsx`, que importa `TEXTO_MAX_LENGTH` de `@/core/leads/notes`) —
 * não importamos essa constante direto aqui. `notes.ts` (e `@/lib/prisma`,
 * que ele importa) tem `import "server-only"` no topo (fix round 2/5) —
 * este componente importando qualquer coisa de lá faria o BUILD falhar com
 * um erro explícito, não um comportamento silenciosamente quebrado em
 * runtime. Só `adicionarNotaAction` (de `actions.ts`, que tem `"use
 * server"` no topo do arquivo — uma coisa diferente de `"server-only"`)
 * pode ser importada aqui: o compilador do Next troca a implementação real
 * por uma referência RPC antes de gerar o bundle do cliente, então nunca
 * arrasta Prisma junto.
 */
export function LeadNoteForm({ leadId, textoMaxLength }: { leadId: string; textoMaxLength: number }) {
  const acao = adicionarNotaAction.bind(null, leadId);
  const [estado, formAction, pendente] = useActionState(acao, estadoInicial);
  const [texto, setTexto] = useState("");

  // `estadoProcessado` guarda a última identidade de `estado` já tratada.
  // Quando `useActionState` devolve um `estado` novo (uma submissão de
  // verdade terminou — nunca acontece a cada re-render comum), a
  // comparação abaixo detecta a mudança AQUI, durante a renderização, e
  // ajusta `texto` antes do commit. Sem erro: limpa o campo — cobre tanto
  // uma gravação bem-sucedida quanto o no-op de texto vazio/só-espaço (a
  // action devolve `{ erro: null }` nos dois casos; no segundo o campo já
  // estava vazio, então limpar não muda nada visível). Com erro: não toca
  // `texto` — o que a pessoa digitou continua ali, exatamente como estava.
  const [estadoProcessado, setEstadoProcessado] = useState(estado);
  if (estado !== estadoProcessado) {
    setEstadoProcessado(estado);
    if (!estado.erro) setTexto("");
  }

  return (
    <form action={formAction} className="space-y-2">
      <Textarea
        name="texto"
        placeholder="Adicionar nota..."
        maxLength={textoMaxLength}
        required
        value={texto}
        onChange={(evento) => setTexto(evento.target.value)}
        aria-invalid={estado.erro ? true : undefined}
      />
      <Button type="submit" disabled={pendente}>
        {pendente ? "Salvando..." : "Salvar nota"}
      </Button>
      {estado.erro && (
        <p role="alert" className="text-sm text-red-600">
          {estado.erro}
        </p>
      )}
    </form>
  );
}
