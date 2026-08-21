// `User.papel` não volta — a trava que não passa pelo compilador.
//
// ## Por que ela existe, e por que TEXTUAL
//
// Derrubar `User.papel` foi tentado três vezes no Ciclo 1a e falhou nas três,
// sempre igual: quem media achava um grupo de leitores, concluía que era o
// alcance total, e um grupo novo aparecia depois do ponto sem volta. Os três
// grupos foram o JWT/sessão, a gestão de equipe e o alerta de auditoria
// (`core/audit/alerta.ts`, fechado em 3744e64).
//
// A medição de 2026-08-21 (`.superpowers/sdd/medicao-user-papel.md`) fechou o
// inventário, e o que a distingue das três anteriores não é ter rodado o `tsc`
// contra uma linha de base zerada — é ter achado o BURACO do `tsc`:
//
//   tests/unit/audit-isolamento.test.ts:163 escrevia `papel` e PASSAVA no
//   typecheck, porque `data: [...].map((id) => ({ ..., papel: "ADMIN" }))`
//   derrota a checagem de propriedade excedente. Ela só vale para objeto
//   literal FRESCO atribuído direto ao parâmetro; passando por `.map()`, o
//   tipo do elemento é inferido do retorno do callback e o excesso some. Em
//   runtime o Prisma lançaria `Unknown argument papel`.
//
// Uma trava baseada em `tsc` repetiria as três falhas com uma ferramenta
// melhor. Esta lê o repositório como texto.
//
// ## O que ela reprova, exatamente
//
// A palavra `papel` dentro de uma chamada a `prisma.user.*` / `tx.user.*` /
// `db.user.*` — escrita OU leitura, porque as duas somem junto com a coluna.
// A sub-árvore `memberships: { ... }` é MASCARADA antes da checagem: escrever
// `papel` no vínculo aninhado é o jeito CERTO, e continua permitido (é o que
// `tests/unit/session.test.ts` faz, e o caso "papel escrito no Membership
// ANINHADO não é violação" abaixo é a prova executada disso).
//
// ## O que ela NÃO alcança, declarado
//
// Não entende TypeScript. Dublê montado numa variável e espalhado depois
// escapa; `any` e `JSON.parse` escapam. Isso é aceito de propósito, pelo mesmo
// raciocínio de `consultas-estreitas.test.ts`: a regra fecha o padrão que de
// fato apareceu neste projeto — chamada direta ao Prisma — e um analisador de
// verdade custaria mais que o problema. O que fecha o resíduo é a Task 11 do
// Ciclo 1f: a suíte rodando contra o Postgres real COM a coluna já fora, que é
// a única prova de runtime.
//
// Um dublê sem `prisma.user.*` fica fora do alcance por construção. Existe um,
// e é deliberado: `tests/unit/usuario-ativo.test.ts` REINTRODUZ um `papel`
// divergente na linha falsa de `User`, de propósito, para que a regra de
// resolução pelo vínculo continue tendo o que contradizer. Ver o comentário
// de lá.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { semComentarios } from "./helpers/codigo-fonte";

const RAIZ = process.cwd();
const DIRETORIOS = ["src", "tests", "prisma", "scripts", "config"];
const ESTE_ARQUIVO = "tests/unit/user-papel-nao-volta.test.ts";

/**
 * Métodos do delegate `user` do Prisma Client 7.9 que aceitam `where`, `data`
 * ou `select` — ou seja, todos por onde `papel` poderia entrar ou sair.
 * Lista fechada de propósito: um método novo do Prisma que não esteja aqui
 * passa despercebido, e prefiro isso a um curinga que case com
 * `user.usuarioQualquerCoisa` de código nosso.
 */
const METODOS_DE_USER = [
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
];

/**
 * Só `prisma.`, `tx.` e `db.` — e não um receptor qualquer: um curinga casaria
 * `prismaMock.user.findUniqueOrThrow` de `usuario-ativo.test.ts`, que é um
 * dublê e não uma consulta. Com o ponto obrigatório logo depois do nome, o
 * `Mock` no meio impede a batida.
 */
const CHAMADA_DE_USER = new RegExp(
  `\\b(?:prisma|tx|db)\\.user\\.(?:${METODOS_DE_USER.join("|")})\\s*\\(`,
  "g"
);

