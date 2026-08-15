import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type EtapaResumo = {
  id: string;
  nome: string;
  total: number;
  cor: string;
  ehGanho: boolean;
};

/**
 * Um cartão por etapa do funil, na mesma ordem em que `listarEtapas()`
 * (`core/pipeline/stages.ts`) devolve — quem monta `etapas` (a página do
 * dashboard) já preserva essa ordem, este componente só renderiza.
 *
 * Sem "use client": não tem estado nem handler nenhum, então roda como
 * Server Component (Next 16 só exige a diretiva para o que realmente
 * precisa de runtime de cliente — ver `node_modules/next/dist/docs`).
 *
 * A etapa `ehGanho` (exatamente uma; a posição dela no funil é escolhida em
 * `/etapas`) ganha um rótulo "Ganho" ao lado do nome — é a etapa que alimenta a taxa
 * de conversão logo abaixo (`page.tsx`), então vale marcar visualmente qual
 * cartão é essa, em vez de deixar a pessoa que olha o dashboard adivinhar.
 */
export function StageSummary({ etapas }: { etapas: EtapaResumo[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-[repeat(auto-fit,minmax(8rem,1fr))]">
      {etapas.map((etapa) => (
        <Card key={etapa.id} data-testid="cartao-de-etapa">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm font-medium" style={{ color: etapa.cor }}>
              {etapa.nome}
              {etapa.ehGanho && (
                <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                  Ganho
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{etapa.total}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
