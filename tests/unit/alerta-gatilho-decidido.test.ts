// A trava de deriva do gatilho do alerta de rajada.
//
// ## A deriva, medida na história do repositório (auditoria de 2026-08-21)
//
// `ACOES_SENSIVEIS` foi **6 → 7 → 9 → 10 → 14**. `LIMITE_ALERTA` aparece uma
// única vez em toda a história (`4f4fb1d`, valor 10) e nunca foi revisitado.
//
// O par é contado JUNTO — `acao: { in: [...ACOES_SENSIVEIS] }` num `count`
// único — então **ampliar o conjunto equivale a baixar o limiar**: com mais
// ações entrando na mesma contagem, um mesmo usuário chega a 10 mais rápido. O
// próprio `alerta.ts` declara que essa é a direção segura ("baixar é seguro;
// subir é que custa"), e por isso o dano prático foi baixo — mas quatro
// mudanças de sensibilidade aconteceram sem que ninguém decidisse mudar
// sensibilidade nenhuma. É deriva, e a próxima continuaria em silêncio.
//
// ## Por que uma trava, e não um número novo
//
// Trocar 10 por 8 fecharia esta revisão e reabriria a mesma porta: a 15ª ação
// entraria amanhã do mesmo jeito. O que faltava não era o valor certo, era a
// obrigação de o par ser decidido junto. Este arquivo é essa obrigação: se o
// conjunto crescer (ou encolher) sem alguém revisitar `DECISAO_DO_GATILHO`,
// aqui fica vermelho E DIZ O QUE MUDOU.
//
// Mesmo desenho da lista `PERDOADAS` de `migracoes-seguras.test.ts` (entrada
// nova exige justificativa escrita) e da trava de `MODELOS_DE_TENANT` em
// `escopo-empresa.test.ts` (igualdade exata contra a fonte, com o nome do que
// entrou na mensagem).
//
// ## Por que ler o TEXTO do arquivo, e não importar o módulo
//
// Mesma razão de `catraca-prisma-cru.test.ts`: `core/audit/alerta.ts` importa
// `@/core/tenancy/escopo`, que importa `@/lib/prisma`, que INSTANCIA o
// `PrismaClient` no topo. Importar aqui faria esta varredura de texto exigir
// `DATABASE_URL` e uma conexão com o Postgres para conferir dois números.
//
// O preço de ler texto é conhecido e está pago abaixo: cada extração afirma
// primeiro que ACHOU alguma coisa. Sem isso, um regex quebrado devolveria zero
// e a comparação ficaria verde por vacuidade — a falha que a trava de
// `MODELOS_DE_TENANT` documenta como "a mensagem errada".
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { semComentarios } from "./helpers/codigo-fonte";

const CAMINHO = fileURLToPath(new URL("../../src/core/audit/alerta.ts", import.meta.url));
const FONTE = readFileSync(CAMINHO, "utf8");
// Comentários fora: este arquivo é denso em prosa e cita os próprios números
// ("6 → 7 → 9 → 10 → 14", "valor 10"). Contar prosa como declaração é o mesmo
// tropeço que `consultas-estreitas.test.ts` e o extrator do `eslint.config.mjs`
// já documentam.
const CODIGO = semComentarios(FONTE);

