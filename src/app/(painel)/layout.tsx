import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ThemeProvider } from "next-themes";

import { client } from "../../../config/client";
import { PainelNav } from "@/components/painel-nav";
import { usuarioAtual } from "@/core/auth/session";
import { configDaEmpresa } from "@/core/config/leitura";
import { listarNotificacoesNaoLidas } from "@/core/notifications/dispatch";
import { derivarTema } from "@/lib/tema";
import { fonteDaMarca } from "@/lib/tema/fontes";
import { apresentarNotificacoes } from "./apresentar-notificacoes";

/**
 * Força renderização dinâmica em TODA página sob este layout — segment
 * config em layout se propaga para as rotas filhas. Sem isso, `next build`
 * tenta pré-renderizar páginas protegidas como estáticas: a Vercel expôs
 * isso (ambiente local mascarava o problema por acaso conseguir alcançar o
 * banco em build-time). Duas consequências reais, não só o build quebrar:
 * (1) o build faria uma chamada ao banco sem contexto de usuário algum,
 * e (2) se a chamada tivesse sucesso, a página ficaria "congelada" com o
 * dado daquele instante do deploy — todo visitante veria a mesma foto
 * antiga do funil/dashboard/leads, não o dado ao vivo por sessão.
 */
export const dynamic = "force-dynamic";

/**
 * O título da aba passa a ser o nome da EMPRESA nas rotas do painel.
 *
 * Metadata de layout filho substitui a do raiz nas rotas dele, então `/login`
 * — que fica FORA de `(painel)`, em `src/app/login/page.tsx` — continua com o
 * nome do produto, vindo de `config/client.ts`. É o desenho inteiro do Ciclo 1c
 * em uma linha: fora da sessão não existe empresa, logo não existe marca de
 * empresa.
 *
 * Custo: zero consulta nova. `usuarioAtual()` e `configDaEmpresa()` são as duas
 * memoizadas por requisição (`cache()` do React — ver `core/auth/session.ts` e
 * `core/config/leitura.ts`), e `generateMetadata` roda na mesma requisição do
 * render.
 *
 * `try/catch` porque `generateMetadata` roda em PARALELO ao render: uma sessão
 * que morre no meio faz `usuarioAtual()` rejeitar aqui, e rejeição não tratada
 * vira tela de erro genérica com digest — em vez do redirecionamento para
 * `/login` que o componente abaixo faz. É o MESMO raciocínio que pôs o
 * `try/catch` em `usuarioAtualOuLogin`, e lá ele não é hipótese: o Sentry
 * registrou `Não autenticado` como erro NÃO TRATADO em `GET /leads`
 * (`core/auth/session.ts`, seção "Por que isto existe"). O que está registrado
 * é o defeito na PÁGINA; aqui a forma é a mesma — mesma requisição, mesma
 * chamada, mesma corrida — e o caso "cai no nome do PRODUTO quando não há
 * sessão" em `tests/unit/painel-layout-marca.test.tsx` é quem prova que este
 * caminho não lança.
 *
 * **O `catch` é largo, e isso precisa ser dito por inteiro:** ele envolve as
 * DUAS chamadas, então uma `ConfigDaEmpresaInvalidaError` também cai aqui e o
 * título vira o do produto. Não é a decisão "config inválida RECUSA" sendo
 * afrouxada — quem recusa é o COMPONENTE abaixo, que chama `configDaEmpresa`
 * sem guarda nenhuma e derruba a rota inteira. Com a rota já derrubada, fazer
 * a metadata rejeitar junto não salva nada: dá duas rejeições no lugar de uma,
 * e a segunda nem tem tela para mostrar. Estreitar o `try` só à sessão seria
 * exatamente isso, e por isso não foi feito.
 *
 * Quem prova que a recusa continua de pé é o caso "config inválida derruba o
 * render, mesmo com a metadata degradando" em
 * `tests/unit/painel-layout-marca.test.tsx` — escrito porque uma frase deste
 * bloco afirmava o contrário e não tinha caso que a exercitasse.
 */
export async function generateMetadata(): Promise<Metadata> {
  try {
    const usuario = await usuarioAtual();
    const config = await configDaEmpresa(usuario.companyId);
    return { title: config.nome, description: `Painel de gestão — ${config.nome}` };
  } catch {
    return { title: client.nome, description: `Painel de gestão — ${client.nome}` };
  }
}

