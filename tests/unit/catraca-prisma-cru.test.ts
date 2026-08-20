// A catraca do escopo por empresa.
//
// ## O defeito que ela existe para impedir
//
// Uma família de defeito reincidiu SEIS vezes no Ciclo 1a, sempre com a mesma
// forma: uma validação que confere que o registro EXISTE e nunca que ele é da
// MESMA EMPRESA.
//
//   1. `core/audit/alerta.ts`            — destinatários do alerta (3744e64)
//   2. `modules/whatsapp/notificacoes.ts` — fan-out do aviso (63cecd2)
//   3. `core/leads/service.ts`           — responsável do lead (6dfb325)
//   4. `core/tasks/service.ts`           — Task em Lead de outra empresa (da2a402)
//   5. `core/tasks/service.ts`           — o mesmo com Contact (f2f05cf)
//   6. `core/users/service.ts`           — `redefinirSenha` por id: TOMADA DE CONTA (f2f05cf)
//
// Cada uma foi achada por um acaso diferente: uma por linha vazada em disco,
// uma por revisão que estava lá por outro motivo, uma por varredura à mão.
// NENHUMA foi achada por algo que o sistema faça sozinho. Este arquivo é a
// resposta a isso.
//
// ## Por que a trava é sobre o IMPORT, e não sobre cada defeito
//
// A família existe porque esses arquivos ainda importam `@/lib/prisma` cru.
// Convertido para `prismaDaEmpresa(companyId)` (`src/core/tenancy/escopo.ts`),
// o `companyId` entra sozinho — `findFirst({ where: { id } })` vira
// `findFirst({ where: { id, companyId } })` sem ninguém precisar lembrar. A
// conversão não corrige os defeitos um a um: ela REMOVE A POSSIBILIDADE deles.
//
// Logo, a trava estrutural é a lista de exceção do lint chegando a zero. O que
// faltava era impedir que ela crescesse no caminho — e é isso que a PARTE 1
// faz. O lint sozinho não faz: ele fica verde quando alguém acrescenta um nome
// à lista, e fica verde para árvore que ele nem cobre (`src/components/**`,
// `src/lib/**`, `src/proxy.ts` não têm bloco nenhum em `eslint.config.mjs`).
//
// ## O que este arquivo trava, em três partes
//
// **Parte 1 — a catraca.** O conjunto de arquivos de `src/**` que de fato
// importam o prisma cru tem que ser EXATAMENTE o conjunto declarado nas listas
// de exceção do `eslint.config.mjs`. Sobrando de um lado ou do outro, falha
// nomeando o arquivo. A lista pode DIMINUIR à vontade (a catraca gira num
// sentido só); crescer, não.
//
// **Parte 2 — as duas portas de serviço que a Parte 1 não vê.** Um arquivo já
// convertido não importa o prisma cru, então o lint fica verde e a catraca
// também — e ele ainda tem dois jeitos de alcançar o banco sem escopo:
// receber um cliente CRU por parâmetro, e `$queryRaw`. As duas travas valem só
// para arquivos FORA das listas de exceção, o que as faz apertar sozinhas: no
// dia em que `pipeline/service.ts` sair da lista, o `$queryRaw` dele passa a
// ser cobrado aqui.
//
// **Parte 3 — a prova de que as travas mordem.** Cada regra tem um caso
// sintético que ela precisa reprovar e um que ela precisa aprovar. Sem isso, um
// regex quebrado deixa a lista de violações vazia para sempre e o portão fica
// verde sem ter lido nada.
//
// ## O QUE ESTA VARREDURA NÃO PEGA
//
// Escrito aqui de propósito, e com precisão, porque uma trava que mente é pior
// que trava nenhuma:
//
// - **Os 31 defeitos vivos NÃO são contados aqui.** Eles estão catalogados um
//   a um em `.superpowers/sdd/reparo-tasks-tenancy.md` § 5 e anotados linha a
//   linha no `eslint.config.mjs`. Ver o comentário de `RECEPTOR_CRU_FORA_DA_FILA`
//   mais abaixo para a medição que reprovou a ideia de gatear por eles.
// - **Cliente cru recebido sem anotação de tipo** (`any`, tipo inferido de um
//   helper, desestruturação) escapa da Parte 2a. O que ela pega é o nome do
//   tipo escrito no arquivo.
// - **SQL com nome de tabela interpolado** (`Prisma.sql` montado em variável)
//   escapa da Parte 2b: ela lê o texto do template.
// - **Acesso dinâmico ao modelo** (`prisma[modelo].findMany`) escapa de tudo.
// - **Só `src/`.** `tests/`, `prisma/seed*.ts` e `scripts/` importam o prisma
//   cru de propósito e não estão em nenhuma das listas.
//
// Nenhuma dessas lacunas é hipótese confortável: são os buracos conhecidos, e
// quem os fechar deve apagar a linha correspondente daqui.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

import { semComentarios } from "./helpers/codigo-fonte";

