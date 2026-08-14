"use client";

import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Diálogo próprio, e não `ConfirmarDialogo`, porque este precisa de um campo: a
 * etapa vai deixar de existir e os leads dela têm que ir para algum lugar.
 *
 * O `<select>` aparece quando `leadsTotais > 0` — TOTAL, arquivados incluídos.
 * Decidir por leads ativos faria uma etapa com 5 arquivados parecer vazia, o
 * diálogo não pediria destino, e o `delete` morreria na chave estrangeira. Ver
 * `contarLeadsQueSeguramEtapa` (`core/pipeline/stages.ts`).
 */
export function ExcluirEtapaDialogo({
  nome,
  leadsAtivos,
  leadsTotais,
  destinosPossiveis,
  onConfirmar,
}: {
  nome: string;
  leadsAtivos: number;
  leadsTotais: number;
  destinosPossiveis: { id: string; nome: string }[];
  onConfirmar: (destinoId: string | null) => Promise<void>;
}) {
  const [aberto, setAberto] = useState(false);
  const [destinoId, setDestinoId] = useState("");
  const [confirmando, setConfirmando] = useState(false);

  const precisaDeDestino = leadsTotais > 0;
  const arquivados = leadsTotais - leadsAtivos;

  const descricao = precisaDeDestino
    ? `Esta etapa tem ${leadsTotais} lead(s)` +
      (arquivados > 0 ? ` (${leadsAtivos} ativos, ${arquivados} arquivados)` : "") +
      ". Todos serão movidos para a etapa que você escolher."
    : `A etapa "${nome}" não tem nenhum lead e será removida do funil.`;

  async function confirmar() {
    setConfirmando(true);
    try {
      await onConfirmar(precisaDeDestino ? destinoId : null);
      setAberto(false);
    } finally {
      setConfirmando(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Remover etapa"
        onClick={() => setAberto(true)}
      >
        Remover
      </Button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent showCloseButton={false}>
          <DialogTitle>Remover &ldquo;{nome}&rdquo;?</DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>

          {precisaDeDestino && (
            <div className="space-y-1">
              <label htmlFor="destino-da-etapa" className="text-sm font-medium">
                Mover os leads para
              </label>
              <select
                id="destino-da-etapa"
                className="w-full rounded-md border px-2 py-1 text-sm"
                value={destinoId}
                onChange={(evento) => setDestinoId(evento.target.value)}
              >
                <option value="">Escolha uma etapa</option>
                {destinosPossiveis.map((destino) => (
                  <option key={destino.id} value={destino.id}>
                    {destino.nome}
                  </option>
                ))}
              </select>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)} disabled={confirmando}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={confirmar}
              disabled={confirmando || (precisaDeDestino && destinoId === "")}
            >
              {confirmando ? "Removendo..." : "Remover etapa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
