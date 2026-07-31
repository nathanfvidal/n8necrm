import net from "node:net";

/**
 * Roda antes de `playwright test` (ver script "test:e2e" no package.json).
 *
 * playwright.config.ts usa `reuseExistingServer: !process.env.CI`. Isso é
 * correto para não matar um servidor que já é do desenvolvedor — mas tem um
 * efeito colateral perigoso: se QUALQUER coisa já estiver respondendo na
 * porta 3000 quando `npm run test:e2e` roda, o Playwright pula
 * `npm run build && npm run start` por inteiro e testa o que já estiver lá
 * (ver node_modules/@playwright/test/lib/runner/... WebServerPlugin,
 * `_isAvailableCallback` + `reuseExistingServer` → `return` sem rodar
 * `command`). Como a Task 11 optou por testar contra build de produção (não
 * `next dev`), um processo reaproveitado é um build CONGELADO — pode não ter
 * nenhuma mudança recente do desenvolvedor — e nada no reporter padrão avisa
 * disso; só aparece em log de debug (`DEBUG=pw:webserver`), que ninguém liga
 * por padrão. Teste verde nessas condições não prova nada.
 *
 * Este guard falha rápido e alto ANTES do Playwright decidir reaproveitar
 * ou não, então o desenvolvedor descobre pelo próprio `npm run test:e2e`,
 * sem precisar ler config nem ligar debug flag. Roda também em CI: inofensivo
 * lá, porque um runner efêmero não deveria ter nada na porta 3000 de
 * antemão — se tiver, é sinal de outro problema, não motivo pra rodar os
 * testes mesmo assim.
 */

const PORT = 3000;
const HOST = "localhost";
const CONNECT_TIMEOUT_MS = 1000;

function isPortOccupied(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    const finish = (result: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function main() {
  const occupied = await isPortOccupied(PORT, HOST);
  if (!occupied) return;

  const linha = "=".repeat(78);
  console.error(`\n${linha}`);
  console.error(`ERRO: já existe algo respondendo em http://${HOST}:${PORT}.`);
  console.error("");
  console.error("playwright.config.ts usa reuseExistingServer fora de CI: com a porta");
  console.error("ocupada, o Playwright NUNCA roda `npm run build && npm run start` — ele");
  console.error("reaproveita silenciosamente o processo que já está lá. Se for um build");
  console.error("antigo, os testes e2e rodam contra código CONGELADO, sem nenhum aviso.");
  console.error("");
  console.error(`Encerre o que estiver escutando na porta ${PORT} (dev server esquecido,`);
  console.error("`next start` de uma execução anterior, etc.) e rode `npm run test:e2e`");
  console.error("de novo.");
  console.error(`${linha}\n`);
  process.exit(1);
}

void main();
