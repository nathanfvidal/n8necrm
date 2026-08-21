// A trava de `prefetch={false}` em toda navegação do painel.
//
// ## O defeito que ela existe para impedir — que já reincidiu uma vez
//
// O `AGENTS.md` conta o incidente: a branch da gestão de equipe deixou passar
// um logout que podia ser DESFEITO por uma pré-busca de `<Link>`. O mecanismo,
// em três passos:
//
//   1. O `<Link>` entra na viewport e o Next dispara a pré-busca da rota.
//   2. Essa requisição vai ao servidor COM o cookie de sessão, e o Auth.js —
//      sessão JWT, sem store (`src/lib/auth.ts:10-12`) — reemite o cookie na
//      resposta, porque é assim que a renovação deslizante funciona.
//   3. Se a resposta chega DEPOIS do clique em "Sair", o `Set-Cookie` dela
//      ressuscita a sessão que acabou de ser revogada.
//
// Foi achado por um e2e intermitente, quase descartado como teste instável, e
// corrigido em `0a81737`.
//
// **O padrão do `<Link>` não é "não pré-buscar".** É `auto`
// (node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md,
// §`prefetch`): *"For dynamic routes, the partial route down to the nearest
// segment with a `loading.js` boundary will be prefetched."* Este painel é
// `force-dynamic` E tem `src/app/(painel)/loading.tsx`. Ou seja: a condição do
// doc está satisfeita, e todo `<Link>` sem a prop pré-busca de verdade em
// produção.
//
// ## Por que este arquivo existe, e não só a correção
//
// A afirmação que fechou o incidente é UNIVERSAL — "toda navegação do painel é
// `prefetch={false}`" — e estava escrita em dois lugares
// (`src/app/(painel)/loading.tsx`, `tests/e2e/transicao.spec.ts`) enquanto
// existia em UM arquivo só (`src/components/nav-links.tsx`). Não havia padrão
// global em `next.config.ts`; não há como haver, o Next não expõe um.
//
// A auditoria de 2026-08-21
// (`docs/auditorias/2026-08-21-fase1-seguranca-branch-tenancy.md`) mediu a
// consequência: **13 dos 15 `<Link>` do painel estavam sem a prop**, dois deles
// em `<nav>` na MESMA TELA do botão "Sair"
// (`(painel)/configuracoes/layout.tsx`, `(painel)/fluxos/[id]/page.tsx`). O
// e2e que provou a correção original só exercita a barra lateral, que já estava
// coberta — o teste não alcançava nenhum dos caminhos novos.
//
// Uma frase que diz "toda navegação" precisa de algo que exercite TODA
// navegação. É este arquivo. O e2e continua valendo e foi estendido no mesmo
// commit para as duas telas que faltavam; ele prova o comportamento no
// navegador, esta varredura prova a cobertura.
//
// ## O QUE ESTA VARREDURA NÃO PEGA
//
// Escrito com precisão de propósito — uma trava que mente é pior que trava
// nenhuma. O mesmo cuidado de `catraca-prisma-cru.test.ts`:
//
// - **Navegação que não usa `<Link>`.** `router.push`, `<a href>` e
//   `redirect()` não pré-buscam nada, então estão fora do alcance do defeito e
//   fora daqui de propósito. `<form action>` idem.
// - **`prefetch` vindo de variável** (`prefetch={PADRAO}`) é acusado, não
//   perdoado: a varredura lê texto e não pode afirmar o valor. Forma que ela
//   não sabe ler é exatamente o caso em que ela não pode dar passagem.
// - **`<Link>` fora de `src/app/(painel)/**` e `src/components/**`.** Só o
//   painel roda sob sessão. `src/app/(auth)/login` não tem `<Link>` nenhum
//   hoje (medido); se ganhar um, ele está fora daqui — e está certo, porque não
//   há sessão para ressuscitar antes do login.
// - **`<Link>` montado dinamicamente** (`React.createElement(Link, …)`, ou um
//   componente que embrulhe `Link` em outro arquivo) escapa: a varredura acha
//   o nome do import default e a tag literal.
//
// Quem fechar uma dessas lacunas apaga a linha correspondente daqui.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

import { semComentarios } from "./helpers/codigo-fonte";