/**
 * Arquivos que ainda mencionam `papel` numa chamada a `prisma.user.*`, com a
 * tarefa do Ciclo 1f que os limpa.
 *
 * A lista SÓ ENCOLHE — as duas asserções abaixo travam as duas direções:
 * arquivo que viola e não está listado reprova, e arquivo listado que já não
 * viola também reprova. A segunda é o que impede a lista de virar depósito.
 *
 * Mesmo desenho da fila de conversão de `catraca-prisma-cru.test.ts`
 * (`LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS`, hoje em zero) e de `PERDOADAS`
 * em `migracoes-seguras.test.ts`: registrar dívida por nome, com prazo, em vez
 * de dar passagem em silêncio.
 *
 * A contagem inicial é 29 e vem de `.superpowers/sdd/medicao-user-papel.md`:
 * 32 arquivos de superfície menos os 3 que usam dublê sem `prisma.user.*`
 * (`usuario-ativo`, `lead-actions`, `task-actions`).
 */
const EM_CONVERSAO: Record<string, string> = {
  // Ciclo 1f, Task 8 — fixtures de e2e.
  "tests/e2e/global-setup.ts": "Task 8",
  "tests/e2e/sessao-e-cache.spec.ts": "Task 8",
  "tests/e2e/whatsapp-agente.spec.ts": "Task 8",

  // Ciclo 1f, Task 9 — fixtures da família "isolamento".
  "tests/unit/audit-isolamento.test.ts": "Task 9",
  "tests/unit/contact-isolamento.test.ts": "Task 9",
  "tests/unit/lead-isolamento.test.ts": "Task 9",
  "tests/unit/notificacoes-isolamento.test.ts": "Task 9",
  "tests/unit/pipeline-isolamento.test.ts": "Task 9",
  "tests/unit/task-isolamento.test.ts": "Task 9",
  "tests/unit/unicidades-por-empresa.test.ts": "Task 9",
  "tests/unit/whatsapp-isolamento.test.ts": "Task 9",

  // Ciclo 1f, Task 10 — o restante das fixtures de unidade.
  "tests/unit/alerta-atividade.test.ts": "Task 10",
  "tests/unit/audit-log.test.ts": "Task 10",
  "tests/unit/contacts-service.test.ts": "Task 10",
  "tests/unit/dono-integracao.test.ts": "Task 10",
  "tests/unit/notificacoes-poda.test.ts": "Task 10",
  "tests/unit/session.test.ts": "Task 10",
  "tests/unit/tasks.test.ts": "Task 10",
  "tests/unit/users-service.test.ts": "Task 10",
  "tests/unit/whatsapp-envio-por-conexao.test.ts": "Task 10",
  "tests/unit/whatsapp-notificacoes.test.ts": "Task 10",
};

// ─────────────────────────────────────────────────────────────────────────
// O analisador
// ─────────────────────────────────────────────────────────────────────────

type Violacao = { arquivo: string; linha: number; chamada: string };

/**
 * Apaga o MIOLO de toda string, preservando aspas, comprimento e quebras de
 * linha.
 *
 * Dois motivos, os dois medidos:
 *
 * 1. **Balanceamento.** O analisador conta chave, colchete e parêntese para
 *    achar o fim da chamada. Uma chave dentro de string desalinharia a
 *    contagem e o bloco terminaria no lugar errado.
 * 2. **Autoconsistência.** ESTE arquivo cita, em template literal, o código
 *    exato que proíbe. Sem apagar o miolo das strings, a varredura se acusaria
 *    — e o caso "os próprios exemplos deste arquivo não se acusam", abaixo, é
 *    o que prova que não acontece.
 *
 * O comprimento é preservado porque os índices são usados para calcular
 * número de linha; a quebra de linha é preservada pelo mesmo motivo. É a
 * mesma disciplina de `semComentarios` em `helpers/codigo-fonte.ts`.
 */
function semTextoDeString(codigo: string): string {
  let fora = "";
  let aspa: string | null = null;

  for (let i = 0; i < codigo.length; i++) {
    const c = codigo[i];
    if (aspa === null) {
      if (c === '"' || c === "'" || c === "`") aspa = c;
      fora += c;
      continue;
    }
    if (c === "\\") {
      // Consome o par inteiro, devolvendo dois caracteres: uma aspa escapada
      // no meio da string não pode fechá-la. Dois caracteres, e não um, para
      // o comprimento não mudar e a numeração de linha continuar de pé.
      fora += codigo[i + 1] === "\n" ? " \n" : "  ";
      i++;
      continue;
    }
    if (c === aspa) {
      aspa = null;
      fora += c;
      continue;
    }
    fora += c === "\n" ? "\n" : " ";
  }

  return fora;
}

