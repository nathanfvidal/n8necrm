import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Os scripts de deploy são testados como TEXTO. Nada aqui executa shell.
 *
 * `bash -n` prova que eles ANALISAM; estes casos provam decisões que analisam
 * perfeitamente e estão erradas — ordem de operações, segredo vazando para o
 * journal, rollback que só existe na documentação.
 */
const deploy = readFileSync("deploy/deploy.sh", "utf8");
const bootstrap = readFileSync("deploy/bootstrap.sh", "utf8");
const exemplo = readFileSync("deploy/n8necrm.env.exemplo", "utf8");

/** Linhas de código: fora comentário e fora linha em branco. */
function linhasDeCodigo(script: string): string[] {
  return script
    .split("\n")
    .filter((l) => l.trim() !== "" && !l.trim().startsWith("#"));
}

describe("scripts de deploy", () => {
  it("nenhum dos dois usa `set -x`", () => {
    // Os dois carregam /etc/n8necrm/n8necrm.env no PRÓPRIO ambiente. `set -x`
    // imprimiria cada valor no journal, onde ele fica para sempre e é legível
    // por quem puder ler o journal -- um vazamento que nada acusa.
    expect(deploy).not.toMatch(/^\s*set\s+-[a-z]*x/m);
    expect(bootstrap).not.toMatch(/^\s*set\s+-[a-z]*x/m);
  });

  it("nenhum dos dois imprime o ambiente", () => {
    expect(deploy).not.toMatch(/^\s*(env|printenv)\s*$/m);
    expect(deploy).not.toMatch(/cat\s+.*n8necrm\.env/);
    expect(bootstrap).not.toMatch(/cat\s+.*n8necrm\.env(?!\.exemplo)/);
  });

  it("nenhuma CRASE fora de comentário — ela é substituição de comando", () => {
    // Este caso existe por um defeito real, achado na auto-revisão do plano de
    // deploy: duas mensagens de erro escritas como
    // `falhar "... \`prisma migrate\` pendura ..."` EXECUTARIAM `prisma
    // migrate` ao montar a mensagem -- dentro de aspas duplas a crase é
    // substituição de comando, não citação de código. O modo de falha é
    // perverso: acontece só no caminho de erro, que é justamente o menos
    // testado, e roda uma migração no meio de um deploy que já está falhando.
    //
    // A varredura ignora comentários porque em comentário a crase é inerte, e
    // proibi-la lá custaria a legibilidade de todo o arquivo.
    for (const [nome, script] of [
      ["deploy.sh", deploy],
      ["bootstrap.sh", bootstrap],
    ] as const) {
      const suspeitas = linhasDeCodigo(script).filter((l) => l.includes("`"));
      expect(suspeitas, `crase em código de ${nome}`).toEqual([]);
    }
  });

  it("os dois começam com shebang", () => {
    expect(deploy.startsWith("#!/usr/bin/env bash")).toBe(true);
    expect(bootstrap.startsWith("#!/usr/bin/env bash")).toBe(true);
  });

  it("o modelo de ambiente não tem VALOR nenhum", () => {
    // Ele é versionado e vai junto com o repositório. Toda linha de variável
    // termina em `=` ou `=""`, e nada mais -- os valores são preenchidos à mão
    // na VPS, no arquivo 0600 que nunca sai de lá.
    const linhas = exemplo.split("\n").filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l));
    expect(linhas.length).toBeGreaterThan(10);
    for (const linha of linhas) {
      expect(linha).toMatch(/^[A-Z_][A-Z0-9_]*=("")?$/);
    }
  });

  it("o modelo inventaria as variáveis sem as quais o CRM sobe QUEBRADO", () => {
    // Não é lista completa (o `.env.example` da raiz é a fonte do significado):
    // são as quatro cuja ausência produz um CRM que sobe, responde, e falha em
    // silêncio ou num caminho só. AUTH_URL/AUTH_TRUST_HOST derrubam todo login
    // com UntrustedHost; COFRE_CHAVE_MESTRA desliga o WhatsApp inteiro;
    // IP_CABECALHO_CONFIAVEL faz o AuditLog gravar IP nulo.
    for (const nome of [
      "AUTH_URL",
      "AUTH_TRUST_HOST",
      "COFRE_CHAVE_MESTRA",
      "IP_CABECALHO_CONFIAVEL",
    ]) {
      expect(exemplo).toMatch(new RegExp(`^${nome}=`, "m"));
    }
  });

  it("a migração roda DEPOIS do build e ANTES da troca do symlink", () => {
    // A ordem É a decisão. Migrar antes do build altera o banco por um build
    // que pode falhar; migrar depois da troca abre uma janela em que o código
    // novo consulta coluna que ainda não existe.
    const iBuild = deploy.indexOf("npm run build");
    const iMigrate = deploy.indexOf("migrate deploy");
    const iSymlink = deploy.indexOf("ln -sfn");
    expect(iBuild).toBeGreaterThan(-1);
    expect(iMigrate).toBeGreaterThan(iBuild);
    expect(iSymlink).toBeGreaterThan(iMigrate);
  });

  it("o deploy falha se houver .env dentro do release", () => {
    // Duas fontes de verdade para segredo. Pior: o Next leria o .env do
    // diretório EM VEZ de partes do EnvironmentFile, em silêncio, e a VPS
    // passaria a rodar com valores que ninguém sabe de onde vieram.
    expect(deploy).toMatch(/\$NOVO\/\.env/);
  });

  it("o deploy confere o major do Node", () => {
    // Metade da defesa contra a falta de isolamento de runtime do systemd no
    // host; a outra metade é o `engines` do package.json. Esta metade FALHA,
    // a do npm só avisa.
    expect(deploy).toContain("22");
    expect(deploy).toMatch(/node\s+(-v|--version)/);
  });

  it("o deploy confere as portas 6543 e 5432, em vez de contar com a memória", () => {
    // A confusão mais cara deste projeto: trocar as duas faz `prisma migrate`
    // ficar PENDURADO sem imprimir nada -- parece lentidão, é falha. Checar é
    // barato; lembrar, não.
    expect(deploy).toContain("6543");
    expect(deploy).toContain("5432");
  });

  it("o rollback do symlink está no script, não só na documentação", () => {
    // Rollback que depende de alguém lembrar do comando não é rollback.
    expect(deploy).toContain("ANTERIOR");
    expect(deploy).toMatch(/ln -sfn "\$ANTERIOR"/);
  });

  it("o script diz que a MIGRAÇÃO não volta junto com o symlink", () => {
    // O rollback é parcial e isso precisa estar na tela de quem acabou de
    // revertê-lo, não num documento. O Prisma não tem migração de volta, e
    // desfazer schema automaticamente perderia dado.
    expect(deploy).toMatch(/MIGRACAO nao/);
  });
});
