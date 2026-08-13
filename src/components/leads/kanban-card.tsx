"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

import { Card, CardContent } from "@/components/ui/card";
import type { LeadDoQuadro } from "@/core/leads/queries";

const rotuloCanal: Record<LeadDoQuadro["canal"], string> = {
  FORMULARIO: "Formulário",
  WHATSAPP: "WhatsApp",
  MANUAL: "Manual",
};

/**
 * Card individual do kanban.
 *
 * `lead.contact` é nullable (Task 13/15): um lead originado de clique no
 * WhatsApp pode ainda não ter um contato identificado. O card não pode
 * quebrar nem mostrar "undefined" nesse caso — mostra um rótulo explícito
 * (nome e telefone) em vez de inventar um dado que não existe.
 *
 * `role="button"` e `tabIndex={0}` vêm de `attributes` (dnd-kit,
 * comportamento padrão de `useDraggable`) — é o que torna o card alcançável
 * por Tab e operável via `KeyboardSensor` (ver kanban-board.tsx), sem
 * nenhum código extra aqui.
 */
export function KanbanCard({ lead }: { lead: LeadDoQuadro }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: lead.id,
  });

  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;

  const nomeContato = lead.contatoNome ?? "Sem contato identificado";

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      aria-label={`Lead ${nomeContato}, canal ${rotuloCanal[lead.canal]}. Espaço para pegar, setas para mover entre etapas, Espaço para soltar, Escape para cancelar.`}
      className={`mb-2 cursor-grab touch-none select-none active:cursor-grabbing ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      <CardContent className="space-y-1 p-3">
        <p className="text-sm font-medium">{nomeContato}</p>
        <p className="text-xs text-muted-foreground">
          {lead.contatoTelefone ?? rotuloCanal[lead.canal]}
        </p>
        <p className="text-xs text-muted-foreground">
          {lead.responsavelNome ?? "Sem responsável"}
        </p>
      </CardContent>
    </Card>
  );
}
