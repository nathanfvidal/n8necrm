"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { registrarFalhaDeRede, type ResultadoAcao } from "@/lib/acao";
import {
  definirEtapaDeFechamentoAction,
  editarEtapaAction,
  excluirEtapaAction,
  moverEtapaNaOrdemAction,
} from "@/core/pipeline/actions";
import { EditarEtapaDialogo } from "./editar-etapa-dialogo";
import { ExcluirEtapaDialogo } from "./excluir-etapa-dialogo";

/**
 * DTO montado no servidor para ESTA tela. Nenhuma linha crua de
 * `PipelineStage` atravessa a fronteira até `EtapasTable` — mas o quadro do
 * funil (`kanban-board.tsx`, alimentado por `listarEtapas()` em
 * `core/pipeline/stages.ts`) ainda recebe `PipelineStage[]` cru, então a
 * regra não é geral no sistema, é local a este componente. Não é vazamento
 * de dado sensível — `PipelineStage` não tem coluna que não devesse ir para
 * o cliente —, mas nenhum outro lugar precisou de um DTO específico até
 * agora, então este tipo só descreve o que ESTA tela consome.
 */
export type EtapaNaTela = {
  id: string;
  nome: string;
  cor: string;
  ehGanho: boolean;
  /** Leads ativos, como o painel conta. */
  leadsAtivos: number;
  /** Leads que SEGURAM a etapa, arquivados inclusive — o número da chave estrangeira. */
  leadsTotais: number;
};

export function EtapasTable({ etapas }: { etapas: EtapaNaTela[] }) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  /**
   * Vale sobretudo pelas setas de reordenar.
   *
   * `router.refresh()` não é aguardável, então até aqui as setas voltavam a
   * aceitar clique no instante em que a action respondia — mas a tabela só se
   * redesenha quando o render do servidor chega, quase um segundo depois.
   * Nessa janela a etapa aparece na posição ANTIGA, e o segundo clique de
   * quem achou que o primeiro não pegou move a etapa duas casas.
   *
   * Dentro de `startTransition`, `atualizando` só cai quando a tela nova
   * existe. Os diálogos de editar e excluir ficam de fora: eles fecham no
   * sucesso, então não há botão pendurado convidando ao segundo clique.
   */
  const [atualizando, iniciarAtualizacao] = useTransition();

  /**
   * Todo chamador precisa dos DOIS caminhos: `{ ok: false }` é VALOR e chega
   * pelo retorno; queda de rede é EXCEÇÃO e rejeita a promise antes de a action
   * entrar no `try`. Tratar só um deixa o botão voltar ao normal sem dizer nada.
   * Ver `src/lib/acao.ts`.
   *
   * Devolve `boolean` — `true` só no caminho de sucesso — porque `EditarEtapaDialogo`
   * e `ExcluirEtapaDialogo` precisam saber se FECHAM ou não. Sem o retorno, os dois
   * fechavam sempre, e uma recusa da action (nome duplicado, etapa de fechamento sem
   * destino) desaparecia da tela como se tivesse dado certo — o erro ficava só no
   * alerta acima da tabela, que a pessoa pode nem estar olhando. Mesmo padrão de
   * `executar` em `src/components/users/user-table.tsx:45-59`.
   */
  async function executar(acao: () => Promise<ResultadoAcao>, contexto: string): Promise<boolean> {
    setErro(null);
    try {
      const resultado = await acao();
      if (!resultado.ok) {
        setErro(resultado.erro);
        return false;
      }
      iniciarAtualizacao(() => router.refresh());
      return true;
    } catch (erroCapturado) {
      setErro(registrarFalhaDeRede(contexto, erroCapturado));
      return false;
    }
  }

  return (
    <div className="space-y-3">
      {erro && (
        <div role="alert" className="flex items-center justify-between rounded-md border border-destructive/50 p-3 text-sm">
          <span>{erro}</span>
          <Button variant="ghost" size="sm" onClick={() => setErro(null)}>
            Dispensar
          </Button>
        </div>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2">Etapa</th>
            <th className="py-2">Leads</th>
            <th className="py-2">Ordem</th>
            <th className="py-2 text-right">Ações</th>
          </tr>
        </thead>
        <tbody>
          {etapas.map((etapa, indice) => {
            const arquivados = etapa.leadsTotais - etapa.leadsAtivos;
            return (
              <tr key={etapa.id} className="border-b">
                <td className="py-2">
                  <span className="flex items-center gap-2">
                    {/* `style` inline com valor validado no servidor
                        (`/^#[0-9a-f]{6}$/`). Mesma prática do kanban. */}
                    <span
                      className="inline-block h-3 w-3 rounded-full"
                      style={{ backgroundColor: etapa.cor }}
                      aria-hidden
                    />
                    {etapa.nome}
                    {etapa.ehGanho && <Badge>Fechamento</Badge>}
                  </span>
                </td>

                <td className="py-2">
                  {etapa.leadsTotais}
                  {arquivados > 0 && (
                    <span className="text-muted-foreground"> ({etapa.leadsAtivos} ativos)</span>
                  )}
                </td>

                <td className="py-2">
                  <span className="flex gap-1">
                    {indice > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Subir etapa"
                        disabled={atualizando}
                        onClick={() =>
                          executar(
                            () => moverEtapaNaOrdemAction({ etapaId: etapa.id, direcao: "cima" }),
                            "Falha ao subir a etapa"
                          )
                        }
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                    )}
                    {indice < etapas.length - 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Descer etapa"
                        disabled={atualizando}
                        onClick={() =>
                          executar(
                            () => moverEtapaNaOrdemAction({ etapaId: etapa.id, direcao: "baixo" }),
                            "Falha ao descer a etapa"
                          )
                        }
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                    )}
                  </span>
                </td>

                <td className="py-2 text-right">
                  <span className="flex justify-end gap-1">
                    {/* Botão, e não `<input type="radio">`: o rádio sugere que a
                        mudança acontece ao selecionar, quando cada clique é uma
                        ida ao servidor. Um rádio que volta sozinho quando a rede
                        cai é pior que um botão que mostra erro. */}
                    {!etapa.ehGanho && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={atualizando}
                        onClick={() =>
                          executar(
                            () => definirEtapaDeFechamentoAction(etapa.id),
                            "Falha ao marcar a etapa de fechamento"
                          )
                        }
                      >
                        Marcar como fechamento
                      </Button>
                    )}

                    <EditarEtapaDialogo
                      nomeAtual={etapa.nome}
                      corAtual={etapa.cor}
                      onSalvar={(dados) =>
                        executar(
                          () => editarEtapaAction({ etapaId: etapa.id, ...dados }),
                          "Falha ao salvar a etapa"
                        )
                      }
                    />

                    <ExcluirEtapaDialogo
                      nome={etapa.nome}
                      leadsAtivos={etapa.leadsAtivos}
                      leadsTotais={etapa.leadsTotais}
                      destinosPossiveis={etapas
                        .filter((outra) => outra.id !== etapa.id)
                        .map((outra) => ({ id: outra.id, nome: outra.nome }))}
                      onConfirmar={(destinoId) =>
                        executar(
                          () => excluirEtapaAction({ etapaId: etapa.id, destinoId }),
                          "Falha ao remover a etapa"
                        )
                      }
                    />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
