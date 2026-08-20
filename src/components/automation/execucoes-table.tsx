"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmarDialogo } from "@/components/confirmar-dialogo";
import { StatusExecucao } from "@/components/automation/status-execucao";
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
  // `pendente` do useTransition é ÚNICO para o componente inteiro — reexecutar
  // UMA linha deixava as outras 19 com o botão desabilitado também (achado M4
  // da revisão final). `idEmCurso` guarda qual execução está em voo agora, e
  // cada linha só se desabilita quando é ELA que está em curso.
  const [idEmCurso, setIdEmCurso] = useState<string | null>(null);

  function reexecutar(execucao: Execucao) {
    setIdEmCurso(execucao.id);
    iniciar(async () => {
      try {
        const r = await reexecutarExecucaoAction(execucao.id, execucao.workflowId);
        if (r.ok) toast.success("Reexecução enfileirada. Atualize em alguns segundos.");
        else toast.error(r.erro);
      } finally {
        setIdEmCurso(null);
      }
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
              {/* Componente compartilhado com `fluxos-table.tsx` — antes disto,
                  esta célula usava `variant={status === "success" ?
                  "default" : "destructive"}` e mostrava `execucao.status` cru
                  em inglês. Dois defeitos na mesma linha: `running` e
                  `waiting` viravam vermelho (uma execução rodando agora
                  aparecia como falha, nesta que é a tela de diagnóstico), e o
                  texto não batia com o português que `fluxos-table.tsx` já
                  usava para o mesmo conceito. Ver `status-execucao.tsx` para
                  o raciocínio completo por trás da variante de cada status. */}
              <StatusExecucao status={execucao.status} />
            </TableCell>
            <TableCell>{execucao.iniciadoEm ? formatarDataHoraBR(new Date(execucao.iniciadoEm)) : "—"}</TableCell>
            <TableCell>{duracao(execucao)}</TableCell>
            <TableCell>{execucao.modo}</TableCell>
            <TableCell className="text-right">
              {/* "Reexecutar" e não "Testar": o botão roda de novo um caso que
                  aconteceu de verdade, na instância de produção. Chamá-lo de
                  teste sugeriria um sandbox que não existe.

                  Confirmação obrigatória (achado B1 da revisão final do Ciclo
                  4): reexecutar roda o fluxo INTEIRO de novo, nós de envio
                  inclusos — se o fluxo manda mensagem, o CLIENTE FINAL pode
                  recebê-la de novo. Não é diagnóstico inofensivo, apesar de
                  ser o rótulo que a permissão usa (`ver_fluxos`, decisão
                  registrada em `permissions.ts`); é uma ação real contra a
                  instância de produção de um cliente, e por isso pede a
                  mesma fricção mínima das outras ações desta tela. Sem
                  `exigirDigitar`: decisão do dono foi confirmação simples
                  (sim/não), não digitação do nome — reexecutar é revertido
                  rodando de novo, ao contrário de apagar um fluxo. */}
              <ConfirmarDialogo
                gatilho={(abrir) => (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={abrir}
                    disabled={pendente && idEmCurso === execucao.id}
                  >
                    Reexecutar
                  </Button>
                )}
                titulo="Reexecutar esta execução?"
                descricao="O fluxo roda de novo por inteiro, contra a versão atual, na instância de produção. Se ele envia mensagem, o cliente final pode recebê-la de novo."
                rotuloConfirmar="Reexecutar"
                rotuloConfirmando="Reexecutando…"
                onConfirmar={() => reexecutar(execucao)}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
