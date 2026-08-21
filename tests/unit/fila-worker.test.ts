// A trava do gatilho que roda fora do Next.
//
// ## O defeito que ela existe para impedir
//
// `scripts/fila-worker.ts` roda sob `tsx`, um Node comum. `server-only` é um
// pacote de UMA linha que faz `throw` (`node_modules/server-only/index.js`), e
// o `exports` dele só desvia para o `empty.js` inofensivo sob a condição
// `react-server` — condição que o Next aplica em componente de servidor e que
// `tsx`, sozinho, não aplica.
//
// Isto não é hipótese. Medido na Tarefa 5 deste ciclo, com o script sem a flag:
//
//     $ npx tsx scripts/fila-worker.ts
//     Error: This module cannot be imported from a Client Component module.
//         at ... src/modules/whatsapp/turno.ts:1:8
//
// O processo morria antes de imprimir uma linha. Com
// `tsx --conditions=react-server`, sobe e drena. A falha é de IMPORTAÇÃO, então
// nenhum teste que exercite `drenarFila` a pega — só um que olhe o comando.
//
// ## Por que as DUAS pontas
//
// Uma flag que ninguém mais precisa é herança: fica no comando para sempre,
// ninguém sabe dizer por quê, e a próxima pessoa a mexer não tem como
// descobrir se pode tirar. O segundo caso mede a necessidade em vez de
// afirmá-la — se um dia o grafo do worker não alcançar mais nenhum
// `server-only`, ele reprova e manda tirar a flag.
//
// A varredura é do TEXTO, e não uma importação de verdade, pelo mesmo motivo de
// `catraca-prisma-cru.test.ts`: importar o grafo alcançaria `@/lib/prisma`, que
// instancia o PrismaClient no escopo do módulo, e faria este arquivo — que não
// toca banco — passar a exigir `DATABASE_URL`.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { describe, it, expect } from "vitest";

import { semComentarios } from "./helpers/codigo-fonte";

const RAIZ = resolve(__dirname, "../..");
const WORKER = resolve(RAIZ, "scripts/fila-worker.ts");

function relativoPosix(caminho: string): string {
  return caminho.replace(/\\/g, "/").replace(`${RAIZ.replace(/\\/g, "/")}/`, "");
}

/**
 * Resolve um especificador de import para um arquivo do PROJETO, ou `null`
 * quando ele é um pacote de `node_modules`.
 *
 * Cobre as duas formas que a base usa: relativa (`../src/...`, `./postgres`) e
 * o alias `@/` do `tsconfig.json`, que aponta para `src/`. Um especificador que
 * não é nenhuma das duas é dependência externa, e a varredura não entra nela —
 * o que importa aqui é o código NOSSO que o worker arrasta.
 */
function resolverParaArquivo(especificador: string, arquivoQueImporta: string): string | null {
  let base: string;
  if (especificador.startsWith("@/")) {
    base = resolve(RAIZ, "src", especificador.slice(2));
  } else if (especificador.startsWith(".")) {
    base = resolve(dirname(arquivoQueImporta), especificador);
  } else {
    return null;
  }

  // `${base}` sem extensão vem antes porque um import pode já trazê-la; e
  // `statSync().isFile()` porque `existsSync` também acerta em DIRETÓRIO — o
  // caso real é `./fila`, que é pasta E tem `index.ts` dentro.
  for (const candidato of [base, `${base}.ts`, `${base}.tsx`, resolve(base, "index.ts")]) {
    if (existsSync(candidato) && statSync(candidato).isFile()) return candidato;
  }
  return null;
}

/**
 * Todo arquivo do projeto alcançável a partir do worker, ele inclusive, já sem
 * comentário — a prosa desta base cita literalmente os padrões que ela proíbe,
 * inclusive o `"server-only"` do cabeçalho do próprio worker.
 */
function grafoDoWorker(): Map<string, string> {
  const visitados = new Map<string, string>();
  const pilha = [WORKER];

  while (pilha.length > 0) {
    const arquivo = pilha.pop()!;
    if (visitados.has(arquivo)) continue;
    const texto = semComentarios(readFileSync(arquivo, "utf8"));
    visitados.set(arquivo, texto);

    // `import ... from "x"`, `import "x"` e `export ... from "x"`. A forma
    // `import type` entra junto, e de propósito: `server-only` é importado sem
    // binding nenhum, e uma varredura que tentasse distinguir tipo de valor
    // perderia justamente ela.
    for (const achado of texto.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]*?["']([^"']+)["']/g)) {
      const destino = resolverParaArquivo(achado[1], arquivo);
      if (destino) pilha.push(destino);
    }
  }

  return visitados;
}

function scriptDoWorker(): string {
  const pkg = JSON.parse(readFileSync(resolve(RAIZ, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const comando = pkg.scripts["fila:worker"];
  // Sem esta guarda, um script renomeado devolveria `undefined` e a asserção
  // abaixo reprovaria com a mensagem errada, mandando procurar uma flag num
  // comando que não existe mais.
  if (!comando) throw new Error('package.json nao tem o script "fila:worker".');
  return comando;
}

describe("o worker sobe sob Node comum", () => {
  it("alcanca o drenador e o turno — senao a varredura abaixo nao prova nada", () => {
    // Sem esta âncora, um `resolverParaArquivo` quebrado devolveria um grafo de
    // um arquivo só e os dois casos seguintes passariam calados. É o "caso que
    // passa pelo motivo errado" que o AGENTS.md manda não deixar de pé.
    const caminhos = [...grafoDoWorker().keys()].map(relativoPosix);

    expect(caminhos).toEqual(
      expect.arrayContaining([
        "scripts/fila-worker.ts",
        "src/modules/whatsapp/fila/consumidor.ts",
        "src/modules/whatsapp/fila/postgres.ts",
        "src/modules/whatsapp/turno.ts",
      ])
    );
  });

  it("o script npm passa --conditions=react-server", () => {
    expect(
      scriptDoWorker(),
      "sem a condicao, `server-only` faz `throw` e o worker morre na importacao " +
        "de `turno.ts`, antes de imprimir qualquer coisa — ver o cabecalho de " +
        "scripts/fila-worker.ts"
    ).toContain("--conditions=react-server");
  });

  it("a flag ainda e NECESSARIA: alguem no grafo importa server-only", () => {
    const exigem = [...grafoDoWorker()]
      .filter(([, texto]) => /["']server-only["']/.test(texto))
      .map(([arquivo]) => relativoPosix(arquivo));

    expect(
      exigem.length,
      "nenhum arquivo alcancavel pelo worker importa mais `server-only`: " +
        "tire `--conditions=react-server` do script `fila:worker` em package.json " +
        "e este caso junto, em vez de deixar a flag de heranca"
    ).toBeGreaterThan(0);
  });
});