const RAIZ_PROJETO = process.cwd();
const RAIZ_SRC = join(RAIZ_PROJETO, "src");
const CONFIG_ESLINT = join(RAIZ_PROJETO, "eslint.config.mjs");
const SCHEMA = join(RAIZ_PROJETO, "prisma", "schema.prisma");

/**
 * A linha de base, medida em **2026-08-20** com
 * `grep -rln "lib/prisma" src --include=*.ts --include=*.tsx` (25 achados, 3
 * deles menção em comentário, 3 na exceção PERMANENTE — sobram 19).
 *
 * O motivo do número estar escrito: ele é o contador de quanto falta para o
 * `prisma` cru sumir de `src/`. Cada conversão do ciclo o baixa. A asserção é
 * `<=`, nunca `===`: converter um arquivo e esquecer de baixar este número não
 * pode reprovar ninguém — a catraca gira num sentido só. Quem quiser apertá-la
 * de verdade baixa o número junto com a conversão, e é o que se espera.
 *
 * O que impede a lista de crescer NÃO é este número (ele afrouxa sozinho a
 * cada conversão): é a igualdade exata entre árvore e listas, no caso logo
 * abaixo, que nomeia o arquivo que entrou.
 */
const LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS = 13;

/**
 * Arquivos que podem nomear o tipo do cliente CRU sem estar na fila de
 * conversão do lint. Um só, e pelo mesmo motivo que `core/tenancy/escopo.ts`
 * está na exceção PERMANENTE de lá: é o arquivo que CONSTRÓI o cliente.
 */
const DONOS_DO_CLIENTE_CRU = ["src/lib/prisma.ts"];

// ─────────────────────────────────────────────────────────────────────────
// Leitura das fontes da verdade
// ─────────────────────────────────────────────────────────────────────────

