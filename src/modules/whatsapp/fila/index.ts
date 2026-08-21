import "server-only";

import { FilaPostgres } from "./postgres";
import type { FilaTurnos, OpcoesPublicacao, TurnoJob } from "./tipos";

export type { FilaTurnos, OpcoesPublicacao, TurnoJob } from "./tipos";

let instancia: FilaTurnos | null = null;

/**
 * Construção preguiçosa, mesmo raciocínio de `gateway/index.ts`: importar não
 * pode custar nada além do import.
 *
 * A troca de provedor que este comentário previa em 2026-08-19 — "pg-boss na
 * VPS, BullMQ" — ACONTECEU em 2026-08-21, e foi mesmo trocar esta linha: os
 * três importadores de `publicarTurno` (a rota do webhook e `turno.ts`, em duas
 * linhas) não mudaram. O que sobrou de acoplamento era o
 * `DuplicateMessageError` importado FORA daqui, e ele morreu junto — hoje
 * duplicata é no-op dentro do adaptador (`./postgres.ts`).
 *
 * O provedor escolhido não foi nenhum dos dois nomeados: é o Postgres que o
 * projeto já tem, sem infra nova. O motivo está no spec do Ciclo 2d, §1.
 */
function obterFila(): FilaTurnos {
  if (instancia) return instancia;
  instancia = new FilaPostgres();
  return instancia;
}

/**
 * Mesma assinatura de sempre, e é esse o ponto: `"./fila"` e
 * `"@/modules/whatsapp/fila"` continuam resolvendo para este arquivo.
 */
export async function publicarTurno(job: TurnoJob, opcoes?: OpcoesPublicacao): Promise<void> {
  return obterFila().publicar(job, opcoes);
}
