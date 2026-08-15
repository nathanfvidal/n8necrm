"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { registrarFalhaDeRede } from "@/lib/acao";
import { criarEtapaAction } from "@/core/pipeline/actions";

const COR_PADRAO = "#0f62fe";

export function EtapaForm() {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [cor, setCor] = useState(COR_PADRAO);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  // O `finally` abaixo desliga `salvando` assim que a action responde, mas a
  // tabela de etapas só muda quando o render do servidor chega — e é ele que
  // demora. Sem esta transição, o botão anuncia "Adicionar etapa" de volta
  // enquanto a etapa recém-criada ainda não apareceu na lista.
  const [atualizando, iniciarAtualizacao] = useTransition();

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      const resultado = await criarEtapaAction({ nome, cor });
      if (!resultado.ok) {
        // Não limpa o formulário: o que a pessoa digitou continua lá.
        setErro(resultado.erro);
        return;
      }
      setNome("");
      setCor(COR_PADRAO);
      iniciarAtualizacao(() => router.refresh());
    } catch (erroCapturado) {
      setErro(registrarFalhaDeRede("Falha ao criar a etapa", erroCapturado));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <label htmlFor="nome-da-nova-etapa" className="text-sm font-medium">
          Nome da etapa
        </label>
        <Input
          id="nome-da-nova-etapa"
          value={nome}
          maxLength={40}
          onChange={(evento) => setNome(evento.target.value)}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="cor-da-nova-etapa" className="text-sm font-medium">
          Cor
        </label>
        <input
          id="cor-da-nova-etapa"
          type="color"
          className="h-9 w-16 rounded border"
          value={cor}
          onChange={(evento) => setCor(evento.target.value)}
        />
      </div>

      <Button type="submit" disabled={salvando || atualizando}>
        {salvando || atualizando ? "Criando..." : "Adicionar etapa"}
      </Button>

      {erro && (
        <p role="alert" className="w-full text-sm text-destructive">
          {erro}
        </p>
      )}
    </form>
  );
}