/** As ações declaradas em `ACOES_SENSIVEIS`, lidas do código-fonte. */
function acoesDeclaradas(): string[] {
  const bloco = /export const ACOES_SENSIVEIS = \[([\s\S]*?)\] as const;/.exec(CODIGO);
  if (!bloco) return [];
  return [...bloco[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** Um número de topo de arquivo (`export const X = 10;`). */
function constanteNumerica(nome: string): number | null {
  const achado = new RegExp(`export const ${nome} = (\\d+)`).exec(CODIGO);
  return achado ? Number(achado[1]) : null;
}

/** Um campo do objeto `DECISAO_DO_GATILHO`. */
function campoDaDecisao(nome: string): string | null {
  const bloco = /export const DECISAO_DO_GATILHO = \{([\s\S]*?)\n\} as const;/.exec(CODIGO);
  if (!bloco) return null;
  const achado = new RegExp(`${nome}:\\s*([^,]+(?:,\\n\\s+"[^"]*")*)`).exec(bloco[1]);
  return achado ? achado[1] : null;
}

function numeroDaDecisao(nome: string): number | null {
  const bruto = campoDaDecisao(nome);
  if (bruto === null) return null;
  const numero = Number(bruto.trim());
  return Number.isFinite(numero) ? numero : null;
}

/** A justificativa, com as concatenações de string juntadas. */
function justificativa(): string {
  const bloco = /porque:([\s\S]*?),\n\} as const;/.exec(CODIGO);
  if (!bloco) return "";
  return [...bloco[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]).join("");
}

describe("o gatilho do alerta nao pode derivar sem decisao", () => {
  // A sonda do próprio leitor. Se ela cair, o problema é este arquivo, não o
  // gatilho — e a mensagem precisa dizer isso, em vez de acusar deriva.
  it("o leitor do codigo-fonte esta funcionando", () => {
    expect(acoesDeclaradas().length).toBeGreaterThan(0);
    expect(constanteNumerica("LIMITE_ALERTA")).not.toBeNull();
    expect(numeroDaDecisao("acoesVigiadas")).not.toBeNull();
    expect(justificativa().length).toBeGreaterThan(0);
  });

  it("o TAMANHO de ACOES_SENSIVEIS bate com o que a decisao registrou", () => {
    const declaradas = acoesDeclaradas();
    const registrado = numeroDaDecisao("acoesVigiadas");

    // A mensagem é o entregável: quem quebrar isto precisa saber o que mudou
    // e o que não foi revisitado junto.
    expect(
      declaradas.length,
      `ACOES_SENSIVEIS tem ${declaradas.length} acoes (${declaradas.join(", ")}), e ` +
        `DECISAO_DO_GATILHO.acoesVigiadas diz ${registrado}. O conjunto e contado JUNTO ` +
        `(um unico count com "acao: { in: ... }"), entao mexer nele MUDA A SENSIBILIDADE ` +
        `do alerta sem tocar em LIMITE_ALERTA: ampliar baixa o gatilho de fato, encolher ` +
        `sobe. Revisite o par em src/core/audit/alerta.ts (DECISAO_DO_GATILHO): atualize ` +
        `acoesVigiadas, decida se ${constanteNumerica("LIMITE_ALERTA")} continua servindo ` +
        `e escreva em "porque" por que sim ou por que nao.`
    ).toBe(registrado);
  });

  it("o LIMITE e a JANELA batem com o que a decisao registrou", () => {
    expect(
      constanteNumerica("LIMITE_ALERTA"),
      "LIMITE_ALERTA mudou sem DECISAO_DO_GATILHO.limite mudar junto — o par nao pode " +
        "ser editado pela metade."
    ).toBe(numeroDaDecisao("limite"));

    // A terceira perna do mesmo gatilho: alargar a janela também baixa o
    // limiar de fato, porque mais eventos cabem dentro dela.
    const janelaMinutos = /export const JANELA_ALERTA_MS = (\d+) \* 60_000/.exec(CODIGO);
    expect(janelaMinutos, "JANELA_ALERTA_MS deixou de ser `N * 60_000` — ajuste este leitor").not.toBeNull();
    expect(Number(janelaMinutos![1])).toBe(numeroDaDecisao("janelaMinutos"));
  });

  // Sem isto, a trava vira um contador que se bumpa sem pensar: troca-se 14
  // por 15 e segue o jogo, que é exatamente a deriva que ela existe para
  // fechar. Exigir que a prosa CITE os números vigentes força a leitura da
  // decisão inteira — mesma exigência de justificativa escrita da lista
  // PERDOADAS em `migracoes-seguras.test.ts`.
  it("a justificativa cita os numeros vigentes, e nao e um carimbo", () => {
    const texto = justificativa();
    const acoes = String(acoesDeclaradas().length);
    const limite = String(constanteNumerica("LIMITE_ALERTA"));

    expect(
      texto.length,
      "DECISAO_DO_GATILHO.porque esta curto demais para ser uma decisao. Escreva por que " +
        "este limite serve para este conjunto."
    ).toBeGreaterThan(200);

    expect(
      texto.includes(acoes),
      `DECISAO_DO_GATILHO.porque nao menciona o tamanho atual do conjunto (${acoes}). ` +
        `O contador foi atualizado e a justificativa nao — ela ainda descreve outro gatilho.`
    ).toBe(true);

    expect(
      texto.includes(limite),
      `DECISAO_DO_GATILHO.porque nao menciona o limite atual (${limite}).`
    ).toBe(true);
  });

  // Data de revisão presente e plausível: uma decisão sem data não diz se foi
  // revisitada nesta ampliação ou três ciclos atrás.
  it("a decisao tem data de revisao", () => {
    expect(campoDaDecisao("revisadoEm")).toMatch(/"\d{4}-\d{2}-\d{2}"/);
  });

  // A metade que prova que a trava não é só sobre números: as ações declaradas
  // continuam sendo as que o resto do sistema audita. Uma ação escrita errada
  // ("excluir_taks") nunca casaria com o `AuditLog` e sairia da contagem sem
  // ninguém notar — o conjunto pareceria maior do que é.
  it("toda acao vigiada e uma acao que o codigo realmente audita", () => {
    const declaradas = acoesDeclaradas();
    expect(declaradas.length).toBeGreaterThan(0);
    for (const acao of declaradas) {
      expect(acao, `${acao} nao parece um nome de acao de auditoria`).toMatch(
        /^[a-z]+(_[a-z]+)+$/
      );
    }
    expect(new Set(declaradas).size, "ha acao repetida em ACOES_SENSIVEIS").toBe(
      declaradas.length
    );
  });
});
