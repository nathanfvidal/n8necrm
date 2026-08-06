"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { responderConversaAction } from "@/modules/whatsapp/actions";
import { Button } from "@/components/ui/button";

/**
 * Caixa de resposta da inbox. Client Component porque precisa de estado local
 * (texto digitado, erro de envio) e de `useTransition` para desabilitar o
 * botão durante o envio — sem isso, um clique duplo manda a mesma mensagem
 * duas vezes ao cliente, e não há como desenviar.
 *
 * O aviso de que enviar pausa a IA fica NA TELA, não só na documentação: é um
 * efeito colateral que muda o comportamento do sistema, e quem clica precisa
 * saber antes de clicar.
 */
export function ConversaResponder({ conversationId }: { conversationId: string }) {
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, iniciarEnvio] = useTransition();
  const router = useRouter();

  // A action DEVOLVE resultado, não lança — `try/catch` aqui não funcionaria
  // em produção, porque o Next redige erros não tratados de Server Action
  // antes que cheguem ao cliente. O humano veria um texto genérico com um
  // identificador, e "não enviou" ficaria indistinguível de "enviou e não
  // gravou" — justamente a distinção de que depende a ordem de operações
  // escolhida em `agente.ts`. Ver a correção I2 da Task 5.
  function enviar() {
    setErro(null);
    iniciarEnvio(async () => {
      const resultado = await responderConversaAction(conversationId, texto);
      if (!resultado.ok) {
        setErro(resultado.erro);
        return;
      }
      setTexto("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-2 border-t pt-4">
      {/* `htmlFor`/`id` já dá nome acessível "Resposta" ao campo — sem
          `aria-label` redundante (fix round 1, achado Menor): um
          `aria-label` sobrepõe o `<label>` associado no cálculo do nome
          acessível, então tê-los os dois é inútil e um dos dois fica
          "morto" sem ninguém perceber. O `<label>` visível também serve a
          quem enxerga, o que `aria-label` sozinho não faria. */}
      <label htmlFor="resposta" className="text-sm font-medium">
        Resposta
      </label>
      <textarea
        id="resposta"
        className="w-full rounded-md border p-2 text-sm"
        rows={3}
        value={texto}
        onChange={(evento) => {
          setTexto(evento.target.value);
          setErro(null);
        }}
        disabled={enviando}
      />
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Enviar pausa o atendimento automático desta conversa.
        </p>
        <Button onClick={enviar} disabled={enviando || texto.trim().length === 0}>
          {enviando ? "Enviando…" : "Enviar"}
        </Button>
      </div>
      {erro && <p className="text-sm text-destructive">{erro}</p>}
    </div>
  );
}