/** Índice do fecho que casa com a abertura em `inicio`. */
function fimDoBalanceamento(texto: string, inicio: number): number {
  const fecho: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
  const pilha: string[] = [];

  for (let i = inicio; i < texto.length; i++) {
    const c = texto[i];
    if (fecho[c] !== undefined) {
      pilha.push(fecho[c]);
      continue;
    }
    if (c === pilha[pilha.length - 1]) {
      pilha.pop();
      if (pilha.length === 0) return i;
    }
  }

  return texto.length - 1;
}

/**
 * Apaga a sub-árvore `memberships` inteira do bloco, tanto na forma de objeto
 * quanto na de lista.
 *
 * Escrever `papel` no vínculo aninhado é o jeito CERTO e precisa continuar
 * possível — `tests/unit/session.test.ts` cria o `User` e o `Membership` numa
 * chamada só, de propósito. Sem esta máscara, a trava reprovaria justamente o
 * padrão que ela deveria empurrar as pessoas a usar.
 */
function semSubarvoreDeMemberships(bloco: string): string {
  let resultado = bloco;

  for (;;) {
    const achado = /\bmemberships\s*:\s*[{[]/.exec(resultado);
    if (achado === null) return resultado;

    const abertura = achado.index + achado[0].length - 1;
    const fim = fimDoBalanceamento(resultado, abertura);
    const miolo = resultado.slice(achado.index, fim + 1);

    resultado =
      resultado.slice(0, achado.index) +
      miolo.replace(/[^\n]/g, " ") +
      resultado.slice(fim + 1);
  }
}

export function analisar(arquivo: string, codigoBruto: string): Violacao[] {
  const codigo = semTextoDeString(semComentarios(codigoBruto));
  const violacoes: Violacao[] = [];

  for (const chamada of codigo.matchAll(CHAMADA_DE_USER)) {
    const abertura = chamada.index + chamada[0].length - 1;
    const fim = fimDoBalanceamento(codigo, abertura);
    const bloco = semSubarvoreDeMemberships(codigo.slice(abertura, fim + 1));

    for (const ocorrencia of bloco.matchAll(/\bpapel\b/g)) {
      const absoluto = abertura + ocorrencia.index;
      violacoes.push({
        arquivo,
        linha: codigo.slice(0, absoluto).split("\n").length,
        chamada: chamada[0],
      });
    }
  }

  return violacoes;
}

// ─────────────────────────────────────────────────────────────────────────
// A varredura
// ─────────────────────────────────────────────────────────────────────────

/** Caminho relativo à raiz, sempre com `/`, para bater com `EM_CONVERSAO`. */
function relativoPosix(caminho: string): string {
  return relative(RAIZ, caminho).replace(/\\/g, "/");
}

function arquivosDeCodigo(diretorio: string): string[] {
  const achados: string[] = [];
  for (const entrada of readdirSync(diretorio, { withFileTypes: true })) {
    const caminho = join(diretorio, entrada.name);
    if (entrada.isDirectory()) achados.push(...arquivosDeCodigo(caminho));
    else if (/\.tsx?$/.test(entrada.name)) achados.push(caminho);
  }
  return achados;
}

describe("User.papel não volta", () => {
  const arquivos = DIRETORIOS.flatMap((dir) =>
    arquivosDeCodigo(join(RAIZ, dir)).map(relativoPosix)
  );

  const violacoes = arquivos.flatMap((arquivo) =>
    analisar(arquivo, readFileSync(join(RAIZ, arquivo), "utf8"))
  );
  const sujos = [...new Set(violacoes.map((v) => v.arquivo))].sort();

  it("os cinco diretórios de código foram varridos", () => {
    // Sem isto, um caminho errado deixaria a lista de violações vazia para
    // sempre e as asserções abaixo verdes sem ter lido nada — o "teste que não
    // exercita" que `consultas-estreitas.test.ts` e `migracoes-seguras.test.ts`
    // já documentam neste projeto. Por diretório, e não só pelo total: um
    // `tests/` grande esconderia um `src/` que não foi lido.
    for (const dir of DIRETORIOS) {
      expect(
        arquivos.filter((a) => a.startsWith(`${dir}/`)).length,
        dir
      ).toBeGreaterThan(0);
    }
  });

  it("nenhum arquivo fora de EM_CONVERSAO menciona papel numa chamada a prisma.user", () => {
    const naoListados = sujos.filter((a) => EM_CONVERSAO[a] === undefined);

    expect(
      naoListados,
      "`papel` dentro de uma chamada a `prisma.user.*`. A coluna `User.papel` " +
        "está sendo derrubada no Ciclo 1f; o papel mora em `Membership.papel`. " +
        "Se for escrita, mova para o vínculo (o `papel` aninhado sob " +
        "`memberships`, ou `prisma.membership.create`); se for leitura, " +
        "consulte `Membership`. Não acrescente o arquivo a EM_CONVERSAO: " +
        "aquela lista só encolhe."
    ).toEqual([]);
  });

  it("EM_CONVERSAO não guarda arquivo já limpo — a lista SÓ encolhe", () => {
    const jaLimpos = Object.keys(EM_CONVERSAO).filter((a) => !sujos.includes(a));

    expect(
      jaLimpos,
      "arquivo listado em EM_CONVERSAO que já não menciona `papel` em chamada " +
        "a `prisma.user.*`. Tire-o da lista. Sem esta asserção a lista viraria " +
        "depósito e a trava perderia o dente exatamente quando começasse a " +
        "funcionar."
    ).toEqual([]);
  });

  it("a regra pega o `.map()` que o tsc NÃO pega", () => {
    // O trecho EXATO de `tests/unit/audit-isolamento.test.ts:157-165` antes do
    // conserto do Ciclo 1f. Ele passava no `npm run typecheck` mesmo com a
    // coluna fora do schema, e é a razão de esta trava ser textual em vez de
    // apoiada no compilador. Sem esta asserção, um erro de regex deixaria a
    // varredura sempre vazia e ninguém saberia.
    const doBuraco = `
      await prisma.user.createMany({
        data: [USUARIO_DUPLO, ADMIN_A, ADMIN_B].map((id) => ({
          id,
          nome: "Pessoa",
          email: "pessoa@exemplo.invalido",
          senhaHash: SENHA_FALSA,
          papel: "ADMIN" as const,
        })),
      });
    `;
    expect(analisar("teste", doBuraco)).toHaveLength(1);
  });

  it("pega também a leitura, que some junto com a coluna", () => {
    const leitura = `
      const admin = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN", ativo: true } });
    `;
    expect(analisar("teste", leitura)).toHaveLength(1);
  });

  it("papel escrito no Membership ANINHADO não é violação — é o jeito certo", () => {
    // A metade que impede a trava de empurrar as pessoas para longe do padrão
    // correto. É o que `tests/unit/session.test.ts` faz: `User` e `Membership`
    // numa chamada só, com o papel no vínculo.
    const certo = `
      await prisma.user.create({
        data: {
          nome: "Teste",
          email: "teste@exemplo.local",
          senhaHash: "hash",
          ativo: true,
          memberships: { create: { companyId: idEmpresa, papel: "VENDEDOR" } },
        },
      });
    `;
    expect(analisar("teste", certo)).toEqual([]);
  });

  it("papel fora de uma chamada a prisma.user não conta", () => {
    const legitimo = `
      await prisma.membership.updateMany({ where: { userId }, data: { papel: "ADMIN" } });
      const vinculo = await prisma.membership.findFirstOrThrow({ where: { papel: "ADMIN" } });
      const persona = config.personaPapel;
    `;
    expect(analisar("teste", legitimo)).toEqual([]);
  });

  it("prosa em comentário não conta como código", () => {
    // Este projeto documenta as próprias regras em comentário longo, e a prosa
    // que EXPLICA a regra cita o padrão proibido literalmente. É o tropeço que
    // `helpers/codigo-fonte.ts` registra ter acontecido nas duas primeiras
    // varreduras textuais do repositório.
    const soComentario = `
      // await prisma.user.create({ data: { papel: "ADMIN" } }) seria a volta da coluna
      await prisma.user.create({ data: { nome, email, senhaHash } });
    `;
    expect(analisar("teste", soComentario)).toEqual([]);
  });

  it("os próprios exemplos deste arquivo não se acusam", () => {
    // Este arquivo carrega, em template literal, o código exato que proíbe.
    // `semTextoDeString` apaga o miolo de toda string antes da análise, e é por
    // isso que ele não aparece na varredura de si mesmo. Sem esta asserção, a
    // primeira notícia de que a máscara quebrou seria a suíte ficando vermelha
    // ao acrescentar um exemplo novo — e o palpite errado seria "o exemplo está
    // mal escrito".
    expect(
      analisar(ESTE_ARQUIVO, readFileSync(join(RAIZ, ESTE_ARQUIVO), "utf8"))
    ).toEqual([]);
  });
});
