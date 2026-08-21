// Nenhuma consulta carrega `User` ou `Contact` inteiros por uma relação.
//
// ## Por que esta regra existe em código, e não em revisão
//
// O vazamento do funil (branch 1) foi `include: { contact: true }`. A correção
// dele trocou aquela consulta por um `select`, e a lição virou comentário em
// três arquivos. Comentário não reprova ninguém: quatro meses e três branches
// depois, `core/notifications/dispatch.ts` ainda tinha
// `include: { contact: true, stage: true, responsavel: true }`, intocado desde
// antes da regra existir.
//
// O detalhe que torna isto uma armadilha, e não um deslize de estilo: uma
// consulta curinga **piora sozinha**. Quando aquela linha foi escrita,
// `Contact` era nome, telefone e e-mail. A branch 3 acrescentou `documento`
// (CPF/CNPJ), `endereco` e `observacoes` — e a consulta passou a ler o CPF de
// todo mundo sem que uma linha de código mudasse e sem que um único teste
// ficasse vermelho. `User` tem `senhaHash` desde sempre.
//
// ## O que é escaneado, e o que não é
//
// Só `src/`. Em `tests/` um objeto `{ contact: true }` costuma ser dado falso
// montado à mão, não consulta.
//
// A varredura é TEXTUAL, sobre o código com os comentários removidos. Não
// entende TypeScript: se alguém montar o argumento do `findMany` numa variável
// separada e espalhar, escapa. Isso é aceito de propósito — a regra fecha o
// padrão que de fato apareceu quatro vezes neste projeto, e um analisador de
// verdade custaria mais do que o problema.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { semComentarios } from "./helpers/codigo-fonte";

const RAIZ = join(process.cwd(), "src");

/**
 * Nome do campo de relação → tabela de destino e o que ela guarda de sensível.
 *
 * Extraído de `prisma/schema.prisma` com
 * `grep -nE "^\s+[a-zA-Z]+\s+(User|Contact)(\?|\[\])?\s"`. Relação nova para
 * uma dessas duas tabelas precisa entrar aqui — não há como o teste descobrir
 * sozinho, e uma relação que falta é um buraco silencioso na regra.
 */
const RELACOES_SENSIVEIS: Record<string, string> = {
  contact: "Contact (documento, endereco, observacoes)",
  responsavel: "User (senhaHash)",
  autor: "User (senhaHash)",
  user: "User (senhaHash)",
  iaPausadaPor: "User (senhaHash)",
  atualizadoPor: "User (senhaHash)",
  segredoAtualizadoPor: "User (senhaHash)",
};


type Violacao = { arquivo: string; linha: number; campo: string; alvo: string };

export function analisar(arquivo: string, codigoBruto: string): Violacao[] {
  const linhas = semComentarios(codigoBruto).split("\n");
  const violacoes: Violacao[] = [];

  linhas.forEach((linha, indice) => {
    for (const [campo, alvo] of Object.entries(RELACOES_SENSIVEIS)) {
      // Início de linha, `{` ou `,` antes do nome: evita casar `naoContact:` e
      // parecidos. `: true` com espaço livre, porque o Prettier deste projeto
      // não é a autoridade sobre correção.
      const padrao = new RegExp(`(^|[\\s{,])${campo}\\s*:\\s*true\\b`);
      if (padrao.test(linha)) {
        violacoes.push({ arquivo, linha: indice + 1, campo, alvo });
      }
    }
  });

  return violacoes;
}

function arquivosDeCodigo(diretorio: string): string[] {
  const achados: string[] = [];
  for (const entrada of readdirSync(diretorio, { withFileTypes: true })) {
    const caminho = join(diretorio, entrada.name);
    if (entrada.isDirectory()) {
      achados.push(...arquivosDeCodigo(caminho));
    } else if (/\.tsx?$/.test(entrada.name)) {
      achados.push(caminho);
    }
  }
  return achados;
}

describe("consultas estreitas", () => {
  const arquivos = arquivosDeCodigo(RAIZ);

  it("a varredura encontrou o código-fonte", () => {
    // Sem esta asserção, um caminho errado deixaria a lista de violações vazia
    // para sempre e o teste abaixo verde sem ter lido nada — o "teste que não
    // exercita" da tabela de armadilhas da auditoria.
    expect(arquivos.length).toBeGreaterThan(50);
  });

  it("nenhuma relação para User ou Contact é carregada inteira", () => {
    const violacoes = arquivos.flatMap((caminho) =>
      analisar(relative(process.cwd(), caminho), readFileSync(caminho, "utf8"))
    );

    expect(
      violacoes.map((v) => `${v.arquivo}:${v.linha} — ${v.campo}: true traz ${v.alvo}`),
      "relação carregada inteira. Troque por `select` com os campos que a tela " +
        "de fato lê. Não existe lista de perdoadas aqui de propósito: toda vez " +
        "que este padrão apareceu neste projeto, ele estava errado."
    ).toEqual([]);
  });

  it("a regra pega o caso que originou a varredura", () => {
    // Prova de que o analisador não é decorativo. É a linha exata que estava
    // em `core/notifications/dispatch.ts`.
    const doIncidente = `
      const lead = await prisma.lead.findUniqueOrThrow({
        where: { id: leadId },
        include: { contact: true, stage: true, responsavel: true },
      });
    `;
    const violacoes = analisar("teste.ts", doIncidente);
    expect(violacoes.map((v) => v.campo).sort()).toEqual(["contact", "responsavel"]);
  });

  it("o select corrigido passa", () => {
    const corrigido = `
      select: {
        id: true,
        contact: { select: { nome: true } },
        stage: { select: { nome: true } },
        responsavel: { select: { id: true, email: true } },
      },
    `;
    expect(analisar("teste.ts", corrigido)).toEqual([]);
  });

  it("prosa em comentário não conta como código, MESMO com fim de linha do Windows", () => {
    // O caso que reprovou quatro comentários na primeira versão deste arquivo.
    // Sem `\r\n` explícito aqui o teste passa por sorte: a string literal de um
    // arquivo `.ts` usa `\n`, e o bug só aparece contra o disco.
    const crlf =
      "// A versão anterior usava include: { contact: true }.\r\n" +
      "const x = 1;\r\n";
    expect(analisar("teste.ts", crlf)).toEqual([]);
  });

  it("prosa em comentário não conta como código", () => {
    const soComentario = `
      // A versão anterior usava include: { contact: true } e trazia o CPF junto.
      /* responsavel: true também traria senhaHash. */
      const x = 1;
    `;
    expect(analisar("teste.ts", soComentario)).toEqual([]);
  });

  it("uma URL não é confundida com comentário", () => {
    // O risco do corte ingênuo por `//`: a linha inteira depois de "https:"
    // sumiria, e uma violação escondida atrás de uma URL passaria batido.
    const comUrl = `const doc = "https://exemplo.com"; const q = { include: { user: true } };`;
    expect(analisar("teste.ts", comUrl).map((v) => v.campo)).toEqual(["user"]);
  });

  it("um campo escalar de nome parecido não é violação", () => {
    // `ativo: true` é filtro de `where`, não relação. Se a regra reprovasse
    // isso, a lista viraria ruído e todo mundo aprenderia a ignorá-la.
    const escalar = `where: { ativo: true, lidaEm: null }`;
    expect(analisar("teste.ts", escalar)).toEqual([]);
  });
});
