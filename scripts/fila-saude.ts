import "dotenv/config";

import {
  LIMIAR_FILA_PARADA_MS,
  medirSaudeDaFila,
} from "../src/modules/whatsapp/fila/postgres";

/**
 * A vigia da fila, rodada por `n8necrm-saude.timer` a cada 5 minutos.
 *
 * ## O código de saída é a interface
 *
 * `0` saudável, `1` fila parada, `2` erro de infraestrutura. O systemd põe a
 * unit em `failed` para qualquer coisa diferente de 0, então
 * `systemctl --failed` e `systemctl status n8necrm-saude` já contam a história
 * sem ninguém ter escrito integração nenhuma.
 *
 * `1` e `2` são separados porque pedem coisas diferentes de quem lê: `1` é "o
 * worker não está drenando", `2` é "não consegui nem perguntar" (banco fora do
 * ar, variável faltando). Colapsar os dois faria uma queda do Postgres parecer
 * worker morto, e mandaria quem lê procurar no lugar errado.
 *
 * ## `FILA_SAUDE_ALERTA_URL` é o que fecha o laço, e é OPCIONAL
 *
 * Sem ela o alarme existe só em journald e em `systemctl --failed`, onde
 * ninguém está olhando — e uma vigia que ninguém lê vale o mesmo que vigia
 * nenhuma. Ela é opcional mesmo assim porque exigi-la impediria a vigia de
 * subir antes de o destino existir, e vigia parcial vale mais que vigia
 * nenhuma. Ligar a variável está registrado como ação do dono.
 *
 * O destino natural dela é um webhook do n8n, que roda NESTA MESMA MÁQUINA
 * (`127.0.0.1:5678`) e já sabe mandar WhatsApp e e-mail.
 *
 * ## Este script PRECISA de `--conditions=react-server`, e isso foi MEDIDO
 *
 * O plano de deploy de 2026-08-21 previa o contrário -- que a flag fosse
 * dispensável aqui, porque `fila/postgres.ts` não carrega `server-only` (o
 * cabeçalho daquele arquivo de fato registra essa divisão, e ela é
 * verdadeira). A previsão estava errada por um elo: `fila/postgres.ts` importa
 * `@/lib/prisma`, e é `src/lib/prisma.ts:9` que faz `import "server-only"`.
 * Rodando sem a flag, em 2026-08-21:
 *
 *     $ npx tsx scripts/fila-saude.ts
 *     Error: This module cannot be imported from a Client Component module.
 *       at <anonymous> (src/lib/prisma.ts:9:8)
 *
 * Por isso a vigia se invoca por `npm run fila:saude`, que carrega a flag, e
 * `n8necrm-saude.service` tem de chamá-la assim -- exatamente como
 * `n8necrm-worker` faz com `npm run fila:worker`.
 */
async function principal(): Promise<number> {
  const saude = await medirSaudeDaFila();

  const parada =
    saude.idadeDoMaisVelhoMs !== null && saude.idadeDoMaisVelhoMs > LIMIAR_FILA_PARADA_MS;

  const linha =
    `fila: prontos=${saude.prontos} ` +
    `maisVelhoMs=${saude.idadeDoMaisVelhoMs ?? "-"} ` +
    `mortosNaUltimaHora=${saude.mortosRecentes} ` +
    `limiarMs=${LIMIAR_FILA_PARADA_MS}`;

  if (!parada) {
    console.log(`OK  ${linha}`);
    return 0;
  }

  const alerta =
    `FILA PARADA. ${linha}. ` +
    "O worker (n8necrm-worker) nao esta drenando: mensagem de WhatsApp entra e ninguem responde. " +
    "Conferir: systemctl status n8necrm-worker e journalctl -u n8necrm-worker -n 50";

  console.error(`FALHA  ${alerta}`);

  const destino = process.env.FILA_SAUDE_ALERTA_URL?.trim();
  if (destino) {
    try {
      // Sem retry: o systemd chama de novo em 5 minutos. Um retry aqui
      // atrasaria a saída do processo e deixaria a unit em "activating"
      // enquanto a fila continua parada.
      const resposta = await fetch(destino, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ origem: "n8necrm-saude", alerta, ...saude }),
        signal: AbortSignal.timeout(10_000),
      });
      console.error(`alerta enviado: HTTP ${resposta.status}`);
    } catch (erro) {
      // Falhar em ALERTAR não muda o diagnóstico: o código de saída continua
      // 1 (fila parada), não 2 — o problema segue sendo a fila.
      console.error("alerta NAO enviado:", erro);
    }
  }

  return 1;
}

principal()
  .then((codigo) => process.exit(codigo))
  .catch((erro) => {
    console.error("ERRO ao medir a saude da fila:", erro);
    process.exit(2);
  });
