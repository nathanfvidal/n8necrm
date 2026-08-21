import "dotenv/config";

import { drenarFila, LOTE_MAX_PADRAO } from "../src/modules/whatsapp/fila/consumidor";

/**
 * O gatilho da fila que NÃO depende de rede.
 *
 * ## Por que ele existe ao lado do endpoint HTTP
 *
 * A hospedagem deste projeto está em aberto. O endpoint
 * (`src/app/api/queues/whatsapp-turn/route.ts`) serve a quem for acionar de
 * fora — `pg_cron`+`pg_net`, `cron`+`curl`, um agendador de plataforma. Este
 * script serve a quem tiver um Node sempre ligado, e é a opção com **menor
 * superfície**: não abre porta nenhuma, então quem o usar pode deixar a rota
 * inacessível de fora e a fila continua funcionando.
 *
 * É também a opção com **menor latência**. A janela de buffer é de 8s; com este
 * laço a 2s a resposta sai em ~8-10s, praticamente igual ao que a Vercel
 * entregava. Um `cron` de um minuto entregaria a mesma resposta em até ~68s.
 *
 * ## Sem `while (true) { await sleep }` cego
 *
 * Quando `drenarFila` devolve `esgotou: false`, ainda há trabalho pronto: o
 * laço volta IMEDIATAMENTE, sem dormir. Dormir depois de um lote cheio
 * introduziria atraso proporcional ao tamanho da fila justamente quando ela
 * está grande.
 *
 * ## `dotenv/config` como primeiro import
 *
 * Este processo roda fora do Next, que carrega `.env` sozinho. Sem isto,
 * `src/lib/env.ts` — que lê `DATABASE_URL` no escopo do módulo — derruba o
 * processo na importação. Mesmo padrão de `tests/unit/rate-limit.test.ts`.
 *
 * ## Por que o script npm passa `--conditions=react-server`
 *
 * Sem essa flag este arquivo NÃO SOBE, e a falha é na primeira linha
 * importada — medido nesta tarefa, não presumido:
 *
 *     $ npx tsx scripts/fila-worker.ts
 *     Error: This module cannot be imported from a Client Component module.
 *         at ... src/modules/whatsapp/turno.ts:1:8
 *
 * `node_modules/server-only/index.js` é um `throw` de uma linha, e o `exports`
 * do pacote só desvia para o `empty.js` inofensivo sob a condição
 * `react-server`. O Next aplica essa condição em componente de servidor; `tsx`,
 * sozinho, não aplica nenhuma. E `turno.ts` — junto com boa parte do que ele
 * arrasta (`llm/`, `gateway/`, `notificacoes.ts`, `core/cofre/`) — carrega a
 * marcação, de propósito.
 *
 * A flag é a resposta CERTA e não um contorno: este processo é servidor, é
 * exatamente o que a condição afirma. A alternativa — arrancar `server-only` de
 * uma dúzia de módulos — trocaria uma flag por perder a proteção do lado do
 * Next, que é onde ela vale.
 *
 * `tests/unit/fila-worker.test.ts` trava as duas pontas: que o script carrega a
 * flag, e que o grafo daqui ainda tem quem a exija (se um dia não tiver, o
 * teste manda tirar a flag em vez de deixá-la de herança).
 *
 * ## Um processo por vez não é exigido
 *
 * Dois workers em máquinas diferentes são CORRETOS por construção: a
 * reivindicação é um `UPDATE` condicional atômico e o caso "N reivindicações
 * concorrentes devolvem ids distintos" (`tests/unit/fila-postgres.test.ts`) o
 * prova contra o Postgres real. 🔍 NÃO VERIFICADO: dois PROCESSOS Node
 * simultâneos, medidos. Um humano roda `npm run fila:worker` em dois terminais
 * e confere que nenhuma conversa recebe resposta duplicada.
 */

const INTERVALO_OCIOSO_MS = 2_000;

let parando = false;

for (const sinal of ["SIGINT", "SIGTERM"] as const) {
  /**
   * Encerramento limpo, dito com o limite exato que o código entrega.
   *
   * O sinal para de pegar LOTE novo, não job novo: `parando` é lido entre uma
   * chamada de `drenarFila` e a seguinte, então o lote em curso vai até o fim —
   * no pior caso `LOTE_MAX_PADRAO` turnos de até `TEMPO_MAX_TURNO_MS` cada. Um
   * segundo Ctrl+C é a saída de emergência, e sai na hora.
   *
   * Sair no meio não deixa job PRESO, e isso é garantia da Tarefa 2, não deste
   * arquivo: a reivindicação grava `leaseAte = agora + JOB_LEASE_MS`, e o
   * subselect de `reivindicarJob` já trata `"leaseAte" < agora` como
   * reivindicável. O job volta sozinho depois de no máximo 90s. O que se perde
   * matando na marra é esse tempo, e a tentativa de entrega que já foi contada
   * (`tentativasEntrega` sobe na reivindicação, de propósito — é o que faz job
   * envenenado morrer).
   */
  process.on(sinal, () => {
    if (parando) process.exit(1);
    parando = true;
    console.log(
      `\n${sinal} recebido: terminando o lote em curso (ate ${LOTE_MAX_PADRAO} turnos) e saindo. ` +
        `Ctrl+C de novo sai na hora — o lease do job em curso expira em ate 90s e ele volta pra fila.`
    );
  });
}

function dormir(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

async function principal(): Promise<void> {
  console.log("Worker da fila de turnos iniciado. Ctrl+C para sair.");

  while (!parando) {
    try {
      const resultado = await drenarFila();
      if (resultado.processados || resultado.falhados || resultado.mortos) {
        console.log(
          `drenagem: ${resultado.processados} processados, ${resultado.falhados} falhados, ` +
            `${resultado.mortos} mortos`
        );
      }
      if (resultado.esgotou) await dormir(INTERVALO_OCIOSO_MS);
    } catch (erro) {
      // O laço NÃO morre por erro de uma volta. `drenarFila` já trata falha de
      // turno; o que chega aqui é falha de infraestrutura (banco fora do ar),
      // e nesse caso a resposta certa é esperar e tentar de novo, não sair —
      // um worker que morre no primeiro soluço de rede é um worker que exige
      // supervisor para tudo.
      console.error("Falha na drenagem da fila:", erro);
      await dormir(INTERVALO_OCIOSO_MS);
    }
  }

  console.log("Worker da fila encerrado.");
  process.exit(0);
}

void principal();
