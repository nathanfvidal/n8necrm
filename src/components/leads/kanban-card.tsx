"use client";

import { useId } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronUp } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { alternarCartao, useCartaoRecolhido } from "./cartoes-recolhidos";
import type { LeadDoQuadro } from "@/core/leads/queries";

const rotuloCanal: Record<LeadDoQuadro["canal"], string> = {
  FORMULARIO: "Formulário",
  WHATSAPP: "WhatsApp",
  MANUAL: "Manual",
};

/**
 * Card individual do kanban.
 *
 * `contatoNome`/`contatoTelefone` são nullable (Task 13/15): um lead originado
 * de clique no WhatsApp pode ainda não ter um contato identificado. O card não
 * pode quebrar nem mostrar "undefined" nesse caso — mostra um rótulo explícito
 * em vez de inventar um dado que não existe. Mesma regra para
 * `valorFormatado`: "Sem valor estimado", nunca string vazia, que num cartão é
 * indistinguível de campo quebrado.
 *
 * `role="button"` e `tabIndex={0}` vêm de `attributes` (dnd-kit,
 * comportamento padrão de `useDraggable`) — é o que torna o card alcançável
 * por Tab e operável via `KeyboardSensor` (ver kanban-board.tsx), sem
 * nenhum código extra aqui.
 *
 * ─── Por que o botão de recolher é IRMÃO do `<Card>`, e não filho ───
 *
 * Pela ARIA, `role="button"` tem FILHOS APRESENTACIONAIS: todo descendente
 * perde a própria semântica e o leitor de tela anuncia só o rótulo do
 * contêiner. Um `<button>` dentro do `<Card>` simplesmente não existiria para
 * quem navega por leitor de tela — e o `getByRole` do testing-library NÃO
 * implementa essa regra, então o teste ficaria verde com a acessibilidade
 * quebrada. Não é hipótese de manual: é o motivo de o botão estar aqui fora.
 *
 * O `<Card>` ainda tem `overflow-hidden` (ver `ui/card.tsx`), que recortaria
 * um filho posicionado no canto. Dois motivos independentes, mesma conclusão.
 *
 * Como o botão está fora, os `listeners` do dnd-kit nunca veem o clique dele:
 * sem `stopPropagation`, sem `data-no-dnd`, sem gambiarra.
 */
export function KanbanCard({ lead }: { lead: LeadDoQuadro }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: lead.id,
  });
  const recolhido = useCartaoRecolhido(lead.id);
  // `useId` e não o id do lead: o id precisa ser único no DOCUMENTO, e o mesmo
  // lead pode aparecer duas vezes na tela durante um arrasto (overlay).
  const detalhesId = useId();

  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;

  const nomeContato = lead.contatoNome ?? "Sem contato identificado";

  return (
    // O `transform` do arrasto vai no ENVOLTÓRIO, não no `<Card>`: com ele no
    // card, o botão ficaria parado no lugar de origem enquanto o cartão desliza
    // debaixo do cursor. O dnd-kit só precisa do `setNodeRef` no elemento que
    // ele mede; transladar um ancestral translada o descendente junto, que é
    // exatamente o que se quer aqui.
    <div className={`relative mb-2 ${isDragging ? "opacity-50" : ""}`} style={style}>
      <Card
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        aria-label={`Lead ${nomeContato}, canal ${rotuloCanal[lead.canal]}. Espaço para pegar, setas para mover entre etapas, Espaço para soltar, Escape para cancelar.`}
        className="cursor-grab touch-none select-none active:cursor-grabbing"
      >
        <CardContent className="space-y-1 p-3 pr-9">
          <p className="text-sm font-medium">{nomeContato}</p>
          {/* `hidden` em vez de não renderizar: `aria-controls` precisa apontar
              para um elemento que EXISTE. Com renderização condicional, o
              cartão recolhido ficaria com uma referência pendurada — erro de
              validação ARIA, e leitor de tela sem nada para onde ir. O
              atributo `hidden` tira o bloco do layout E da árvore de
              acessibilidade, que é o comportamento desejado nos dois. */}
          <div id={detalhesId} hidden={recolhido} className="space-y-1">
            <p className="text-xs text-muted-foreground">
              {lead.contatoTelefone ?? rotuloCanal[lead.canal]}
            </p>
            <p className="text-xs text-muted-foreground">
              {lead.responsavelNome ?? "Sem responsável"}
            </p>
            <p className="text-xs text-muted-foreground">
              {lead.valorFormatado ?? "Sem valor estimado"}
            </p>
          </div>
        </CardContent>
      </Card>
      <button
        type="button"
        onClick={() => alternarCartao(lead.id)}
        // O rótulo NÃO pode conter o nome do contato. O `<Card>` já se anuncia
        // como `role="button"` com "Lead {nome}, canal…" — repetir o nome aqui
        // faria `getByRole("button", { name: /nome/ })` casar com DOIS
        // elementos, quebrando o localizador do e2e e o do teste de unidade.
        // Sabotagem obrigatória do plano; o vermelho está registrado.
        aria-label={recolhido ? "Expandir cartão" : "Recolher cartão"}
        aria-expanded={!recolhido}
        aria-controls={detalhesId}
        // Posicionamento só por classe, NUNCA por `style` inline: a única
        // `style` inline do funil é a cor da etapa (`borderTopColor`, em
        // `kanban-board.tsx`), e é ela que obriga o `'unsafe-inline'` no
        // `style-src` do CSP. Se um dia alguém for endurecer o CSP, precisa
        // encontrar UM lugar para tratar, não dois.
        className="absolute right-1 top-1 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {recolhido ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>
    </div>
  );
}
