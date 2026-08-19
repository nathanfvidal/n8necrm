"use client";

import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";

import { StatusFluxo } from "@/components/automation/status-fluxo";
import { ConfirmarDialogo } from "@/components/confirmar-dialogo";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatarDataHoraBR } from "@/lib/date";
import { ativarFluxoAction, desativarFluxoAction } from "@/modules/automation/actions";
// `import type`: apaga em tempo de compilação. `queries.ts` tem
// `import "server-only"` no topo — um import de VALOR daqui vazaria essa
// marcação para o bundle do cliente e quebraria o build; um import de TIPO
// não carrega nada em runtime, só a forma.
import type { FluxoComUltimaExecucao } from "@/modules/automation/queries";
import type { StatusExecucao } from "@/modules/automation/n8n";

/**
 * Rótulo em português de cada status de execução do n8n.
 *
 * `unknown` cobre um status novo que a instância passe a devolver — a tela
 * não pode quebrar por causa disso, só mostrar um rótulo genérico.
 */
const ROTULO_STATUS: Record<StatusExecucao, string> = {
  success: "Sucesso",
  error: "Erro",
  waiting: "Aguardando",
  running: "Rodando",
  canceled: "Cancelado",
  crashed: "Falhou",
  new: "Novo",
  unknown: "Desconhecido",
};

export function FluxosTable({
  fluxos,
  podeGerenciar,
}: {
  fluxos: FluxoComUltimaExecucao[];
  podeGerenciar: boolean;
}) {
  const [pendente, iniciar] = useTransition();

  function alternar(fluxo: FluxoComUltimaExecucao) {
    iniciar(async () => {
      const acao = fluxo.ativo ? desativarFluxoAction : ativarFluxoAction;
      const r = await acao(fluxo.id, fluxo.nome);
      if (r.ok) toast.success(fluxo.ativo ? `"${fluxo.nome}" desativado.` : `"${fluxo.nome}" ativado.`);
      else toast.error(r.erro);
    });
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Fluxo</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead>Nós</TableHead>
          <TableHead>Atualizado</TableHead>
          <TableHead>Última execução</TableHead>
          {podeGerenciar ? <TableHead className="text-right">Ações</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {fluxos.map((fluxo) => (
          <TableRow key={fluxo.id}>
            <TableCell>
              <Link href={`/fluxos/${fluxo.id}`} className="font-medium hover:underline">
                {fluxo.nome}
              </Link>
            </TableCell>
            <TableCell>
              <StatusFluxo ativo={fluxo.ativo} />
            </TableCell>
            <TableCell>{fluxo.nos}</TableCell>
            <TableCell>{fluxo.atualizadoEm ? formatarDataHoraBR(new Date(fluxo.atualizadoEm)) : "—"}</TableCell>
            <TableCell>
              {fluxo.ultimaExecucao
                ? `${ROTULO_STATUS[fluxo.ultimaExecucao.status]} · ${formatarDataHoraBR(new Date(fluxo.ultimaExecucao.iniciadoEm))}`
                : "—"}
            </TableCell>
            {podeGerenciar ? (
              <TableCell className="text-right">
                <ConfirmarDialogo
                  gatilho={(abrir) => (
                    <Button variant="outline" size="sm" onClick={abrir} disabled={pendente}>
                      {fluxo.ativo ? "Desativar" : "Ativar"}
                    </Button>
                  )}
                  titulo={fluxo.ativo ? `Desativar "${fluxo.nome}"?` : `Ativar "${fluxo.nome}"?`}
                  descricao={
                    fluxo.ativo
                      ? "O fluxo para de responder imediatamente. Se ele atende clientes por WhatsApp, as mensagens deixam de ser respondidas e ninguém é avisado."
                      : "O fluxo volta a responder imediatamente."
                  }
                  rotuloConfirmar={fluxo.ativo ? "Desativar" : "Ativar"}
                  rotuloConfirmando="Aplicando…"
                  // `undefined` quando o fluxo está desligado, e não sempre:
                  // ativar é reparo, e exigir digitação para religar algo já
                  // parado só treina a pessoa a digitar nome sem ler. A
                  // fricção fica onde o custo do erro está — desativar
                  // derruba o atendimento de um cliente; ativar devolve.
                  exigirDigitar={fluxo.ativo ? fluxo.nome : undefined}
                  onConfirmar={() => alternar(fluxo)}
                />
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
