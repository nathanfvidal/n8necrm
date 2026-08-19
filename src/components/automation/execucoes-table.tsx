"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatarDataHoraBR } from "@/lib/date";
import { reexecutarExecucaoAction } from "@/modules/automation/actions";
import type { Execucao } from "@/modules/automation/n8n/tipos";

function duracao(execucao: Execucao): string {
  if (!execucao.terminadoEm) return "em andamento";
  const ms = new Date(execucao.terminadoEm).getTime() - new Date(execucao.iniciadoEm).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function ExecucoesTable({ execucoes }: { execucoes: Execucao[] }) {
  const [pendente, iniciar] = useTransition();

  function reexecutar(execucao: Execucao) {
    iniciar(async () => {
      const r = await reexecutarExecucaoAction(execucao.id, execucao.workflowId);
      if (r.ok) toast.success("Reexecução enfileirada. Atualize em alguns segundos.");
      else toast.error(r.erro);
    });
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Status</TableHead>
          <TableHead>Início</TableHead>
          <TableHead>Duração</TableHead>
          <TableHead>Disparo</TableHead>
          <TableHead className="text-right">Ação</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {execucoes.map((execucao) => (
          <TableRow key={execucao.id}>
            <TableCell>
              <Badge variant={execucao.status === "success" ? "default" : "destructive"}>{execucao.status}</Badge>
            </TableCell>
            <TableCell>{execucao.iniciadoEm ? formatarDataHoraBR(new Date(execucao.iniciadoEm)) : "—"}</TableCell>
            <TableCell>{duracao(execucao)}</TableCell>
            <TableCell>{execucao.modo}</TableCell>
            <TableCell className="text-right">
              {/* "Reexecutar" e não "Testar": o botão roda de novo um caso que
                  aconteceu de verdade, na instância de produção. Chamá-lo de
                  teste sugeriria um sandbox que não existe. */}
              <Button variant="outline" size="sm" onClick={() => reexecutar(execucao)} disabled={pendente}>
                Reexecutar
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