/**
 * Layout do painel autenticado. Toda página sob `(painel)` — hoje só
 * `page.tsx`, mas também qualquer página que as Tasks 14-21 adicionarem
 * (lista de leads, kanban, dashboard, dados de contato) — passa por aqui.
 * É o ponto mais estreito que cobre TODA página protegida de uma vez, sem
 * precisar repetir a checagem em cada `page.tsx` nova.
 *
 * `/login` NÃO fica sob este layout — mora em `src/app/login/page.tsx`,
 * fora do route group `(painel)` (fix round 2/5; antes ficava em
 * `(painel)/login/page.tsx`). De propósito: se `/login` estivesse aninhada
 * aqui, um visitante sem sessão que abrisse `/login` cairia num loop (este
 * layout manda pra `/login`, que está sob o mesmo layout que manda de novo
 * pra `/login`, indefinidamente). A URL não muda — route groups não entram
 * no path — só o layout que envolve a página.
 *
 * Chama `usuarioAtual()` (não `auth()` direto) de propósito: `usuarioAtual`
 * já rejeita tanto "sem sessão" quanto "usuário desativado" (fix round
 * 1/5) com o mesmo erro — então este layout trata as duas situações de
 * forma idêntica, sem precisar saber que a segunda existe. Antes deste fix,
 * só as Server Actions (`src/core/leads/actions.ts`) chamavam
 * `usuarioAtual()`; alguém desativado com um cookie de sessão ainda válido
 * conseguia navegar (só leitura) por qualquer página do painel — inclusive
 * as que as Tasks 14-21 vão preencher com dado real de cliente (lista de
 * leads, telefone de contato, dashboard). `src/proxy.ts` não fecha esse gap
 * sozinho: ele só sabe se existe um JWT válido (`!!req.auth`), não se o
 * usuário continua ativo — ver o comentário em `proxy.ts` sobre por que essa
 * checagem não foi movida para lá.
 *
 * Task 19: também busca as notificações não lidas de `usuario` para o sino
 * de `PainelNav`. Decisão deliberada de custo — uma consulta extra
 * (`Notification.findMany`) em TODA navegação sob este layout, ou seja, em
 * toda página do painel:
 * - Reaproveita o `usuario` que `usuarioAtual()` já resolveu para checar a
 *   sessão (uma consulta a `User` que já acontecia aqui de qualquer forma)
 *   em vez de o sino (ou `PainelNav`) buscar a sessão de novo — a consulta
 *   nova é só a de `Notification`, não duas.
 * - `Notification` ganhou `@@index([userId, lidaEm])` (prisma/schema.prisma)
 *   junto com esta task, exatamente para esta consulta: sem índice, `WHERE
 *   userId = ? AND lidaEm IS NULL` vira sequential scan à medida que a
 *   tabela cresce (toda criação de lead grava uma linha nova, e linhas lidas
 *   nunca são apagadas) — com o índice, é uma busca direta.
 * - Alternativa descartada: mover a busca para dentro de `NotificationBell`
 *   como um Server Component próprio (padrão "ilha", que só aquele pedaço
 *   busca dado, sem o resto do layout esperar por ele). Isso pediria
 *   `<Suspense>` ao redor do sino para não bloquear a navegação nesta fase,
 *   mais uma segunda chamada a `usuarioAtual()`/`User` (o sino não tem
 *   acesso ao `usuario` já resolvido aqui) — complexidade que não se paga
 *   para uma tabela pequena numa CRM de equipe pequena (Fase 0-1). Se o
 *   volume de notificações crescer a ponto de a consulta pesar na
 *   navegação, essa é a próxima mudança a fazer — não algo para antecipar
 *   agora sem dado que justifique.
 */
