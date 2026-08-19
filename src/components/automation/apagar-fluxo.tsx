"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { ConfirmarDialogo } from "@/components/confirmar-dialogo";
import { Button } from "@/components/ui/button";
import { apagarFluxoAction } from "@/modules/automation/actions";

export function ApagarFluxo({ id, nome }: { id: string; nome: string }) {
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  return (
    <ConfirmarDialogo
      gatilho={(abrir) => (
        <Button variant="destructive" size="sm" onClick={abrir} disabled={pendente}>
          Apagar fluxo
        </Button>
      )}
      titulo={`Apagar "${nome}"?`}
      descricao="O workflow é removido da instância do n8n e não há como desfazer pelo CRM. Se ele atende clientes, o atendimento para na hora."
      exigirDigitar={nome}
      rotuloConfirmar="Apagar"
      rotuloConfirmando="Apagando…"
      onConfirmar={() =>
        iniciar(async () => {
          const r = await apagarFluxoAction(id, nome);
          if (r.ok) {
            toast.success(`"${nome}" foi apagado.`);
            // Volta para a lista: a página de detalhe passou a apontar para
            // um workflow que não existe mais.
            router.push("/fluxos");
          } else {
            toast.error(r.erro);
          }
        })
      }
    />
  );
}