const RAIZ_PROJETO = process.cwd();

/**
 * As duas árvores que rodam sob sessão.
 *
 * `src/app/(painel)/**` é o painel inteiro. `src/components/**` entra porque é
 * de lá que vêm `lead-table.tsx`, `fluxos-table.tsx` e
 * `notification-bell.tsx` — três dos treze achados da auditoria, nenhum deles
 * dentro de um `<nav>`, todos renderizados DENTRO do painel. Restringir a
 * varredura a `<nav>` teria deixado passar os três.
 */
const ARVORES_DO_PAINEL = [
  join("src", "app", "(painel)"),
  join("src", "components"),
];

/**
 * Arquivos autorizados a ter `<Link>` sem `prefetch={false}`, **um a um e com
 * o motivo escrito**.
 *
 * Hoje ela está VAZIA, e esse é o estado forte: nenhuma exceção é a mesma
 * coisa que "a regra vale". Entrada nova aqui é uma decisão de segurança e
 * exige a justificativa no valor — a lista existe para registrar história, não
 * para dar passagem, no mesmo espírito de `PERDOADAS` em
 * `migracoes-seguras.test.ts`.
 *
 * A única forma de exceção que eu consigo antecipar como legítima é um
 * `<Link>` para um destino EXTERNO (`https://…`): o Next não pré-busca URL de
 * outra origem, então não há requisição carregando cookie de sessão e o
 * mecanismo do defeito não existe. Mesmo assim ela passaria por aqui, com o
 * motivo escrito — não por um `if` na varredura, que valeria em silêncio para
 * casos que ninguém revisou.
 */
const SEM_PREFETCH_JUSTIFICADO: Record<string, string> = {};

/**
 * Quantos `<Link>` a varredura precisa encontrar para se considerar viva.
 *
 * Sem este piso, um erro de regex — ou uma refatoração que renomeie o import
 * default — faria a lista de violações ficar vazia PARA SEMPRE, e o portão
 * ficaria verde sem ter lido nada. É a mesma defesa de "o diretório de
 * migrações é legível e tem conteúdo" em `migracoes-seguras.test.ts`.
 *
 * Medido em 2026-08-21: 15 `<Link>` em 12 arquivos. O piso é deliberadamente
 * mais baixo que a medição, porque apagar uma tela é legítimo e não deve
 * reprovar ninguém.
 */
const PISO_DE_LINKS_ENCONTRADOS = 10;

// ─────────────────────────────────────────────────────────────────────────
// A varredura
// ─────────────────────────────────────────────────────────────────────────

export type LinkEncontrado = {
  arquivo: string;
  linha: number;
  atributos: string;
  temPrefetchFalso: boolean;
};

/**
 * O nome local do import default de `next/link`, ou `null` se o arquivo não
 * importa.
 *
 * Ler o NOME, e não presumir `Link`, importa por dois motivos opostos:
 * `import NextLink from "next/link"` continuaria sendo navegação e escaparia
 * de um scan por `<Link`; e um componente local chamado `Link` que NÃO venha
 * de `next/link` não pré-busca nada e seria acusado à toa.
 *
 * `import { useLinkStatus } from "next/link"` (o caso real de
 * `src/components/indicador-de-link.tsx`) não é import default e devolve
 * `null` — correto, aquele arquivo não renderiza `<Link>` nenhum.
 */