export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  let usuario;
  try {
    usuario = await usuarioAtual();
  } catch {
    redirect("/login");
  }

  // Traduzido AQUI, não dentro do sino: `apresentarNotificacoes` é o único
  // ponto do código que conhece os tipos de notificação de todos os módulos,
  // e ele mora na raiz de composição de propósito — ver o comentário em
  // `apresentar-notificacoes.ts` sobre o acoplamento que isso desfaz.
  const notificacoesNaoLidas = apresentarNotificacoes(
    await listarNotificacoesNaoLidas(usuario.companyId, usuario.id)
  );

  // Uma consulta, memoizada por requisição (`cache()` em
  // `core/config/leitura.ts`, com o `companyId` como chave): as páginas abaixo
  // deste layout chamam `exigirModulo(usuario.companyId, ...)` e caem na MESMA
  // entrada, então o portão de módulo delas não custa ida nova ao banco. A
  // memoização é medida em `tests/unit/config-memoizacao.test.ts` — sob Vitest
  // o `cache()` que resolve é a passa-fio, e por isso ela precisa de um
  // dispatcher instalado à mão para ser afirmada; a CORRETUDE não depende
  // dela.
  //
  // Config inválida derruba ESTE layout, de propósito: `configDaEmpresa`
  // recusa em vez de cair no padrão, e o erro sobe. É a decisão registrada em
  // `core/config/leitura.ts`, e o custo dela (navegação daquela empresa fora
  // do ar até a linha ser corrigida) está escrito lá.
  const config = await configDaEmpresa(usuario.companyId);

  // `headers()` é assíncrona no Next 16. Ler o nonce aqui não custa nada:
  // este layout já é `force-dynamic`. Na raiz, tornaria TODA rota dinâmica
  // para servir um recurso que só o painel usa. `src/proxy.ts` grava o
  // mesmo valor no header `Content-Security-Policy` da RESPOSTA — os dois
  // precisam bater para o script anti-flash do `next-themes` rodar sob
  // `strict-dynamic`.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  // Os dois derivados da marca da EMPRESA, resolvidos aqui pelo mesmo motivo
  // que `modulos` e `nomeMarca`: este é o ponto que tem `companyId` em mãos.
  const fonte = fonteDaMarca(config.marca.fonte);
  const tema = derivarTema(config.marca);

  return (
    <ThemeProvider
      attribute="class"
      themes={["light", "dark"]}
      enableSystem={false}
      defaultTheme="dark"
      nonce={nonce}
    >
      {/*
        O SEGUNDO bloco de tema do documento. O layout raiz já emitiu um, com o
        padrão de `config/client.ts`; este sobrepõe com a marca da EMPRESA da
        sessão.

        Ele vence por ORDEM, não por especificidade: os dois usam `:root:root`
        — (0,2,0), escolhido em `src/lib/tema/index.ts` para vencer
        `globals.css` sem depender de ordem de inserção —, e entre blocos de
        especificidade igual o CSS aplica o que vem depois no documento. Este
        está no `<body>`, o do raiz no `<head>`. Sem flash: os dois chegam no
        mesmo HTML da mesma resposta.

        A raiz NÃO faz isto, e não é por custo de renderização dinâmica: medido
        em 2026-08-20, `npm run build` mostra UMA rota estática no projeto
        inteiro (`/_not-found`). É porque a raiz envolve `/login`, onde não há
        sessão e portanto não há empresa — dinamizá-la não faria aparecer um
        `companyId` que não existe, só acrescentaria uma consulta sem resposta a
        toda requisição fora do painel.

        `dangerouslySetInnerHTML` com valor que agora vem do BANCO: o que fecha
        não é a origem. `derivarTema` só emite números — `hexParaOklch` LANÇA
        para qualquer coisa fora de `#RRGGBB` e `formatarOklch` produz
        exclusivamente numerais —, e o valor já atravessou `marcaSchema` na
        leitura. Duas travas, e a segunda tem caso em
        `tests/unit/painel-layout-marca.test.tsx`, que afirma que o texto
        emitido não contém `<`.

        O CSP não muda: `style-src` já é `'self' 'unsafe-inline'` por causa do
        atributo `style` das cores de etapa no kanban (ver `src/proxy.ts` e
        `lib/tema/index.ts`), e este `<style>` é do mesmo tipo do que já existe
        na raiz — sem nonce, porque acrescentar nonce à diretiva INVALIDARIA o
        `'unsafe-inline'` e quebraria o kanban.
      */}
      <style dangerouslySetInnerHTML={{ __html: tema }} />
      {/*
        AS DUAS classes, e a segunda é a que ninguém lembra.

        `fonte.variable` redefine `--font-marca` NESTE elemento. Só isso não
        muda nada: `globals.css` aplica `font-sans` no `<html>`, o `font-family`
        computado ali já resolveu `var(--font-marca)` com o valor do arquivo, e
        descendentes herdam o VALOR COMPUTADO — não a variável. `font-sans` aqui
        força a reavaliação nesta subárvore.

        É falha silenciosa: sem `font-sans` a tela continua bonita, com a fonte
        do arquivo, e nada denuncia que a fonte da empresa foi ignorada. Por
        isso o caso de teste afirma as DUAS classes no mesmo elemento.
      */}
      <div className={`${fonte.variable} font-sans flex min-h-screen flex-col lg:flex-row`}>
        {/* `papelUsuario` alimenta o link de "Equipe", que só ADMIN vê.
            `PainelNav` é síncrona e não tem acesso à sessão — o papel vem daqui,
            do `usuario` que `usuarioAtual()` já resolveu, sem consulta nova.
            `modulosAtivos`, `nomeMarca` e `logo` seguem o mesmo caminho desde o
            Ciclo 1c: vêm do banco, por empresa, e são resolvidos AQUI para a
            barra continuar síncrona e renderizável sem Postgres. */}
        <PainelNav
          notificacoesNaoLidas={notificacoesNaoLidas}
          nomeUsuario={usuario.nome}
          papelUsuario={usuario.papel}
          modulosAtivos={config.modulos}
          nomeMarca={config.nome}
          logo={config.marca.logo}
        />
        <main className="flex-1">{children}</main>
      </div>
    </ThemeProvider>
  );
}
