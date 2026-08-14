"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Nome e cor, num diálogo — não edição *inline*.
 *
 * O nome de uma etapa é vocabulário compartilhado por todo mundo que usa o CRM,
 * e um campo que salva ao sair do foco torna fácil demais renomear sem querer.
 */
export function EditarEtapaDialogo({
  nomeAtual,
  corAtual,
  onSalvar,
}: {
  nomeAtual: string;
  corAtual: string;
  /**
   * Devolve se a action deu certo. `false` (recusa ou queda de rede) mantém o
   * diálogo aberto — fechar mesmo assim faria um "nome duplicado" desaparecer
   * da tela como se tivesse salvado, e a mensagem de erro ficaria só no
   * alerta acima da tabela, que a pessoa pode nem estar olhando.
   */
  onSalvar: (dados: { nome: string; cor: string }) => Promise<boolean>;
}) {
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState(nomeAtual);
  const [cor, setCor] = useState(corAtual);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    try {
      const ok = await onSalvar({ nome, cor });
      if (ok) setAberto(false);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" aria-label="Editar etapa" onClick={() => setAberto(true)}>
        Editar
      </Button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent showCloseButton={false}>
          <DialogTitle>Editar etapa</DialogTitle>

          <div className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="nome-da-etapa" className="text-sm font-medium">
                Nome
              </label>
              <Input
                id="nome-da-etapa"
                value={nome}
                maxLength={40}
                onChange={(evento) => setNome(evento.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="cor-da-etapa" className="text-sm font-medium">
                Cor
              </label>
              {/* `<input type="color">` só produz #rrggbb. Isso é conveniência —
                  a defesa é o regex no servidor (`core/pipeline/schema.ts`). */}
              <input
                id="cor-da-etapa"
                type="color"
                className="h-9 w-16 rounded border"
                value={cor}
                onChange={(evento) => setCor(evento.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)} disabled={salvando}>
              Cancelar
            </Button>
            <Button onClick={salvar} disabled={salvando}>
              {salvando ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