/** Caminho relativo à raiz, sempre com `/`, para bater com o `eslint.config.mjs`. */
function relativoPosix(caminho: string): string {
  return relative(RAIZ_PROJETO, caminho).replace(/\\/g, "/");
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

/**
 * Os modelos que têm `companyId`, lidos do `prisma/schema.prisma`.
 *
 * Não importamos `MODELOS_DE_TENANT` de `@/core/tenancy/escopo` de propósito:
 * aquele módulo importa `@/lib/prisma`, que INSTANCIA o `PrismaClient` no topo
 * do arquivo — este teste passaria a exigir `DATABASE_URL` para varrer texto em
 * disco. O schema é a mesma fonte da verdade, e a igualdade entre ele e o Set
 * já é travada por `escopo-empresa.test.ts` ("MODELOS_DE_TENANT não pode
 * derivar do schema").
 */
export function modelosDeTenant(texto: string): string[] {
  const encontrados: string[] = [];
  let modeloAtual: string | null = null;

  for (const linha of texto.split(/\r?\n/)) {
    const abertura = /^model\s+(\w+)\s*\{/.exec(linha);
    if (abertura) {
      modeloAtual = abertura[1];
      continue;
    }
    if (/^\}/.test(linha)) {
      modeloAtual = null;
      continue;
    }
    if (modeloAtual && /^\s*companyId\s+\w+/.test(linha)) encontrados.push(modeloAtual);
  }

  return encontrados;
}

/**
 * Extrai um array de literais de string do `eslint.config.mjs`.
 *
 * Os comentários saem antes da extração: aquele arquivo documenta a própria
 * fila em prosa e cita caminhos entre aspas dentro dos comentários (por
 * exemplo, a nota que registra que `"src/core/leads/*"` SAIU da lista). Contar
 * prosa como declaração é o mesmo tropeço que `consultas-estreitas.test.ts` já
 * documenta.
 *
 * **Por que NÃO usamos `semComentarios` aqui**, e o caso que obrigou a escrever
 * isto: aquele helper apaga blocos `/* … *\/` por regex, e o `eslint.config.mjs`
 * está cheio de `/*` que NÃO abrem comentário nenhum — o glob `"@/modules/*"` da
 * fronteira core↛modules, o `"**\/lib/prisma"` do `PRISMA_CRU`, e a própria
 * prosa que cita `` `src/core/leads/*` ``. O primeiro deles engolia o arquivo
 * inteiro até o `*\/` seguinte, as quatro listas voltavam VAZIAS, e as três
 * asserções de igualdade passariam a acusar os 22 importadores reais como se
 * fossem todos novos. Medido na primeira execução deste arquivo.
 *
 * Dentro do corpo de um array só existe comentário de linha, então varrer linha
 * a linha cortando a partir de `//` é suficiente — e não tem como confundir um
 * glob com abertura de bloco.
 */
export function listaDeclarada(fonte: string, nome: string): string[] {
  const linhas = fonte.replace(/\r\n/g, "\n").split("\n");
  const inicio = linhas.findIndex((l) => l.startsWith(`const ${nome} = [`));
  if (inicio < 0) return [];

  const achados: string[] = [];
  for (let i = inicio; i < linhas.length; i++) {
    // O `//` só conta como comentário quando não vem depois de `:` — mesma
    // ressalva de `semComentarios`, para não cortar uma URL ao meio.
    const semComentario = linhas[i].replace(/(^|[^:])\/\/.*$/, "$1");
    for (const achado of semComentario.matchAll(/"([^"]+)"/g)) achados.push(achado[1]);
    // `];` na MESMA linha da abertura é o caso de `VIOLADORES_TEMPORARIOS_APP`,
    // que hoje tem um item só e cabe numa linha.
    if (semComentario.includes("];")) return achados;
  }
  return achados;
}

// ─────────────────────────────────────────────────────────────────────────
// A armadilha do `[id]`, paga com sangue e escrita em código
// ─────────────────────────────────────────────────────────────────────────
//
// `[id]` numa lista de caminhos do eslint é CLASSE DE CARACTERES, não pasta
// literal: o glob lê "um caractere entre i e d", não casa com a pasta `[id]`, e
// o arquivo continua sendo acusado apesar de estar listado. A exceção de
// `src/app/(painel)/leads/[id]/page.tsx` PARECIA declarada e não estava, até
// virar `\[id\]`.
//
// Isso importa aqui porque esta catraca COMPARA CAMINHOS. Se ela comparasse o
// texto cru, uma entrada mal escrita casaria com o arquivo real na comparação
// dela e não casaria no eslint — exceção que não casa é PIOR que exceção
// ausente, porque o portão fica verde nos dois lados. Duas defesas:
//
// 1. `caminhoLiteral` desfaz o escape, para a comparação ver o arquivo real.
// 2. `temMetacaractereNu` reprova quem escreveu o metacaractere SEM escapar —
//    é a entrada que o eslint silenciosamente ignora.
//
// `(` e `)` ficam de fora das duas: em minimatch eles só viram grupo quando
// precedidos de `?`/`*`/`+`/`@`/`!`, e `(painel)` não é.

/** Desfaz o escape de glob: `src/.../\[id\]/page.tsx` → `src/.../[id]/page.tsx`. */
export function caminhoLiteral(entrada: string): string {
  return entrada.replace(/\\([[\]{}?*+@!])/g, "$1");
}

/** `true` quando sobrou metacaractere de glob NÃO escapado — o falso negativo silencioso. */
export function temMetacaractereNu(entrada: string): boolean {
  const semEscapados = entrada.replace(/\\[[\]{}?*+@!]/g, "");
  return /[[\]?*{}]/.test(semEscapados);
}

// ─────────────────────────────────────────────────────────────────────────
// Parte 1 — quem importa o prisma cru de verdade
// ─────────────────────────────────────────────────────────────────────────

/**
 * `true` quando o arquivo IMPORTA `@/lib/prisma` (ou um caminho relativo que
 * chegue no mesmo módulo), e não apenas o MENCIONA em comentário.
 *
 * A diferença não é acadêmica: `grep -l "lib/prisma" src` devolve 25 arquivos
 * hoje, e 3 deles (`core/leads/notes.ts`, `components/leads/lead-note-form.tsx`,
 * `src/proxy.ts`) só citam o caminho em prosa. Contar prosa como import faria a
 * catraca acusar arquivos já convertidos — ruído que treina todo mundo a
 * ignorar o portão.
 */
export function importaPrismaCru(codigoBruto: string): boolean {
  const codigo = semComentarios(codigoBruto);
  const especificadores = [
    ...codigo.matchAll(/\bfrom\s*["']([^"']+)["']/g),
    ...codigo.matchAll(/\b(?:require|import)\s*\(\s*["']([^"']+)["']/g),
  ].map((a) => a[1].replace(/\.(?:ts|tsx|js|mjs)$/, ""));

  return especificadores.some((e) => /(?:^|\/)lib\/prisma$/.test(e));
}

// ─────────────────────────────────────────────────────────────────────────
// Parte 2a — cliente CRU recebido por parâmetro
// ─────────────────────────────────────────────────────────────────────────
//
// A porta que a Parte 1 não vê. O padrão existe na base, legítimo, em dois
// arquivos AINDA NA FILA (`core/audit/log.ts:57` e `core/users/empresa.ts:44`):
//
//     cliente: Prisma.TransactionClient = prisma
//
// Num arquivo já convertido esse mesmo parâmetro é um buraco: o arquivo não
// importa `@/lib/prisma` (lint verde, catraca verde) e mesmo assim opera sobre
// um cliente sem a extensão que injeta o `companyId`. O padrão que um arquivo
// convertido usa é o de `core/leads/service.ts:30`,
// `ReturnType<typeof prismaDaEmpresa>`, que carrega a extensão no tipo.
//
// `Prisma.PrismaClientKnownRequestError` (usado em `leads/dedupe.ts` e
// `whatsapp/ingest.ts` para pegar o P2002) NÃO é violação, e não casa: a
// fronteira `\b` depois de `PrismaClient` falha antes do `K`.

const TIPOS_DE_CLIENTE_CRU = [
  { padrao: /\bPrisma\.TransactionClient\b/, nome: "Prisma.TransactionClient" },
  { padrao: /\bPrismaClient\b/, nome: "PrismaClient" },
];

export type Violacao = { arquivo: string; linha: number; detalhe: string };

export function analisarClienteCru(arquivo: string, codigoBruto: string): Violacao[] {
  const violacoes: Violacao[] = [];
  semComentarios(codigoBruto)
    .split("\n")
    .forEach((linha, indice) => {
      for (const { padrao, nome } of TIPOS_DE_CLIENTE_CRU) {
        if (padrao.test(linha)) {
          violacoes.push({
            arquivo,
            linha: indice + 1,
            detalhe:
              `nomeia o tipo do cliente CRU (\`${nome}\`) — este arquivo está ` +
              `FORA da fila de conversão, então o cliente dele deveria ser sempre ` +
              `o escopado. Use \`ReturnType<typeof prismaDaEmpresa>\`.`,
          });
        }
      }
    });
  return violacoes;
}

// ─────────────────────────────────────────────────────────────────────────
// Parte 2b — SQL cru sobre tabela de tenant
// ─────────────────────────────────────────────────────────────────────────
//
// A segunda porta, e a mais silenciosa das duas. `src/core/tenancy/escopo.ts`
// diz, na sua própria documentação (linha 112):
//
//   "**Não alcança de jeito nenhum**: `$queryRaw`/`$executeRaw`. Eles não passam
//    [pelo `$allOperations`]"
//
// Ou seja: `prismaDaEmpresa(id).$queryRaw` compila, roda, e lê o banco INTEIRO.
// Nem o lint nem a Parte 1 percebem, porque o arquivo pode estar perfeitamente
// convertido. Em 2026-08-20 os cinco usos estavam TODOS em arquivos da fila
// (`pipeline/service.ts`, `rate-limit/limiter.ts`, `whatsapp/ingest.ts`,
// `whatsapp/turno.ts`) — medido com `grep -rn "queryRaw\|executeRaw" src`.
//
// **Isso já mudou, e é a prova de que a trava aperta sozinha.** O Ciclo 1d
// converteu `pipeline/service.ts` e o tirou da lista de exceção do lint; no
// mesmo instante o `$queryRaw` de `travarEstruturaDoFunil` — que até então
// travava a tabela `PipelineStage` de TODAS as empresas de uma vez, um dos 13
// defeitos catalogados no módulo — passou a ser cobrado aqui, e hoje leva
// `WHERE "companyId" = ${companyId}` escrito à mão. Ninguém precisou lembrar de
// ligar nada: sair da fila foi o gatilho.
//
// A mesma execução mostrou o outro lado desta varredura, e vale registrar
// porque parece um falso positivo e não é: uma ANOTAÇÃO DE TIPO que citasse a
// operação (`Pick<Cliente, "$queryRaw">`) casa com o padrão abaixo, e então a
// varredura não acha SQL nenhum depois dela e acusa. Está certa em acusar —
// forma que ela não sabe ler é justamente o caso em que ela não pode afirmar
// que o SQL é escopado. `pipeline/service.ts` derivou o tipo do `tx` por
// `Parameters<...>` para não escrever o nome da operação em texto.

const CHAMADAS_DE_SQL_CRU = /\$(?:queryRaw|queryRawUnsafe|executeRaw|executeRawUnsafe)\b/g;

/**
 * O texto do SQL que vem depois da chamada — template marcado (`` $queryRaw`...` ``,
 * com ou sem `<Tipo>` no meio) ou argumento entre parênteses.
 *
 * Devolve `null` quando a forma não é nenhuma das duas. Quem chama trata `null`
 * como VIOLAÇÃO, não como "tudo bem": uma forma que a varredura não entende é
 * exatamente o caso em que ela não pode afirmar nada.
 */
export function sqlDaChamada(texto: string, depoisDoToken: number): string | null {
  let i = depoisDoToken;
  // pula `<Array<{ ... }>>` de tipo genérico, se houver
  if (texto[i] === "<") {
    let profundidade = 0;
    for (; i < texto.length; i++) {
      if (texto[i] === "<") profundidade++;
      else if (texto[i] === ">") {
        profundidade--;
        if (profundidade === 0) {
          i++;
          break;
        }
      }
    }
  }
  while (i < texto.length && /\s/.test(texto[i])) i++;

  if (texto[i] === "`") {
    const fim = texto.indexOf("`", i + 1);
    return fim < 0 ? null : texto.slice(i + 1, fim);
  }
  if (texto[i] === "(") {
    let profundidade = 0;
    for (let j = i; j < texto.length; j++) {
      if (texto[j] === "(") profundidade++;
      else if (texto[j] === ")") {
        profundidade--;
        if (profundidade === 0) return texto.slice(i + 1, j);
      }
    }
  }
  return null;
}

export function analisarSqlCru(
  arquivo: string,
  codigoBruto: string,
  modelos: readonly string[]
): Violacao[] {
  const texto = semComentarios(codigoBruto);
  const violacoes: Violacao[] = [];

  for (const achado of texto.matchAll(CHAMADAS_DE_SQL_CRU)) {
    const linha = texto.slice(0, achado.index).split("\n").length;
    const sql = sqlDaChamada(texto, achado.index! + achado[0].length);

    if (sql === null) {
      violacoes.push({
        arquivo,
        linha,
        detalhe:
          `${achado[0]} numa forma que esta varredura não sabe ler. Ela não pode ` +
          `afirmar que o SQL é escopado, então acusa — leia o caso à mão.`,
      });
      continue;
    }

    const tabelas = modelos.filter((m) => new RegExp(`"${m}"`).test(sql));
    if (tabelas.length > 0 && !/companyId/i.test(sql)) {
      violacoes.push({
        arquivo,
        linha,
        detalhe:
          `${achado[0]} toca ${tabelas.map((t) => `"${t}"`).join(", ")} sem citar ` +
          `companyId. SQL cru NÃO passa pela extensão de \`prismaDaEmpresa\` ` +
          `(escopo.ts, linha 112) — o filtro por empresa some sem aviso.`,
      });
    }
  }

  return violacoes;
}

// ─────────────────────────────────────────────────────────────────────────
// O que esta trava deliberadamente NÃO gateia, e a medição que decidiu isso
// ─────────────────────────────────────────────────────────────────────────
//
// A ideia recusada: varrer `src/` inteiro atrás de operação de modelo de tenant
// cujo `where` não cite `companyId`, e gatear por isso. Ela foi implementada
// como sonda e MEDIDA em 2026-08-20 antes de ser recusada. Dois números:
//
// - **12 falsos positivos em arquivos JÁ CONVERTIDOS.** Em `core/leads/*` e
//   `app/(painel)/leads/[id]/page.tsx`, `db.lead.findFirstOrThrow({ where: { id } })`
//   é a forma CORRETA — o `db` é `prismaDaEmpresa(companyId)` e o filtro é
//   injetado. A varredura textual não distingue `db` de `prisma`, e acusar a
//   forma certa é o caminho mais curto para o portão virar ruído.
//
// - **62 achados nos arquivos da fila, contra 31 defeitos catalogados.** Os
//   outros 31 achados são consultas escopadas por dono (`responsavelId`), por
//   FK já validada a montante, ou a segunda metade de um par cuja primeira
//   metade valida a empresa. Gatear por eles exigiria uma lista de perdoadas
//   com linha e número por arquivo, que desatualiza a cada edição — e um número
//   que PARECE contagem de defeito e não é seria pior que não ter número.
//
// O julgamento: uma trava sólida e estreita vale mais que uma larga e furada. O
// catálogo dos 31 é humano, mora em `.superpowers/sdd/reparo-tasks-tenancy.md`
// § 5 e nas anotações do `eslint.config.mjs`, e é lá que ele deve ficar até a
// conversão apagá-lo. O que ESTE arquivo garante é que a fila não cresce e que
// os dois caminhos de fuga de um arquivo já convertido estão fechados.

// ─────────────────────────────────────────────────────────────────────────
// Os casos
// ─────────────────────────────────────────────────────────────────────────

describe("catraca do prisma cru", () => {
  const fonteEslint = readFileSync(CONFIG_ESLINT, "utf8");
  const temporarios = [
    ...listaDeclarada(fonteEslint, "VIOLADORES_TEMPORARIOS_CORE"),
    ...listaDeclarada(fonteEslint, "VIOLADORES_TEMPORARIOS_MODULES"),
    ...listaDeclarada(fonteEslint, "VIOLADORES_TEMPORARIOS_APP"),
  ];
  const permanentes = listaDeclarada(fonteEslint, "EXCECAO_PERMANENTE");
  const declarados = [...temporarios, ...permanentes];

  const arquivos = arquivosDeCodigo(RAIZ_SRC);
  const importadores = arquivos
    .filter((caminho) => importaPrismaCru(readFileSync(caminho, "utf8")))
    .map(relativoPosix);

  it("as duas fontes da verdade foram lidas de verdade", () => {
    // Sem isto, um nome de constante trocado ou um caminho errado deixaria as
    // duas listas vazias e TODOS os casos abaixo passariam sem ter comparado
    // nada — o "teste que não exercita" da tabela de armadilhas da auditoria.
    expect(arquivos.length, "a varredura não achou o código-fonte em src/").toBeGreaterThan(50);
    expect(
      temporarios.length,
      "nenhuma exceção TEMPORÁRIA lida do eslint.config.mjs — os nomes das " +
        "constantes mudaram? Este teste lê VIOLADORES_TEMPORARIOS_{CORE,MODULES,APP}."
    ).toBeGreaterThan(0);
    expect(
      permanentes.length,
      "nenhuma exceção PERMANENTE lida do eslint.config.mjs — a constante " +
        "EXCECAO_PERMANENTE mudou de nome?"
    ).toBeGreaterThan(0);
    expect(
      importadores.length,
      "nenhum importador do prisma cru encontrado em src/ — se isso for verdade " +
        "a fila zerou e este arquivo inteiro pode ser apagado junto com os blocos " +
        "do eslint. Se não for, o detector de import parou de funcionar."
    ).toBeGreaterThan(0);
  });

  it("toda exceção declarada é um caminho literal que existe", () => {
    // A armadilha do `[id]`: entrada com metacaractere nu não casa no eslint e
    // casaria aqui, deixando o portão verde nos dois lados.
    const problemas = declarados.flatMap((entrada) => {
      if (temMetacaractereNu(entrada)) {
        return [
          `${entrada}: metacaractere de glob NÃO escapado. Em minimatch, ` +
            `\`[id]\` é CLASSE DE CARACTERES, não a pasta \`[id]\` — a exceção ` +
            `não casa, o eslint continua acusando o arquivo, e esta catraca ` +
            `acharia que ele está declarado. Escreva \`\\\\[id\\\\]\`.`,
        ];
      }
      const literal = caminhoLiteral(entrada);
      if (!existsSync(join(RAIZ_PROJETO, literal))) {
        return [
          `${entrada}: não existe em disco. Exceção que sobrevive ao arquivo é ` +
            `mentira no contador — apague a linha.`,
        ];
      }
      return [];
    });

    expect(problemas).toEqual([]);
  });

  it("ninguém importa o prisma cru fora da exceção NOMEADA", () => {
    const declaradosLiterais = new Set(declarados.map(caminhoLiteral));
    const intrusos = importadores.filter((a) => !declaradosLiterais.has(a));

    expect(
      intrusos,
      "importador NOVO do prisma cru. Ele ignora o escopo por empresa: " +
        "`findFirst({ where: { id } })` alcança o registro de QUALQUER cliente. " +
        "Use `prismaDaEmpresa(companyId)` de `@/core/tenancy/escopo`. Se este " +
        "arquivo realmente não puder ser escopado, acrescente-o à exceção " +
        "NOMEADA em eslint.config.mjs COM O MOTIVO — e saiba que a lista é o " +
        "contador de quanto falta, então crescer tem preço. Repare que esta " +
        "trava alcança árvores que o lint nem cobre (src/components, src/lib, " +
        "src/proxy.ts não têm bloco lá)."
    ).toEqual([]);
  });

  it("nenhuma exceção sobra sem importador correspondente", () => {
    const reais = new Set(importadores);
    const orfas = declarados.map(caminhoLiteral).filter((a) => !reais.has(a));

    expect(
      orfas,
      "exceção declarada para arquivo que NÃO importa mais o prisma cru. " +
        "Converteu? Então apague a linha e a anotação dela do eslint.config.mjs " +
        "(e baixe a LINHA_DE_BASE deste arquivo). Anotação que sobrevive ao " +
        "defeito vira mentira, e o contador passa a dizer que falta mais do que " +
        "falta."
    ).toEqual([]);
  });

  it("a fila de conversão não cresceu além da linha de base de 2026-08-20", () => {
    expect(
      temporarios.length,
      `a fila de conversão do prisma cru tem ${temporarios.length} arquivos e a ` +
        `linha de base é ${LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS} (2026-08-20). ` +
        `Fila: ${temporarios.join(", ")}`
    ).toBeLessThanOrEqual(LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS);
  });
});

describe("portas de serviço de um arquivo já convertido", () => {
  const fonteEslint = readFileSync(CONFIG_ESLINT, "utf8");
  const naFila = new Set(
    [
      ...listaDeclarada(fonteEslint, "VIOLADORES_TEMPORARIOS_CORE"),
      ...listaDeclarada(fonteEslint, "VIOLADORES_TEMPORARIOS_MODULES"),
      ...listaDeclarada(fonteEslint, "VIOLADORES_TEMPORARIOS_APP"),
      ...listaDeclarada(fonteEslint, "EXCECAO_PERMANENTE"),
      ...DONOS_DO_CLIENTE_CRU,
    ].map(caminhoLiteral)
  );

  const convertidos = arquivosDeCodigo(RAIZ_SRC)
    .map((caminho) => ({ arquivo: relativoPosix(caminho), codigo: readFileSync(caminho, "utf8") }))
    .filter(({ arquivo }) => !naFila.has(arquivo));

  const modelos = modelosDeTenant(readFileSync(SCHEMA, "utf8"));

  it("a varredura leu o schema e a lista de convertidos", () => {
    expect(modelos.length, "nenhum modelo com companyId lido do schema").toBeGreaterThan(5);
    expect(convertidos.length, "nenhum arquivo convertido para varrer").toBeGreaterThan(20);
  });

  it("nenhum arquivo convertido recebe um cliente Prisma CRU", () => {
    const violacoes = convertidos.flatMap(({ arquivo, codigo }) =>
      analisarClienteCru(arquivo, codigo)
    );

    expect(
      violacoes.map((v) => `${v.arquivo}:${v.linha} — ${v.detalhe}`),
      "cliente cru alcançado por parâmetro. É a fuga que o lint não vê: o " +
        "arquivo não IMPORTA `@/lib/prisma`, ele RECEBE o cliente pronto — e " +
        "com ele some a injeção de `companyId`."
    ).toEqual([]);
  });

  it("nenhum arquivo convertido toca tabela de tenant por SQL cru sem companyId", () => {
    const violacoes = convertidos.flatMap(({ arquivo, codigo }) =>
      analisarSqlCru(arquivo, codigo, modelos)
    );

    expect(
      violacoes.map((v) => `${v.arquivo}:${v.linha} — ${v.detalhe}`),
      "SQL cru sobre tabela de tenant. `$queryRaw`/`$executeRaw` não passam " +
        "pelo `$allOperations` da extensão (escopo.ts, linha 112): escreva o " +
        "`WHERE \"companyId\" = ${companyId}` à mão, ou não use SQL cru aqui."
    ).toEqual([]);
  });
});

describe("as travas mordem de verdade", () => {
  // Sem esta seção, um regex quebrado deixaria as listas de violação vazias e
  // todos os casos acima verdes para sempre. Cada afirmação universal lá em
  // cima tem aqui o caso que a exercita.

  it("o detector de import pega o alias e o caminho relativo", () => {
    expect(importaPrismaCru(`import { prisma } from "@/lib/prisma";`)).toBe(true);
    expect(importaPrismaCru(`import { prisma } from "../../lib/prisma";`)).toBe(true);
    expect(importaPrismaCru(`const { prisma } = require("@/lib/prisma");`)).toBe(true);
    expect(importaPrismaCru(`const m = await import("@/lib/prisma");`)).toBe(true);
    expect(importaPrismaCru(`import { prisma } from "@/lib/prisma.ts";`)).toBe(true);
  });

  it("menção em comentário NÃO é import, mesmo com fim de linha do Windows", () => {
    // Os três arquivos que `grep -l "lib/prisma"` acusa hoje sem importarem
    // nada: `core/leads/notes.ts`, `components/leads/lead-note-form.tsx` e
    // `src/proxy.ts`. Contar prosa acusaria arquivo já convertido.
    expect(
      importaPrismaCru(` * revisor — mesmo padrão de \`src/lib/storage.ts\`/\`src/lib/prisma.ts\`), um\r\n`)
    ).toBe(false);
    expect(importaPrismaCru(`// o singleton do Prisma em src/lib/prisma.ts\r\nconst x = 1;\r\n`)).toBe(
      false
    );
    expect(
      importaPrismaCru(`/* não importamos essa constante direto aqui. notes.ts (e @/lib/prisma) */`)
    ).toBe(false);
  });

  it("um vizinho de nome parecido não é o prisma cru", () => {
    expect(importaPrismaCru(`import { algo } from "@/lib/prisma-helpers";`)).toBe(false);
    expect(importaPrismaCru(`import { prismaDaEmpresa } from "@/core/tenancy/escopo";`)).toBe(false);
  });

  it("a normalização de glob desfaz o escape e acusa o metacaractere nu", () => {
    // O caso exato que aconteceu: escrito `[id]`, a exceção não casava.
    expect(caminhoLiteral(String.raw`src/app/(painel)/leads/\[id\]/page.tsx`)).toBe(
      "src/app/(painel)/leads/[id]/page.tsx"
    );
    expect(temMetacaractereNu(String.raw`src/app/(painel)/leads/\[id\]/page.tsx`)).toBe(false);
    expect(temMetacaractereNu("src/app/(painel)/leads/[id]/page.tsx")).toBe(true);
    // `(painel)` não é grupo em minimatch sem `?*+@!` na frente, e não pode
    // reprovar — reprová-lo tornaria a lista impossível de escrever.
    expect(temMetacaractereNu("src/app/(painel)/page.tsx")).toBe(false);
    expect(temMetacaractereNu("src/core/audit/alerta.ts")).toBe(false);
  });

  it("a leitura do eslint.config.mjs ignora caminho citado em comentário", () => {
    const fonte = [
      "// A entrada de \"src/core/leads/service.ts\" saiu na Task 4.",
      'const VIOLADORES_TEMPORARIOS_CORE = [',
      "  // 1 defeito (BAIXA): explicação que cita \"src/core/outro.ts\" na prosa",
      '  "src/core/audit/alerta.ts",',
      "];",
    ].join("\n");
    expect(listaDeclarada(fonte, "VIOLADORES_TEMPORARIOS_CORE")).toEqual([
      "src/core/audit/alerta.ts",
    ]);
  });

  it("um glob com `/*` não é lido como abertura de comentário de bloco", () => {
    // O caso que quebrou a primeira execução deste arquivo: `semComentarios`
    // apaga blocos por regex, e o `eslint.config.mjs` tem `/*` que não abrem
    // bloco nenhum — em glob de `no-restricted-imports` e em prosa. O primeiro
    // engolia o arquivo inteiro e as quatro listas voltavam vazias.
    const fonte = [
      'const PRISMA_CRU = { group: ["@/modules/*", "**/lib/prisma"] };',
      "// a nota que registra que `src/core/leads/*` SAIU da lista",
      "const EXCECAO_PERMANENTE = [",
      '  "src/core/auth/session.ts",',
      "];",
    ].join("\n");
    expect(listaDeclarada(fonte, "EXCECAO_PERMANENTE")).toEqual(["src/core/auth/session.ts"]);
  });

  it("lista de uma linha só é lida inteira, e para ali", () => {
    // `VIOLADORES_TEMPORARIOS_APP` cabe numa linha. Sem tratar isso, a leitura
    // seguiria varrendo o resto do arquivo e recolheria strings de outros
    // blocos como se fossem exceções declaradas.
    const fonte = [
      'const VIOLADORES_TEMPORARIOS_APP = ["src/app/(painel)/page.tsx"];',
      'const OUTRA_COISA = ["src/nao/deveria/entrar.ts"];',
    ].join("\n");
    expect(listaDeclarada(fonte, "VIOLADORES_TEMPORARIOS_APP")).toEqual([
      "src/app/(painel)/page.tsx",
    ]);
  });

  it("a trava do cliente cru pega o parâmetro e ignora o erro do Prisma", () => {
    // A forma real, copiada de `core/users/empresa.ts:44`.
    const porParametro = `async function x(id: string, cliente: Prisma.TransactionClient = prisma) {}`;
    expect(analisarClienteCru("t.ts", porParametro).map((v) => v.linha)).toEqual([1]);
    expect(analisarClienteCru("t.ts", `function y(c: PrismaClient) {}`)).toHaveLength(1);

    // `PrismaClientKnownRequestError` é o `instanceof` do P2002 em
    // `leads/dedupe.ts` e `whatsapp/ingest.ts`. Reprová-lo seria ruído.
    expect(
      analisarClienteCru("t.ts", `if (e instanceof Prisma.PrismaClientKnownRequestError) {}`)
    ).toEqual([]);
    // O padrão CORRETO de um arquivo convertido (`core/leads/service.ts:30`).
    expect(
      analisarClienteCru("t.ts", `type ClienteDaEmpresa = ReturnType<typeof prismaDaEmpresa>;`)
    ).toEqual([]);
    // Prosa não conta.
    expect(analisarClienteCru("t.ts", `// recebia Prisma.TransactionClient antes`)).toEqual([]);
  });

  it("a trava do SQL cru pega a tabela de tenant e libera o resto", () => {
    const modelos = ["Lead", "PipelineStage", "AuditLog"];

    // A forma de `travarEstruturaDoFunil` (`core/pipeline/service.ts`) antes da
    // conversão do Ciclo 1d, com genérico antes do template e sem `companyId`.
    const semEmpresa = 'const l = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "PipelineStage" FOR UPDATE`;';
    expect(analisarSqlCru("t.ts", semEmpresa, modelos)).toHaveLength(1);
    expect(analisarSqlCru("t.ts", semEmpresa, modelos)[0].detalhe).toContain("PipelineStage");

    // A mesma consulta escopada à mão passa.
    const comEmpresa = 'await tx.$queryRaw`SELECT "id" FROM "PipelineStage" WHERE "companyId" = ${companyId}`;';
    expect(analisarSqlCru("t.ts", comEmpresa, modelos)).toEqual([]);

    // Tabela que não é de tenant não é assunto desta trava — `RateLimit` é
    // defesa global e nem tem `companyId` (ver a exceção PERMANENTE do lint).
    const forte = 'await prisma.$queryRaw`SELECT count(*) FROM "RateLimit" WHERE "chave" = ${c}`;';
    expect(analisarSqlCru("t.ts", forte, modelos)).toEqual([]);

    // `$executeRaw` conta igual.
    expect(
      analisarSqlCru("t.ts", 'await prisma.$executeRaw`DELETE FROM "Lead"`;', modelos)
    ).toHaveLength(1);

    // Forma que a varredura não sabe ler ACUSA, em vez de passar calada.
    expect(analisarSqlCru("t.ts", "const f = prisma.$queryRaw;", modelos)).toHaveLength(1);

    // Prosa não conta.
    expect(analisarSqlCru("t.ts", '// $queryRaw`SELECT * FROM "Lead"` seria ruim', modelos)).toEqual(
      []
    );
  });

  it("o leitor de modelos de tenant acha os 11 do schema", () => {
    const modelos = modelosDeTenant(readFileSync(SCHEMA, "utf8"));
    // Os três de fora, por decisão registrada: `User` (sem companyId, email
    // @unique global), `RateLimit` (defesa global, antes de existir sessão) e
    // `Company` (é a empresa).
    expect(modelos).toContain("Lead");
    expect(modelos).toContain("WhatsappMessage");
    expect(modelos).not.toContain("User");
    expect(modelos).not.toContain("RateLimit");
    expect(modelos).not.toContain("Company");
  });
});
