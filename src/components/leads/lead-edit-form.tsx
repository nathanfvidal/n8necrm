"use client";

import { useState, useTransition } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ConfirmarDialogo } from "@/components/confirmar-dialogo";
import { CampoDinheiro } from "./campo-dinheiro";
import {
  atualizarLeadAction,
  arquivarLeadAction,
  desarquivarLeadAction,
} from "@/core/leads/actions";

/**
 * `valorEstimado` não é validado por formato aqui de propósito: `CampoDinheiro`
 * só produz texto já mascarado, e a regra estrita de verdade mora em
 * `parseValorBR` (servidor). Um schema client-side que tentasse repetir a
 * expressão regular poderia DIVERGIR dela — e divergir para o lado estrito
 * recusaria no cliente um valor que o servidor aceitaria.
 *
 * String vazia significa "sem valor" e vira `null` no envio.
 */
const schema = z.object({
  valorEstimado: z.string(),
  responsavelId: z.string().min(1, "Escolha o responsável"),
  stageId: z.string().min(1, "Escolha a etapa"),
});

type FormValues = z.infer<typeof schema>;

export type LeadEditavel = {
  id: string;
  /** Já convertido com `.toString()` — `Decimal` não atravessa a fronteira. */
  valorEstimado: string | null;
  responsavelId: string | null;
  stageId: string;
  arquivadoEm: Date | null;
};

/**
 * Edição de valor, responsável e etapa de um lead, mais arquivar/desarquivar.
 *
 * Componente próprio, e não uma prop `lead?` em `LeadForm` (como a spec
 * chegou a propor): `LeadForm` cria contato E lead — nome, telefone, e-mail —
 * e a edição mexe em valor, responsável e etapa. Conjuntos de campos
 * disjuntos; um componente com os dois teria metade dos campos inertes em
 * cada modo.
 *
 * As actions devolvem `ResultadoAcao` em vez de lançar, então o erro chega
 * como dado e vira mensagem na tela — ver `src/lib/acao.ts`.
 */
