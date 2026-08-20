import "server-only";

import { FilaVercel } from "./vercel";
import type { FilaTurnos, OpcoesPublicacao, TurnoJob } from "./tipos";

export type { FilaTurnos, OpcoesPublicacao, TurnoJob } from "./tipos";

let instancia: FilaTurnos | null = null;

/**
 * Construção preguiçosa, mesmo raciocínio de `gateway/index.ts`: importar não
 * pode custar nada além do import. Trocar de provedor (pg-boss na VPS, BullMQ)
 * é trocar a linha abaixo, ou lê-la de uma variável tipo `FILA_PROVEDOR` —
 * sem tocar em `ingest.ts`, `turno.ts` ou na rota do webhook, que só conhecem
 * `publicarTurno`.
 */
function obterFila(): FilaTurnos {
  if (instancia) return instancia;
  instancia = new FilaVercel();
  return instancia;
}

/**
 * Mesma assinatura de sempre. Os três importadores existentes
 * (`api/whatsapp/evolution/[companyId]/[token]/route.ts`, `turno.ts` em duas
 * linhas) não
 * mudam: `"./fila"` e `"@/modules/whatsapp/fila"` resolvem para este arquivo.
 */
export async function publicarTurno(job: TurnoJob, opcoes?: OpcoesPublicacao): Promise<void> {
  return obterFila().publicar(job, opcoes);
}
