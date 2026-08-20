"use client";

import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";

import { StatusExecucao } from "@/components/automation/status-execucao";
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

/**
 * DTO montado no servidor para ESTA tela (mesmo padrão de `EtapaNaTela` em
 * `etapas-table.tsx`) — `fluxos/page.tsx` que monta.
 *
 * `ultimaExecucaoRelativa` é o texto de `formatarDuracaoDesde` já pronto,
 * NÃO uma `Date` crua. Motivo: `FluxosTable` é Client Component (precisa dos
 * botões Ativar/Desativar), e o React executa o corpo de um Client Component
 * de novo no navegador na hidratação, depois de já ter rodado uma vez no
 * servidor para gerar o HTML inicial. Se o cálculo de "há quanto tempo"
 * dependesse de `new Date()` lido DENTRO deste componente, as duas execuções
 * poderiam cair em minutos diferentes ("5 min" no servidor, "6 min" na
 * hidratação) e o React acusaria descompasso de hidratação. A inbox de
 * conversas (`(painel)/conversas/page.tsx`) não tem esse risco porque é
 * Server Component puro — roda só uma vez, no servidor, e o texto já sai
 * pronto no HTML. Aqui a mesma garantia vem de calcular a string ANTES da
 * fronteira servidor→cliente (em `fluxos/page.tsx`, que é Server Component)
 * e só passar o resultado — já texto, imutável — como prop.
 */
export type FluxoNaTela = FluxoComUltimaExecucao & {
  ultimaExecucaoRelativa: string | null;
};

export function FluxosTable({
  fluxos,
  podeGerenciar,
}: {
  fluxos: FluxoNaTela[];
  podeGerenciar: boolean;
}) {
  const [pendente, iniciar] = useTransition();

  function alternar(fluxo: FluxoComUltimaExecucao) {
    iniciar(async () => {
      const acao = fluxo.ativo ? desativarFluxoAction : ativarFluxoAction;
      // Só o `id` viaja: `nome` deixou de ser parâmetro da action (achado I1
      // da revisão final) — ela lê o nome real do n8n antes de agir, então
      // um `nome` vindo daqui nunca seria usado mesmo. O texto do toast
      // abaixo usa `fluxo.nome` local, que é só UI otimista, não auditoria.
      const r = await acao(fluxo.id);
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
          {/* `Nós` e `Atualizado` em `text-muted-foreground`: numa tela de
              operação as perguntas que importam são "está no ar?" e "a
              última execução falhou?" — as duas primeiras colunas e a
              última. Contagem de nós e data de atualização são contexto que
              alguém consulta depois de já ter reparado num problema, não o
              que decide a varredura inicial. As colunas continuam aqui —
              só não competem pela atenção que Fluxo/Estado/Última execução
              precisam. */}
          <TableHead className="text-muted-foreground">Nós</TableHead>
          <TableHead className="text-muted-foreground">Atualizado</TableHead>
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
            <TableCell className="text-muted-foreground">{fluxo.nos}</TableCell>
            <TableCell className="text-muted-foreground">
              {fluxo.atualizadoEm ? formatarDataHoraBR(new Date(fluxo.atualizadoEm)) : "—"}
            </TableCell>
            <TableCell>
              {fluxo.ultimaExecucao ? (
                <span className="flex items-center gap-1.5">
                  <StatusExecucao status={fluxo.ultimaExecucao.status} />
                  {/* Tempo relativo, não `formatarDataHoraBR`: quem abre esta
                      tela quer saber "rodou agora ou parou faz tempo?", e uma
                      data absoluta obriga a fazer a conta de cabeça. Ver o
                      comentário de `ultimaExecucaoRelativa` acima — o texto já
                      chega pronto do servidor, calculado uma vez só. */}
                  <span className="text-muted-foreground">há {fluxo.ultimaExecucaoRelativa}</span>
                </span>
              ) : (
                "—"
              )}
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