export function nomeDoLink(codigoBruto: string): string | null {
  const codigo = semComentarios(codigoBruto);
  // `import Link from "next/link"` e `import Link, { useLinkStatus } from …`.
  const achado = codigo.match(/\bimport\s+(\w+)\s*(?:,\s*\{[^}]*\})?\s*from\s*["']next\/link["']/);
  return achado ? achado[1] : null;
}

/**
 * Devolve o texto dos atributos de uma tag aberta em `inicio`, ou `null` se a
 * tag não fecha.
 *
 * O `>` que fecha a tag NÃO é o primeiro `>` do texto, e isso não é
 * teoria: `onClick={() => setAberto(false)}` em
 * `src/components/notifications/notification-bell.tsx` tem uma seta DENTRO de
 * uma expressão. Por isso a leitura acompanha profundidade de chave e estado
 * de aspas, e só aceita o `>` no nível zero e fora de string.
 *
 * Template literal com interpolação (`` href={`/fluxos/${id}?aba=editar`} ``,
 * o caso real) sai equilibrado sozinho: o `{` de `${` casa com o `}` dele.
 */
export function atributosDaTag(texto: string, inicio: number): string | null {
  let profundidade = 0;
  let aspas: string | null = null;

  for (let i = inicio; i < texto.length; i++) {
    const c = texto[i];

    if (aspas) {
      if (c === "\\") i++;
      else if (c === aspas) aspas = null;
      continue;
    }

    if (c === '"' || c === "'" || c === "`") {
      aspas = c;
      continue;
    }
    if (c === "{") profundidade++;
    else if (c === "}") profundidade--;
    else if (c === ">" && profundidade === 0) return texto.slice(inicio, i);
  }
  return null;
}

/** `prefetch={false}` escrito literalmente, com folga de espaço em branco. */
const PREFETCH_FALSO = /\bprefetch\s*=\s*\{\s*false\s*\}/;

/**
 * Todos os `<Link>` de um arquivo, com a informação de ter ou não a prop.
 *
 * Os comentários saem ANTES da varredura, e isso não é zelo: este projeto
 * documenta as próprias regras em prosa densa, e a prosa que EXPLICA esta
 * regra escreve `<Link>` literalmente — inclusive dentro dos arquivos que a
 * varredura lê. Sem `semComentarios`, todo comentário desses viraria uma
 * violação e a trava reprovaria a própria documentação. É o mesmo tropeço já
 * registrado em `tests/unit/helpers/codigo-fonte.ts`.
 */
export function analisarArquivo(arquivo: string, codigoBruto: string): LinkEncontrado[] {
  const nome = nomeDoLink(codigoBruto);
  if (!nome) return [];

  const codigo = semComentarios(codigoBruto);
  const abertura = new RegExp(`<${nome}(?=[\\s/>])`, "g");
  const encontrados: LinkEncontrado[] = [];

  for (const achado of codigo.matchAll(abertura)) {
    const inicio = achado.index! + achado[0].length;
    const atributos = atributosDaTag(codigo, inicio);
    const linha = codigo.slice(0, achado.index).split("\n").length;

    encontrados.push({
      arquivo,
      linha,
      // Tag que não fecha é forma que a varredura não sabe ler: entra com
      // texto vazio e reprova, em vez de sumir e virar falso verde.
      atributos: atributos ?? "",
      temPrefetchFalso: atributos !== null && PREFETCH_FALSO.test(atributos),
    });
  }

  return encontrados;
}

// ─────────────────────────────────────────────────────────────────────────
// Leitura da árvore
// ─────────────────────────────────────────────────────────────────────────

function relativoPosix(caminho: string): string {
  return relative(RAIZ_PROJETO, caminho).replace(/\\/g, "/");
}

function arquivosJsx(diretorio: string): string[] {
  if (!existsSync(diretorio)) return [];
  const achados: string[] = [];
  for (const entrada of readdirSync(diretorio, { withFileTypes: true })) {
    const caminho = join(diretorio, entrada.name);
    if (entrada.isDirectory()) achados.push(...arquivosJsx(caminho));
    else if (/\.tsx$/.test(entrada.name)) achados.push(caminho);
  }
  return achados;
}

function todosOsLinksDoPainel(): LinkEncontrado[] {
  return ARVORES_DO_PAINEL.flatMap((arvore) =>
    arquivosJsx(join(RAIZ_PROJETO, arvore)).flatMap((caminho) =>
      analisarArquivo(relativoPosix(caminho), readFileSync(caminho, "utf8"))
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────

describe("prefetch do painel", () => {
  it("a varredura enxerga a árvore — não está lendo o vazio", () => {
    // Sem esta asserção, qualquer quebra silenciosa (caminho errado, regex do
    // import furada, `.tsx` renomeado) deixaria o caso abaixo verde para
    // sempre por não ter nada para analisar.
    const links = todosOsLinksDoPainel();
    expect(links.length).toBeGreaterThanOrEqual(PISO_DE_LINKS_ENCONTRADOS);

    // E enxerga os dois arquivos que a auditoria nomeou. Um piso de contagem
    // sozinho passaria mesmo que a varredura tivesse perdido justamente as
    // telas do achado.
    const arquivos = new Set(links.map((l) => l.arquivo));
    expect(arquivos).toContain("src/app/(painel)/configuracoes/layout.tsx");
    expect(arquivos).toContain("src/app/(painel)/fluxos/[id]/page.tsx");
    expect(arquivos).toContain("src/components/nav-links.tsx");
  });

  it("todo <Link> do painel é prefetch={false}", () => {
    const violacoes = todosOsLinksDoPainel()
      .filter((l) => !l.temPrefetchFalso)
      .filter((l) => SEM_PREFETCH_JUSTIFICADO[l.arquivo] === undefined)
      .map((l) => `${l.arquivo}:${l.linha}`);

    expect(
      violacoes,
      "`<Link>` do painel sem `prefetch={false}`. O padrão do Next é `auto`, " +
        "que PRÉ-BUSCA rota dinâmica até o `loading.js` mais próximo — e este " +
        "painel tem `(painel)/loading.tsx`. A pré-busca leva o cookie de sessão " +
        "ao servidor, o Auth.js o reemite, e uma resposta em voo no momento do " +
        '"Sair" desfaz a revogação. É o defeito de `0a81737`, contado no ' +
        "AGENTS.md. Acrescente `prefetch={false}` ou justifique em " +
        "`SEM_PREFETCH_JUSTIFICADO`, com o motivo escrito."
    ).toEqual([]);
  });

  it("toda exceção nomeada existe em disco e carrega justificativa", () => {
    // Hoje a lista está vazia e este caso passa sem exercitar nada — está
    // certo, e é a razão de a asserção da contagem vir junto: ela documenta
    // que o zero é o estado atual, e não uma lista que sumiu.
    expect(Object.keys(SEM_PREFETCH_JUSTIFICADO)).toEqual([]);

    for (const [arquivo, motivo] of Object.entries(SEM_PREFETCH_JUSTIFICADO)) {
      expect(existsSync(join(RAIZ_PROJETO, arquivo)), `${arquivo} não existe`).toBe(true);
      expect(motivo.length, `${arquivo} sem justificativa de verdade`).toBeGreaterThan(40);
    }
  });

  // ───────────────────────────────────────────────────────────────────────
  // A prova de que a trava morde. Sem estes casos, um regex quebrado deixa a
  // lista de violações vazia para sempre e o portão fica verde sem ter lido
  // nada — a mesma defesa que `migracoes-seguras.test.ts` chama de "a regra
  // realmente pega o caso do incidente".
  // ───────────────────────────────────────────────────────────────────────

  it("reprova o <Link> sem a prop — o caso exato do achado", () => {
    // Texto copiado da forma que `(painel)/configuracoes/layout.tsx` tinha
    // antes da correção, na régua que divide a tela com o botão "Sair".
    const doAchado = `
      import Link from "next/link";
      export function Regua() {
        return <Link href="/configuracoes/conexoes" className="px-3">Conexões</Link>;
      }
    `;
    const achados = analisarArquivo("falso.tsx", doAchado);
    expect(achados).toHaveLength(1);
    expect(achados[0].temPrefetchFalso).toBe(false);
  });

  it("aprova o mesmo <Link> depois da correção", () => {
    const corrigido = `
      import Link from "next/link";
      export function Regua() {
        return <Link href="/configuracoes/conexoes" prefetch={false}>Conexões</Link>;
      }
    `;
    expect(analisarArquivo("falso.tsx", corrigido)[0].temPrefetchFalso).toBe(true);
  });

  it("`prefetch` que não seja literalmente {false} é reprovado", () => {
    // `prefetch` nu vale `true`; `{true}` é o oposto da regra; e uma variável
    // é forma que a varredura não sabe ler — nos três casos ela acusa, porque
    // não pode AFIRMAR que a pré-busca está desligada.
    for (const prop of ["prefetch", "prefetch={true}", "prefetch={PADRAO}"]) {
      const fonte = `import Link from "next/link";\nconst x = <Link href="/x" ${prop} />;`;
      expect(analisarArquivo("falso.tsx", fonte)[0].temPrefetchFalso, prop).toBe(false);
    }
  });

  it("prosa em comentário não conta como <Link>", () => {
    // A metade que impede a trava de reprovar a própria documentação: os
    // arquivos corrigidos EXPLICAM a regra escrevendo `<Link>` no comentário.
    const soComentario = `
      import Link from "next/link";
      // Todo <Link href="/x"> do painel precisa da prop.
      /* E aqui também: <Link href="/y"> sem prefetch seria um defeito. */
      const x = <Link href="/x" prefetch={false} />;
    `;
    expect(analisarArquivo("falso.tsx", soComentario)).toHaveLength(1);
  });

  it("componente com nome parecido não é acusado", () => {
    // `<LinkStatus>` e `<Linkedin>` começam com `Link` e não são navegação. Sem
    // a fronteira `(?=[\s/>])` os dois entrariam na conta e treinariam todo
    // mundo a ignorar o portão.
    const vizinhos = `
      import Link from "next/link";
      const a = <LinkStatus />;
      const b = <Linkedin size={16} />;
      const c = <Link href="/x" prefetch={false} />;
    `;
    const achados = analisarArquivo("falso.tsx", vizinhos);
    expect(achados).toHaveLength(1);
    expect(achados[0].temPrefetchFalso).toBe(true);
  });

  it("arquivo que não importa next/link é ignorado por inteiro", () => {
    // Um `<Link>` local, de outra biblioteca, não pré-busca nada. Acusá-lo
    // seria ruído — e ruído em portão de segurança é o que faz o portão ser
    // ignorado no dia do achado de verdade.
    const outroLink = `
      import { Link } from "algum-design-system";
      const x = <Link href="/x">rótulo</Link>;
    `;
    expect(analisarArquivo("falso.tsx", outroLink)).toEqual([]);
  });

  it("import default renomeado continua sendo cobrado", () => {
    // `import NextLink from "next/link"` é a mesma navegação com outro nome, e
    // uma varredura por `<Link` literal o perderia inteiro.
    const renomeado = `
      import NextLink from "next/link";
      const x = <NextLink href="/x">rótulo</NextLink>;
    `;
    const achados = analisarArquivo("falso.tsx", renomeado);
    expect(achados).toHaveLength(1);
    expect(achados[0].temPrefetchFalso).toBe(false);
  });

  it("`useLinkStatus` sozinho não faz o arquivo virar navegação", () => {
    // O caso real de `src/components/indicador-de-link.tsx`: import NOMEADO de
    // `next/link`, sem default, sem renderizar `<Link>` nenhum.
    const soHook = `
      import { useLinkStatus } from "next/link";
      export function Indicador() {
        const { pending } = useLinkStatus();
        return <span data-pendente={pending} />;
      }
    `;
    expect(analisarArquivo("falso.tsx", soHook)).toEqual([]);
  });

  it("o `>` de uma seta dentro de expressão não fecha a tag", () => {
    // O caso real de `notification-bell.tsx`. Se a leitura parasse no primeiro
    // `>`, os atributos seriam cortados antes do `prefetch={false}` e o
    // arquivo corrigido seria acusado — falso positivo que faria alguém
    // "consertar" duas vezes o que já estava certo.
    const comSeta = `
      import Link from "next/link";
      const x = (
        <Link href={\`/leads/\${id}\`} onClick={() => setAberto(false)} prefetch={false}>
          rótulo
        </Link>
      );
    `;
    const achados = analisarArquivo("falso.tsx", comSeta);
    expect(achados).toHaveLength(1);
    expect(achados[0].temPrefetchFalso).toBe(true);
  });

  it("tag que nunca fecha é reprovada, não ignorada", () => {
    // Forma que a varredura não sabe ler é o caso em que ela não pode afirmar
    // nada — então acusa. Mesma postura de `sqlDaChamada` devolvendo `null` em
    // `catraca-prisma-cru.test.ts`.
    const quebrado = `import Link from "next/link";\nconst x = <Link href="/x" prefetch={false}`;
    const achados = analisarArquivo("falso.tsx", quebrado);
    expect(achados).toHaveLength(1);
    expect(achados[0].temPrefetchFalso).toBe(false);
  });
});
