import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * As units do systemd são testadas como TEXTO, porque é como texto que elas
 * falham.
 *
 * Nada aqui roda systemd — a prova de que ele ACEITA estes arquivos é
 * `systemd-analyze verify` na VPS, antes de habilitar qualquer unit, e não
 * cabe a um teste unitário. O que estes casos protegem são decisões que, se
 * alguém apagar numa edição futura, produzem falhas que não aparecem em teste
 * nenhum e se manifestam só em produção — a maioria delas em silêncio.
 */
const web = readFileSync("deploy/systemd/n8necrm-web.service", "utf8");
const worker = readFileSync("deploy/systemd/n8necrm-worker.service", "utf8");
const saude = readFileSync("deploy/systemd/n8necrm-saude.service", "utf8");
const timer = readFileSync("deploy/systemd/n8necrm-saude.timer", "utf8");

describe("units do systemd", () => {
  it("o servidor escuta SÓ no laço local — a VPS não tem firewall ativo", () => {
    // Medido em 2026-08-21: `ufw status` responde "Status: inactive". Escutar
    // em qualquer endereço poria a aplicação na internet sem passar pelo
    // nginx, e com isso cairia a sobrescrita de X-Real-IP -- a única coisa que
    // torna IP_CABECALHO_CONFIAVEL confiável (ver o bloco daquela variável em
    // `.env.example`). Quem falasse direto com a porta escreveria o X-Real-IP
    // que quisesse, e o AuditLog passaria a guardar IP forjado apontando para
    // a pessoa errada -- pior que campo vazio.
    //
    // O endereço curinga NÃO é soletrado neste comentário, de propósito: a
    // segunda asserção é varredura de texto cru e casaria com quem só o
    // MENCIONA. É a mesma armadilha que `.env.example` já registra para o
    // prefixo público do JWK, e que derrubou aquele bloco na primeira redação.
    expect(web).toContain("-H 127.0.0.1");
    expect(web).not.toContain("0.0.0.0");
  });

  it("o worker carrega --conditions=react-server", () => {
    // Sem a condição, `server-only` é um throw de uma linha e o processo morre
    // na PRIMEIRA linha importada. Medido no Ciclo 2d. A falha é alta e
    // imediata, mas a unit tem Restart=always: sem este caso, um erro de
    // digitação aqui vira laço de reinício com o WhatsApp mudo, que ninguém
    // nota até abrir o journal.
    expect(worker).toContain("--conditions=react-server");
  });

  it("a vigia TAMBÉM carrega --conditions=react-server", () => {
    // O plano de deploy previa que a vigia dispensasse a flag, porque
    // `fila/postgres.ts` não carrega `server-only`. Errado por um elo, medido
    // em 2026-08-21: aquele arquivo importa `@/lib/prisma`, e
    // `src/lib/prisma.ts:9` é que faz `import "server-only"`. Sem a flag a
    // vigia sai com código 1 SEMPRE -- e código 1 é justamente o que ela usa
    // para dizer "fila parada". Uma vigia quebrada que grita "fila parada" a
    // cada 5 minutos é pior que vigia nenhuma: ensina quem lê a ignorá-la.
    expect(saude).toContain("--conditions=react-server");
  });

  it("as duas units permanentes desligam o limite de reinício do systemd", () => {
    // O PADRÃO do systemd é: 5 reinícios em 10s põem a unit em `failed`, e ela
    // para de tentar para sempre. Para o worker isso é o pior modo de falha
    // deste projeto -- WhatsApp mudo sem erro em lugar nenhum -- travado
    // permanentemente por um soluço de rede de 30 segundos.
    expect(web).toContain("StartLimitIntervalSec=0");
    expect(worker).toContain("StartLimitIntervalSec=0");
    expect(web).toContain("Restart=always");
    expect(worker).toContain("Restart=always");
  });

  it("a vigia NÃO reinicia sozinha — reiniciar mascararia o que ela reporta", () => {
    // Ela é `oneshot` disparada por timer. `Restart=` aqui faria a unit tentar
    // de novo e, no caso em que a fila está parada de verdade, sair de
    // `failed` sozinha -- apagando o sintoma que `systemctl --failed` deveria
    // mostrar.
    expect(saude).toContain("Type=oneshot");
    expect(saude).not.toMatch(/^Restart=/m);
  });

  it("as três units leem o mesmo arquivo de ambiente, e nenhuma embute segredo", () => {
    // Duas fontes de verdade para segredo é família de defeito já catalogada
    // neste projeto. E `Environment=` com valor aparece em `systemctl show`
    // para qualquer usuário do sistema; o conteúdo de `EnvironmentFile=` não.
    for (const unit of [web, worker, saude]) {
      expect(unit).toContain("EnvironmentFile=/etc/n8necrm/n8necrm.env");
    }
    // `Environment=` só é permitido para valor NÃO secreto. A lista é branca,
    // e não uma proibição de nomes suspeitos: lista negra deixaria passar
    // qualquer variável nova que entrasse no projeto depois.
    const linhasDeAmbiente = [web, worker, saude]
      .flatMap((u) => u.split("\n"))
      .filter((l) => l.startsWith("Environment="));
    expect(linhasDeAmbiente.length).toBeGreaterThan(0);
    for (const linha of linhasDeAmbiente) {
      expect(linha).toMatch(/^Environment=(NODE_ENV|TZ|NODE_OPTIONS)=/);
    }
  });

  it("o timer da vigia dispara mesmo depois de a máquina ficar desligada", () => {
    // `Persistent=true` faz o systemd rodar a execução perdida assim que a
    // máquina volta. Sem ele, um reboot de madrugada adia a verificação --
    // justamente na janela em que o worker pode não ter subido.
    expect(timer).toContain("Persistent=true");
    expect(timer).toContain("OnUnitActiveSec=5min");
  });
});
