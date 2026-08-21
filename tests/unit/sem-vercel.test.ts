// A trava da saída da Vercel.
//
// ## Por que uma varredura, e não só apagar
//
// O Ciclo 2a provou a morte das `EVOLUTION_*` do mesmo jeito: a suíte passando
// sem que nada daquilo exista é a prova de que a contração foi segura. Este
// arquivo é a metade que dura — apagar prova o presente, varrer defende o
// futuro.
//
// O modo de falha concreto que ele impede: alguém acrescenta um `import` de
// `@vercel/*` — para `@vercel/blob`, `@vercel/kv`, o que for — porque a
// documentação daquela biblioteca é a primeira que aparece, e o CRM volta a só
// funcionar num lugar. Nada mais quebraria: instala, compila, roda em
// desenvolvimento, e a descoberta acontece no deploy fora da Vercel.
//
// ## O cabeçalho de IP, que era a pendência declarada aqui
//
// Este bloco dizia que `src/lib/ip.ts` continuava lendo `x-vercel-forwarded-for`
// com precedência, como pendência REPORTADA ao dono. Ela foi FECHADA na Task 8
// do mesmo ciclo: nenhum cabeçalho é lido até `IP_CABECALHO_CONFIAVEL` nomear o
// que a borda sobrescreve. O nome da plataforma continua aparecendo naquele
// arquivo, mas só como EXEMPLO de valor da variável e como relato do que
// quebrou — nunca mais como cabeçalho que o código presume não forjável.
//
// Por isso a varredura de leitura de ambiente abaixo é por `process.env.VERCEL`,
// e não pelo nome da plataforma em qualquer lugar: o que não pode voltar é o
// código DEPENDER da plataforma, não a prosa citá-la.
//
// A varredura é do TEXTO sem comentário, pelo motivo de sempre nesta base
// (`tests/unit/helpers/codigo-fonte.ts`): a prosa que EXPLICA a saída da Vercel
// cita literalmente `@vercel/queue` e `DuplicateMessageError`, em meia dúzia de
// arquivos, e esse registro histórico fica.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, it, expect } from "vitest";

import { semComentarios } from "./helpers/codigo-fonte";

const RAIZ = resolve(__dirname, "../..");
const DIRETORIOS = ["src", "tests", "scripts", "prisma"];

/**
 * O escopo npm da plataforma, montado em duas partes — e não escrito inteiro.
 *
 * Não é preciosismo: a varredura abaixo lê `tests/` também, este arquivo
 * incluso, e o escopo escrito por extenso em qualquer linha de CÓDIGO daqui faz
 * a varredura se acusar. Aconteceu na primeira execução, com o
 * `startsWith` do caso do `package.json`. A alternativa seria isentar este
 * arquivo por nome, e isentar é o começo de toda varredura que não pega nada.
 */
const ESCOPO = `@${"vercel"}/`;

function arquivosDeCodigo(diretorio: string): string[] {
  const achados: string[] = [];
  for (const entrada of readdirSync(diretorio)) {
    const caminho = join(diretorio, entrada);
    if (statSync(caminho).isDirectory()) {
      achados.push(...arquivosDeCodigo(caminho));
    } else if (/\.(ts|tsx|mjs|js)$/.test(entrada)) {
      achados.push(caminho);
    }
  }
  return achados;
}

function relativoPosix(caminho: string): string {
  return relative(RAIZ, caminho).replace(/\\/g, "/");
}

describe("a Vercel saiu, e continua fora", () => {
  it("a varredura olha um numero PLAUSIVEL de arquivos", () => {
    // Sem esta âncora, um `arquivosDeCodigo` quebrado devolveria lista vazia e
    // todos os casos abaixo passariam calados — o "caso que passa pelo motivo
    // errado". O piso é folgado de propósito: ele existe para acusar zero, não
    // para virar contador que precisa de manutenção a cada arquivo novo.
    const arquivos = DIRETORIOS.flatMap((d) => arquivosDeCodigo(resolve(RAIZ, d)));
    expect(arquivos.length).toBeGreaterThan(200);
  });

  it("nenhum arquivo IMPORTA um pacote @vercel/*", () => {
    const culpados: string[] = [];
    for (const diretorio of DIRETORIOS) {
      for (const arquivo of arquivosDeCodigo(resolve(RAIZ, diretorio))) {
        const codigo = semComentarios(readFileSync(arquivo, "utf8"));
        // Pega `import ... from`, `import`, `await import(`, `require(` e
        // `vi.mock(` — a ASPA antes do escopo é o que amarra todas as formas,
        // porque em qualquer uma delas o especificador é uma string literal.
        // Uma menção em prosa não tem aspa antes, e prosa já foi removida.
        if (new RegExp(`["'\`]${ESCOPO}`).test(codigo)) {
          culpados.push(relativoPosix(arquivo));
        }
      }
    }

    expect(
      culpados,
      "o Ciclo 2d tirou o CRM da Vercel: um pacote do escopo npm da plataforma faz o projeto " +
        "voltar a so funcionar la, e a descoberta acontece no deploy. Se a dependencia for mesmo " +
        "necessaria, ela precisa entrar como ADAPTADOR atras de uma interface, como " +
        "`FilaTurnos` fez -- nunca importada direto por quem usa."
    ).toEqual([]);
  });

  it("package.json nao declara dependencia da plataforma", () => {
    const pkg = JSON.parse(readFileSync(resolve(RAIZ, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const todas = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });

    expect(todas.filter((nome) => nome === "vercel" || nome.startsWith(ESCOPO))).toEqual([]);
  });

  it("nenhum codigo LE uma variavel de ambiente da plataforma", () => {
    // `VERCEL_ENV` estava no meio da cadeia de fallback do rótulo do Sentry
    // (`src/instrumentation.ts`) e saiu no Ciclo 2d. Uma variável que nunca mais
    // vai existir dentro de um `??` não quebra nada — ela só faz o próximo
    // leitor sair procurando onde é definida, e não achar. As da plataforma vêm
    // todas com o mesmo prefixo (`VERCEL`, `VERCEL_ENV`, `VERCEL_URL`,
    // `VERCEL_REGION`), então um prefixo pega a família inteira.
    //
    // A varredura é do texto SEM comentário: o parágrafo que explica por que
    // `VERCEL_ENV` saiu precisa poder citá-la pelo nome.
    const culpados: string[] = [];
    for (const diretorio of DIRETORIOS) {
      for (const arquivo of arquivosDeCodigo(resolve(RAIZ, diretorio))) {
        const codigo = semComentarios(readFileSync(arquivo, "utf8"));
        if (/process\.env\.VERCEL/.test(codigo)) culpados.push(relativoPosix(arquivo));
      }
    }

    expect(
      culpados,
      "variavel de ambiente da plataforma lida em codigo: fora da Vercel ela nunca existe, " +
        "entao o ramo que depende dela e um ramo morto que parece vivo."
    ).toEqual([]);
  });

  it("vercel.json nao existe", () => {
    // Ele declarava o `experimentalTriggers` que ligava a rota consumidora ao
    // topico da fila, e o `retryAfterSeconds: 30` que hoje e `RETRY_APOS_MS` em
    // `fila/postgres.ts`. Recriar o arquivo nao quebraria build nenhum — nada
    // no build o le —, e e exatamente por isso que so um caso o pega.
    expect(existsSync(resolve(RAIZ, "vercel.json"))).toBe(false);
  });
});