export function LeadEditForm({
  lead,
  vendedores,
  etapas,
  valorFormatado,
}: {
  lead: LeadEditavel;
  vendedores: { id: string; nome: string }[];
  etapas: { id: string; nome: string }[];
  /** `formatarValorBR(lead.valorEstimado)` — feito no servidor. */
  valorFormatado: string;
}) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);
  const [arquivando, setArquivando] = useState(false);
  /**
   * Uma transição só para os dois caminhos (salvar e arquivar): enquanto o
   * servidor não devolve a tela nova, NENHUM dos dois botões deve convidar a
   * um segundo clique — arquivar em cima de um salvamento que ainda está
   * chegando é justamente a corrida que a tela não sabe resolver.
   *
   * Só o `disabled` do botão de arquivar entra nisso; o RÓTULO dele não pode
   * mudar. `lead-edicao.spec.ts` o localiza por
   * `getByRole("button", { name: "Arquivar", exact: true })`, e o `exact`
   * existe porque "Arquivar" é substring de "Desarquivar" — trocar o texto
   * por "Arquivando..." quebraria a busca. Botão desabilitado o Playwright
   * espera ficar disponível; botão renomeado ele nunca acha.
   */
  const [atualizando, iniciarAtualizacao] = useTransition();

  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      valorEstimado: valorFormatado,
      responsavelId: lead.responsavelId ?? "",
      stageId: lead.stageId,
    },
  });

  async function onSubmit(dados: FormValues) {
    setErro(null);
    setSucesso(false);

    const resultado = await atualizarLeadAction({
      leadId: lead.id,
      // Campo vazio é "limpe o valor", não "zero" — por isso `null` e não "0".
      valorEstimado: dados.valorEstimado.trim() || null,
      responsavelId: dados.responsavelId,
      stageId: dados.stageId,
    });

    if (!resultado.ok) {
      setErro(resultado.erro);
      return;
    }
    setSucesso(true);
    iniciarAtualizacao(() => router.refresh());
  }

  async function alternarArquivamento() {
    const arquivado = lead.arquivadoEm !== null;
    setErro(null);
    setSucesso(false);
    setArquivando(true);
    const resultado = arquivado
      ? await desarquivarLeadAction({ leadId: lead.id })
      : await arquivarLeadAction({ leadId: lead.id });
    setArquivando(false);

    if (!resultado.ok) {
      setErro(resultado.erro);
      return;
    }
    iniciarAtualizacao(() => router.refresh());
  }

  return (
    <div className="space-y-3 rounded border p-4">
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-wrap items-end gap-3">
        <Controller
          control={control}
          name="valorEstimado"
          render={({ field }) => (
            <CampoDinheiro
              label="Valor estimado"
              value={field.value}
              onChange={field.onChange}
            />
          )}
        />

        <div className="space-y-1">
          <Label htmlFor="responsavelId">Responsável</Label>
          <select
            id="responsavelId"
            {...register("responsavelId")}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
          >
            {vendedores.map((vendedor) => (
              <option key={vendedor.id} value={vendedor.id}>
                {vendedor.nome}
              </option>
            ))}
          </select>
          {errors.responsavelId && (
            <p className="text-xs text-red-600">{errors.responsavelId.message}</p>
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor="stageId">Etapa</Label>
          <select
            id="stageId"
            {...register("stageId")}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
          >
            {etapas.map((etapa) => (
              <option key={etapa.id} value={etapa.id}>
                {etapa.nome}
              </option>
            ))}
          </select>
          {errors.stageId && <p className="text-xs text-red-600">{errors.stageId.message}</p>}
        </div>

        <Button type="submit" disabled={isSubmitting || atualizando}>
          {isSubmitting || atualizando ? "Salvando..." : "Salvar"}
        </Button>
      </form>

      <div className="flex items-center gap-3">
        {/* Arquivar tira o lead da lista, do kanban e do painel — uma ação que
            faz algo sumir de quatro telas merece confirmação. Desarquivar não
            precisaria, mas confirmar os dois mantém o botão previsível.

            ─── Os dois rótulos NÃO podem ser iguais ───

            `lead-edicao.spec.ts` localiza o gatilho por
            `getByRole("button", { name: "Arquivar", exact: true })`, e o
            `exact` existe porque "Arquivar" é substring de "Desarquivar". Com
            o diálogo aberto, gatilho e confirmação coexistem no DOM: se o
            botão do diálogo também se chamasse "Arquivar", o localizador
            passaria a casar com dois elementos e o teste morreria por modo
            estrito — falha que se parece com defeito de aplicação e não é.
            Daí "Arquivar lead" / "Devolver ao funil" na confirmação. */}
        <ConfirmarDialogo
          gatilho={(abrir) => (
            <Button type="button" variant="outline" onClick={abrir} disabled={arquivando || atualizando}>
              {lead.arquivadoEm ? "Desarquivar" : "Arquivar"}
            </Button>
          )}
          titulo={lead.arquivadoEm ? "Devolver este lead ao funil?" : "Arquivar este lead?"}
          descricao={
            lead.arquivadoEm
              ? "Ele volta a aparecer na lista, no kanban e nas somas do painel."
              : "Ele sai da lista, do kanban e do painel, mas continua no histórico do contato."
          }
          rotuloConfirmar={lead.arquivadoEm ? "Devolver ao funil" : "Arquivar lead"}
          rotuloConfirmando={lead.arquivadoEm ? "Devolvendo..." : "Arquivando..."}
          onConfirmar={alternarArquivamento}
        />
        {lead.arquivadoEm && (
          <span className="text-sm text-muted-foreground">
            Arquivado — fora do funil e das somas do painel.
          </span>
        )}
      </div>

      {erro && (
        <p role="alert" className="text-sm text-red-600">
          {erro}
        </p>
      )}
      {sucesso && !erro && <p className="text-sm text-green-600">Lead salvo.</p>}
    </div>
  );
}
