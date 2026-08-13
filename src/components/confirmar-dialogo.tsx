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
 * Confirmação para ação destrutiva, no lugar de `window.confirm`.
 *
 * Não é troca por gosto. `window.confirm` BLOQUEIA a thread do navegador, e
 * um diálogo nativo é invisível para o DOM — no Playwright ele só existe
 * através de `page.on("dialog")`, um canal lateral que precisa ser armado
 * ANTES do clique e que falha em silêncio se ninguém armar. Esta branch
 * escreve o primeiro e2e de tarefas do projeto; começar esse arquivo
 * dependendo de um canal assim seria escolher a versão frágil de propósito.
 *
 * Fica FORA de `src/components/ui/`, que é diretório vendorizado (shadcn):
 * o que mora lá é regerável por ferramenta, e um arquivo nosso no meio some
 * na próxima atualização de componente.
 *
 * `role="dialog"` e `aria-labelledby` vêm do Base UI — verificado no jsdom
 * antes de este componente existir, não presumido: uma sonda descartável
 * confirmou que `getByRole("dialog")` encontra o popup e que o título é
 * anunciado. Se não fosse o caso, este componente teria outro desenho.
 */
export function ConfirmarDialogo({
  gatilho,
  titulo,
  descricao,
  rotuloConfirmar,
  onConfirmar,
}: {
  /** O botão que abre. Recebe `onClick` por injeção — ver abaixo. */
  gatilho: (abrir: () => void) => ReactNode;
  titulo: string;
  descricao: string;
  rotuloConfirmar: string;
  onConfirmar: () => void | Promise<void>;
}) {
  const [aberto, setAberto] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  async function confirmar() {
    setConfirmando(true);
    try {
      await onConfirmar();
      setAberto(false);
    } finally {
      setConfirmando(false);
    }
  }

  return (
    <>
      {/* O gatilho é injetado, e não `<DialogTrigger>`, porque quem chama
          precisa controlar a aparência do botão (tamanho, variante) e o
          `DialogTrigger` do Base UI impõe a própria. */}
      {gatilho(() => setAberto(true))}
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent showCloseButton={false}>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
          <DialogFooter>
            {/* "Cancelar" primeiro e como padrão visual: num diálogo de ação
                destrutiva, a saída segura é a que deve estar embaixo do dedo. */}
            <Button variant="outline" onClick={() => setAberto(false)} disabled={confirmando}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={confirmar} disabled={confirmando}>
              {confirmando ? "Excluindo..." : rotuloConfirmar}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
