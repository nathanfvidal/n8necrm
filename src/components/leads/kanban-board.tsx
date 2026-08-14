"use client";

import { useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import type { PipelineStage } from "@prisma/client";

import { KanbanCard } from "./kanban-card";
import { moverLeadDeEtapaAction } from "@/core/leads/actions";
import { EmptyState } from "@/components/empty-state";
import { registrarFalhaDeRede } from "@/lib/acao";
import type { LeadDoQuadro } from "@/core/leads/queries";

type LeadsPorEtapa = Record<string, LeadDoQuadro[]>;

// w-72 (288px) + gap-4 (16px) = a distância, em pixels, entre o início de
// uma coluna e o início da próxima (ver o layout em `KanbanBoard` abaixo).
// O passo padrão do KeyboardSensor é 25px — a esse ritmo, atravessar o
// quadro por teclado levaria dezenas de toques de seta. Um coordinateGetter
// customizado que pula uma coluna inteira por toque é o que torna a
// navegação por teclado praticamente usável, não só tecnicamente possível.
const COLUNA_PASSO_PX = 304;

const moverPorTeclado: KeyboardCoordinateGetter = (event, { currentCoordinates }) => {
  switch (event.code) {
    case "ArrowRight":
      event.preventDefault();
      return { ...currentCoordinates, x: currentCoordinates.x + COLUNA_PASSO_PX };
    case "ArrowLeft":
      event.preventDefault();
      return { ...currentCoordinates, x: currentCoordinates.x - COLUNA_PASSO_PX };
    default:
      return undefined;
  }
};

/**
 * Localiza em qual etapa (chave de `leadsPorEtapa`) um lead está agora.
 * `undefined` quando o id não aparece em nenhuma coluna — não deveria
 * acontecer (todo lead vem de `listarLeadsPorEtapa`, Task 13, que cobre toda
 * etapa), mas é uma guarda barata contra um `DragEndEvent` inconsistente em
 * vez de deixar o `.find` seguinte falhar em silêncio.
 */
function encontrarEtapaDoLead(leadsPorEtapa: LeadsPorEtapa, leadId: string): string | undefined {
  return Object.keys(leadsPorEtapa).find((etapaId) =>
    leadsPorEtapa[etapaId].some((lead) => lead.id === leadId)
  );
}

/**
 * Move um lead, em memória, de uma coluna para outra. Usada tanto para a
 * atualização otimista quanto para o rollback — chamar de novo com origem e
 * destino trocados desfaz exatamente o que a primeira chamada fez.
 */
function moverLeadNoEstadoLocal(
  leadsPorEtapa: LeadsPorEtapa,
  leadId: string,
  etapaOrigemId: string,
  etapaDestinoId: string
): LeadsPorEtapa {
  const lead = leadsPorEtapa[etapaOrigemId]?.find((item) => item.id === leadId);
  if (!lead) return leadsPorEtapa;

  return {
    ...leadsPorEtapa,
    [etapaOrigemId]: leadsPorEtapa[etapaOrigemId].filter((item) => item.id !== leadId),
    [etapaDestinoId]: [...(leadsPorEtapa[etapaDestinoId] ?? []), lead],
  };
}

/**
 * Rede de segurança para a falha que NÃO chega como `{ ok: false }`.
 *
 * Substituiu um `mensagemDeErroMover` que comparava `erro.message` com "Sem
 * permissão para mover lead", "Não autenticado" e `/^Etapa não encontrada/` —
 * três textos escritos no servidor, reconhecidos por string no cliente.
 * Renomear qualquer um deles em `actions.ts`/`service.ts` apagaria a tradução
 * sem produzir erro de tipo nem teste vermelho no ponto da mudança. As frases
 * moram agora em `MENSAGENS_MELHORADAS`/`MENSAGENS_SEGURAS`
 * (`core/leads/actions.ts`).
 *
 * O que sobra aqui é o caso que resultado nenhum cobre:
 * `moverLeadDeEtapaAction` promete não lançar, mas isso é promessa do CÓDIGO
 * do servidor, não do transporte. Arrastar um card é justamente a ação em que
 * a rede cai no meio — a pessoa está mexendo no quadro, não parada.
 */
function mensagemDeFalhaDeRede(erro: unknown): string {
  return registrarFalhaDeRede("Falha ao mover lead", erro);
}

/**
 * Estado e lógica de movimentação do kanban, isolados da árvore de
 * componentes de propósito: um `DragEndEvent` real do dnd-kit depende de
 * geometria de layout (`getBoundingClientRect`) que o jsdom não calcula, o
 * que torna simular um drag completo em teste de componente pouco confiável
 * (ver decisão da Task 15 sobre sensores e verificação). Testar este hook
 * isoladamente, chamando `handleDragEnd` com um evento sintético mínimo
 * (`{ active: { id }, over: { id } }`), cobre a MESMA lógica de ramificação
 * — otimista, rollback, mensagem por tipo de falha — sem depender de sensor
 * nenhum.
 */
export function useKanbanBoard(leadsPorEtapaInicial: LeadsPorEtapa) {
  const [leadsPorEtapa, setLeadsPorEtapa] = useState(leadsPorEtapaInicial);
  // Espelha `leadsPorEtapa`, mas é lido e escrito de forma SÍNCRONA, sem
  // depender de quando o React decide re-renderizar (fix round 1/5, achado
  // do revisor). A variável de estado `leadsPorEtapa` fica presa ao
  // fechamento do render em que `handleDragEnd` foi criada — duas chamadas
  // que compartilham o MESMO fechamento (ex.: `KeyboardSensor` disparando
  // rápido, ou um double-fire de sensor) e rodam antes do próximo render
  // enxergariam a MESMA foto antiga do estado, mesmo que a primeira já
  // tenha, de fato, movido o lead: a segunda calcularia a etapa de origem
  // errada, `moverLeadNoEstadoLocal` não encontraria o lead lá (guarda
  // silenciosa) e a atualização otimista da segunda chamada viraria um
  // no-op — enquanto a chamada ao servidor (que não depende dessa origem,
  // só do `novaStageId` do próprio evento) prosseguiria normalmente. Board
  // e banco ficariam em desacordo, em silêncio: o servidor moveu, a tela
  // não. Como o objeto do ref é o MESMO entre closures de renders
  // diferentes (só `.current` muda), escrever nele antes de qualquer
  // `await` garante que a segunda chamada veja o efeito síncrono da
  // primeira, não uma cópia desatualizada.
  const leadsPorEtapaRef = useRef(leadsPorEtapaInicial);
  const [erro, setErro] = useState<string | null>(null);

  async function handleDragEnd(event: Pick<DragEndEvent, "active" | "over">) {
    const { active, over } = event;
    if (!over) return; // solto fora de qualquer coluna: nada muda

    const leadId = String(active.id);
    const novaStageId = String(over.id);
    // Lê do ref — a fonte de verdade síncrona — não da variável de estado
    // capturada no fechamento (ver comentário acima).
    const etapaAtualId = encontrarEtapaDoLead(leadsPorEtapaRef.current, leadId);

    if (!etapaAtualId || etapaAtualId === novaStageId) return;

    setErro(null);
    // Atualização otimista: a UI reflete o destino antes da confirmação do
    // servidor. O ref é escrito IMEDIATAMENTE, antes do `await` abaixo —
    // é isso que faz uma segunda chamada concorrente (mesmo fechamento)
    // enxergar este lead já na coluna nova. `setLeadsPorEtapa` dispara o
    // re-render que reflete essa mudança na tela.
    const proximo = moverLeadNoEstadoLocal(leadsPorEtapaRef.current, leadId, etapaAtualId, novaStageId);
    leadsPorEtapaRef.current = proximo;
    setLeadsPorEtapa(proximo);

    // ─── DOIS caminhos de rollback, e os dois são obrigatórios ───
    //
    // Um card "preso" na coluna nova depois de uma falha real é pior que uma
    // reversão visível: o quadro passa a mentir sobre onde o lead está, e o
    // funil inteiro é lido por essa posição.
    //
    // Enquanto esta action LANÇAVA, o `catch` sozinho dava conta. Com
    // a action devolvendo `ResultadoAcao`, a recusa do servidor (sem
    // permissão, etapa que sumiu, sessão expirada) chega como VALOR — um
    // código que só olhasse o `catch` deixaria o card na coluna errada, em
    // silêncio. O `catch` continua necessário pelo motivo oposto: a chamada
    // de rede pode falhar antes de alcançar a action.
    //
    // Desfaz sempre a partir do REF, nunca de um snapshot capturado antes do
    // `await` — ver o comentário longo sobre `leadsPorEtapaRef` acima.
    const desfazer = (mensagem: string) => {
      const revertido = moverLeadNoEstadoLocal(leadsPorEtapaRef.current, leadId, novaStageId, etapaAtualId);
      leadsPorEtapaRef.current = revertido;
      setLeadsPorEtapa(revertido);
      setErro(mensagem);
    };

    try {
      // Nenhum identificador de autor é enviado: a action deriva quem age
      // da sessão (Task 13).
      const resultado = await moverLeadDeEtapaAction({ leadId, novaStageId });
      if (!resultado.ok) desfazer(resultado.erro);
    } catch (erroCapturado) {
      desfazer(mensagemDeFalhaDeRede(erroCapturado));
    }
  }

  return { leadsPorEtapa, erro, handleDragEnd, limparErro: () => setErro(null) };
}

function Coluna({ etapa, leads }: { etapa: PipelineStage; leads: LeadDoQuadro[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: etapa.id });

  return (
    <div
      ref={setNodeRef}
      className={`w-72 shrink-0 rounded-lg border p-3 ${isOver ? "bg-muted/50" : ""}`}
      style={{ borderTopColor: etapa.cor, borderTopWidth: 3 }}
    >
      <h3 className="mb-2 text-sm font-semibold">
        {etapa.nome} ({leads.length})
      </h3>
      {leads.length === 0 ? (
        <EmptyState title="Sem leads" description="Nenhum lead nesta etapa." />
      ) : (
        leads.map((lead) => <KanbanCard key={lead.id} lead={lead} />)
      )}
    </div>
  );
}

export function KanbanBoard({
  etapas,
  leadsPorEtapa: leadsPorEtapaInicial,
}: {
  etapas: PipelineStage[];
  leadsPorEtapa: LeadsPorEtapa;
}) {
  const { leadsPorEtapa, erro, handleDragEnd, limparErro } = useKanbanBoard(leadsPorEtapaInicial);

  // PointerSensor cobre mouse/touch; KeyboardSensor (com o passo customizado
  // acima) é o que garante que mover um lead de etapa — uma ação central do
  // funil, não um "extra" — continua possível para quem não usa mouse.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: moverPorTeclado })
  );

  return (
    <div className="space-y-3 p-6">
      {erro && (
        <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-600">
          {erro}{" "}
          <button type="button" onClick={limparErro} className="underline">
            Dispensar
          </button>
        </p>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto">
          {etapas.map((etapa) => (
            <Coluna key={etapa.id} etapa={etapa} leads={leadsPorEtapa[etapa.id] ?? []} />
          ))}
        </div>
      </DndContext>
    </div>
  );
}
