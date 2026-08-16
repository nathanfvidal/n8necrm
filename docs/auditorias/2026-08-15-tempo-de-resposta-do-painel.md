# Auditoria de segurança — tempo de resposta do painel

Data: 2026-08-15 · Escopo: `feat/painel-transicao-visivel` (`026b38f`, `7db8b45`) e
`feat/painel-menos-idas-ao-banco` (`e90f8b4`), empilhadas sobre `main` `375f430` ·
Ambiente: build de produção local (`next build` + `next start`, `AUTH_TRUST_HOST=true`)
contra o Postgres real e compartilhado do Supabase

## Resumo

❌ Falhas críticas: **0**  ⚠️ Riscos: **5**  ✅ Verificados OK: **19**  🔍 Não verificados: **3**

Nenhuma rota, endpoint ou Server Action nova; nenhuma migração; nenhuma mudança de schema.
A superfície é de renderização e cache, não de acesso a dado — e isso se confirma no
diagnóstico: nada nesta branch amplia o que alguém consegue **ler do banco** ou **escrever**.

O que precisa de decisão hoje é **R1**: `staleTimes.dynamic: 30` abre uma janela de até 30
segundos em que um usuário **desativado no meio da sessão continua vendo as telas que já
tinha aberto**, servidas do cache do próprio navegador, sem passar pelo servidor. Provado ao
vivo. Escrita e dado novo continuam bloqueados — mas isto toca exatamente a classe de
defeito que este projeto já teve (*"Sessão que sobrevive"*), então a severidade é do dono,
não minha.

---

## ⚠️ Riscos

### R1 — Usuário desativado continua vendo, por até 30 s, as telas que já abriu

**Onde:** [next.config.ts](../../next.config.ts) — `experimental.staleTimes.dynamic: 30`

**Impacto:** alguém desligado da empresa continua enxergando a lista de leads e a agenda de
contatos por até meio minuto depois de o ADMIN clicar em "Desativar", desde que as telas já
estivessem abertas na sessão. Nenhum dado novo, e nenhuma escrita.

**Evidência** (sonda temporária, já removida — usuário `zz-sonda-auditoria@teste.invalid`
criado e apagado, banco conferido sem resíduo):

```
$ npm run test:e2e -- tests/e2e/zzz-sonda-auditoria.spec.ts
SONDA nav-cliente => url=http://localhost:3000/leads heading_leads=1 tabelas=1
SONDA acao        => alerta=["Sua sessão expirou. Recarregue a página e entre de novo."] leads_criados=0
SONDA aba-nova    => url=http://localhost:3000/login
SONDA goto        => url=http://localhost:3000/login
```

Lido linha a linha: a aba **já visitada** ainda renderiza a tabela; a **ação** é recusada e
grava zero; a aba **nunca visitada** vai para o login; o **F5** vai para o login.

**Por que não é crítico:** o payload daquelas telas já estava na memória do navegador dela
antes da desativação — quem simplesmente não fechasse a aba veria o mesmo, e isso sempre foi
verdade. Não há acesso a dado que ela ainda não tivesse.

**Por que mesmo assim é risco:** antes desta branch, o clique na aba ia ao servidor e caía
no `/login` na hora. A janela é nova. E `equipe.spec.ts`, que existe justamente para provar
a revogação, **não cobre este caminho**: ele usa `page.goto("/leads")`, carregamento
completo, que sempre bate no servidor.

**Correção proposta:** três caminhos, e a escolha é de produto —
(a) baixar `dynamic` para ~5 s, que preserva quase todo o ganho de troca de aba e encolhe a
janela; (b) manter 30 s e aceitar explicitamente; (c) manter 30 s e adicionar um teste
permanente cobrindo o caminho client-side, para que a janela seja uma decisão registrada e
não um efeito colateral.
**Risco de corrigir:** (a) reduz o ganho medido de "voltar para aba recente" (0 consultas,
~100 ms contra ~1000 ms). Nenhum risco técnico.

---

### R2 — Quatro comentários agora afirmam coisas que o código não faz mais

**Onde:**
- [src/core/leads/actions.ts:72](../../src/core/leads/actions.ts#L72) — *"`LeadForm` (client) já chama `router.refresh()` no sucesso, e isso é o bastante para a TABELA"*. **Não chama mais.**
- [src/components/notifications/notification-bell.tsx:76](../../src/components/notifications/notification-bell.tsx#L76) — *"`LeadForm` chama `router.refresh()`"*. **Idem.**
- [src/core/users/service.ts:278](../../src/core/users/service.ts#L278) — *"`usuarioAtual()` checa `ativo` a cada chamada"*. Agora é **a cada requisição** (`cache()`).
- [tests/e2e/equipe.spec.ts:8](../../tests/e2e/equipe.spec.ts#L8) — mesma frase.

**Impacto:** quem for mexer em revalidação de lead vai ler que o refresh do formulário é o
que atualiza a tabela, e desenhar em cima de uma premissa falsa. É a mesma classe de defeito
que o commit `1ebce76` ("limpa comentarios e nomes que ainda afirmavam a invariante velha")
já teve de corrigir uma vez neste repositório.

**Evidência:**
```
$ grep -rn "router.refresh" src/core/ src/components/notifications/
src/core/leads/actions.ts:72:    // chama `router.refresh()` no sucesso, e isso é o bastante para a
src/components/notifications/notification-bell.tsx:76: * invalidar o cache do servidor, e `LeadForm` chama `router.refresh()` — mas
$ grep -c "router.refresh" src/components/leads/lead-form.tsx   # só o comentário novo
1
```

**Correção proposta:** reescrever os quatro trechos. **Risco de corrigir:** nenhum — é texto.

---

### R3 — `catch` vazio engole qualquer falha ao agendar a poda

**Onde:** [src/core/notifications/dispatch.ts](../../src/core/notifications/dispatch.ts) — `agendarPoda()`

**Impacto:** o `try/catch` existe para tolerar chamada fora de contexto de requisição (o
teste de unidade), mas ele engole **toda** exceção de `after()`, sem registrar nada. Se um
dia `after()` falhar por outro motivo, a poda para de rodar e a tabela `Notification` volta
a crescer sem teto — em silêncio, que é o modo de falha que este projeto trata como defeito
(*"silêncio como falha"*, etapa 9).

**Evidência:**
```
$ git diff 375f430..HEAD | grep -nE "^\+.*catch\s*\{"
965:+  } catch {
```

**Correção proposta:** distinguir o caso esperado (sem contexto de requisição) do
inesperado, e `console.error` no segundo. **Risco de corrigir:** nenhum.

---

### R4 — O streaming duplica o conteúdo no DOM e derruba localizador estrito

**Onde:** [src/app/(painel)/loading.tsx](../../src/app/(painel)/loading.tsx) — consequência da fronteira de `<Suspense>`

**Impacto:** **não é defeito de produção** (ver evidência), mas é uma taxa permanente sobre
a suíte: qualquer spec futuro que use localizador estrito logo depois de um `goto` numa rota
do painel pode falhar de forma intermitente com *"resolved to 2 elements"*. Falhou em 2 de 6
execuções da suíte completa antes de ser diagnosticado, em três arquivos diferentes. O
perigo real é alguém descartar como teste instável — que é exatamente a história que abre a
`AGENTS.md`.

**Evidência de que não alcança produção:** diagnóstico contra o build de produção mediu
**zero violação de CSP, nenhum marcador `[id^="S:"]` sobrevivente e uma única `<table>`** três
segundos depois da navegação — o script inline de troca roda, e a cópia extra nasce e morre
dentro de `<div hidden>`.

**Mitigação já aplicada:** `etapas.spec.ts`, `whatsapp-agente.spec.ts` e `lead-edicao.spec.ts`
passaram a filtrar por `visible: true`, cada um com o comentário explicando a causa; 5
execuções seguidas da suíte completa ficaram em 41/41.

**Correção proposta:** nenhuma no código. Fica registrado para quem escrever o próximo spec.

---

### R5 — Consultas passam a começar antes de a sessão estar confirmada

**Onde:** [leads/page.tsx](../../src/app/(painel)/leads/page.tsx), [contatos/page.tsx](../../src/app/(painel)/contatos/page.tsx), [(painel)/page.tsx](../../src/app/(painel)/page.tsx)

**Impacto:** uma requisição com cookie de usuário **desativado** executa dois ou três
`SELECT` inócuos antes de `redirect()` mandá-la ao login. É trabalho jogado fora, não dado
entregue — nada é renderizado, e o `src/proxy.ts` já barrou quem não tem cookie nenhum.

**Evidência:** a sonda de R1 mostra que o usuário desativado que faz `goto` termina em
`/login` sem conteúdo do painel; e sem sessão nenhuma:
```
$ curl -s -o /dev/null -w "status=%{http_code} location=%{redirect_url}\n" http://localhost:3000/leads
status=307 location=http://localhost:3000/login
$ curl -s -L http://localhost:3000/leads | grep -c 'data-slot="skeleton"\|Dashboard\|usuario-logado'
0
```

**Correção proposta:** nenhuma — está registrado de propósito, com comentário no código, para
que a troca seja visível e não descoberta. **Se o dono preferir**, dá para voltar as três
páginas ao `await` sequencial ao custo do ganho medido.

---

## ✅ Verificado e correto

| Item | Como foi verificado |
|---|---|
| Nenhuma rota, endpoint ou Server Action nova | `git diff --name-only 375f430..HEAD` → só 3 `page.tsx` existentes |
| Nenhuma migração / mudança de schema | `git diff --name-only 375f430..HEAD \| grep prisma/` → vazio |
| Nenhum segredo no diff das 3 commits | `git diff \| grep -iE "sk-\|AIza\|eyJ\|Bearer \|postgres://\|api[_-]?key"` → só falso-positivo em `task-list.tsx` |
| Nenhuma variável `NEXT_PUBLIC_` nova | `git diff \| grep "^+.*NEXT_PUBLIC"` → vazio |
| `.env` fora do versionamento | `git check-ignore -v .env` → `.gitignore:14:.env*` |
| Rota do painel sem sessão não vaza nada | `curl` → `307 → /login`; corpo seguido tem 0 ocorrências de esqueleto/nav/usuário |
| Todo `<script>` servido carrega nonce | `grep -o "<script[^>]*>" \| grep -vc nonce=` → `scripts=14 sem_nonce=0` |
| CSP não é violado em nenhuma tela do painel, já com streaming | `seguranca-headers.spec.ts` "nenhuma tela do painel viola o CSP" verde no código final |
| Fronteira servidor→cliente intacta (sem linha crua, sem e-mail/`sessionId`/`utm`) | `fronteira-rsc.spec.ts` verde no código final |
| Ação de usuário desativado é recusada e grava zero | sonda R1 → `alerta=["Sua sessão expirou..."] leads_criados=0` |
| Aba não visitada e F5 mandam o desativado ao login | sonda R1 → `url=.../login` nos dois |
| `cache()` não vaza entre requisições nem quebra o gate de `ativo` | `tests/unit/session.test.ts` 4/4 — chama `usuarioAtual()` várias vezes no mesmo processo esperando respostas diferentes |
| Logout continua revogando, mesmo com cache de cliente ligado | `sessao-e-cache.spec.ts` verde; **sabotado**: com `signOut` trocado por `redirect`, o cache DEVOLVE o painel e o teste fica vermelho |
| O cache de 30 s está realmente ligado (não é teste decorativo) | mesmo arquivo, **sabotado** com `dynamic: 0` → teste vermelho |
| `staleTimes` é flag reconhecida no Next 16.3, sem depreciação | `npm run build` → lista `· staleTimes` em Experiments, sem aviso |
| Indicador de link não entra no nome acessível | `nav-links.test.tsx` + `transicao.spec.ts`; **sabotado** com texto no indicador → vermelho |
| Revogação por desativação em carregamento completo | `equipe.spec.ts` verde |
| Suíte de unidade | `npx vitest run` → 933/933 em 94 arquivos |
| Suíte e2e | `npm run test:e2e` → 41/41, cinco execuções consecutivas |

---

## 🔍 Não verificados

| Item | Por que não deu | Comando para verificar | O que significa cada resposta |
|---|---|---|---|
| Comportamento do streaming atrás da infra da Vercel | Sem URL de deploy acessível a este ambiente | Abrir uma tela do painel no deploy e conferir no DevTools que o esqueleto aparece e some | Esqueleto que **fica** = script de troca bloqueado lá (CSP ou proxy da plataforma), e aí é defeito de produção |
| Headers e HSTS no domínio real | Idem | `curl -sI https://<dominio>/leads` | Falta `Strict-Transport-Security` → risco de downgrade |
| Região da função na Vercel | Só o painel do provedor mostra | `Settings → Functions → Function Region` | `iad1` com banco em `sa-east-1` = cada consulta atravessa o continente (~120–160 ms) |

---

## Só um humano pode fazer

1. **Decidir R1** — 30 s, 5 s, ou aceitar como está. É decisão de produto sobre quanto tempo
   um desligado pode continuar olhando a tela que já estava aberta.
2. **Conferir a região da função na Vercel** (`gru1` vs `iad1`). Não é segurança; é o maior
   fator isolado de lentidão medido, e não tem uma linha de código.
3. **Abrir o painel no deploy real depois do merge** e confirmar que o esqueleto aparece e
   some — é o único item desta branch que este ambiente não consegue provar.

---

## Ordem sugerida de correção

1. **R1** — é o único que muda comportamento de segurança, e depende da sua decisão.
2. **R2** — quatro comentários; barato e é a classe de defeito que este repositório já pagou caro.
3. **R3** — uma linha de log.
4. **R4 e R5** — nenhuma correção proposta; ficam registrados.

Nada será corrigido até você aprovar. Se quiser corrigir só parte, diga quais itens.

---

# Fase 2 — correções aplicadas (aprovado em 2026-08-15)

## R1 — resolvido pelo caminho (c): mantém 30 s, trava as garantias

A janela de 30 s **fica**, porque foi decisão explícita do dono. O que faltava era teste:
`sessao-e-cache.spec.ts` ganhou *"desativado no meio da sessão não escreve nem alcança tela
nova, mesmo com o cache quente"*, que cria uma conta descartável, aquece o cache, desativa
com a sessão viva e prova as duas garantias que precisam valer **para qualquer valor de
`staleTimes`**: a escrita é recusada (e o banco continua com zero linhas) e a aba nunca
visitada vai para o login.

O teste afirma as **garantias**, não a janela, de propósito: um teste que dissesse "a aba em
cache ainda renderiza" ficaria vermelho no dia em que alguém baixasse `staleTimes` para 0 —
ou seja, ficaria vermelho por o sistema ter ficado mais seguro.

**Sabotado:** com `if (!usuario.ativo)` trocado por `if (false)` em `session.ts`, o teste
novo **e** o `equipe.spec.ts` ficam vermelhos juntos.

Dois defeitos do próprio teste apareceram e foram corrigidos antes de ele valer:
a fixture em `beforeAll` disputava o mesmo e-mail único entre workers (`fullyParallel: true`
faz cada worker rodar o `beforeAll` do arquivo) — passou a nascer e morrer dentro do teste; e
`getByRole("alert")` casava também com o `__next-route-announcer__`, um `role="alert"`
permanente e vazio que o Next mantém no documento.

## R2 — quatro comentários reescritos

`leads/actions.ts`, `notification-bell.tsx`, `users/service.ts` e `equipe.spec.ts`. O de
`equipe.spec.ts` ganhou também o ponteiro para o arquivo que cobre o caminho que ele não
cobre.

## R3 — corrigido, e a correção derrubou a premissa original

O `catch` passou a registrar em vez de engolir. Mas ao verificar **qual** mensagem filtrar,
o experimento derrubou a justificativa que eu mesmo tinha escrito: trocando o filtro por um
padrão que nunca casa, `tests/unit/notifications.test.ts` roda 6/6 **sem imprimir nada** —
ou seja, **`after()` não lança fora de contexto de requisição sob Vitest**, ao contrário do
que o comentário afirmava.

O `try` ficou, agora declarado como seguro e não como necessidade conhecida, e o filtro de
mensagem saiu: como nenhum caminho conhecido lança, qualquer linha nesse log é surpresa de
verdade. O comentário antigo era exatamente o defeito do R2 — uma afirmação não verificada —
criada por mim enquanto eu corrigia o R2.

## R4 e R5 — sem correção, como proposto

Ficam registrados.

## R6 — achado NOVO da Fase 3: o `loading.tsx` não atende a troca de aba

A reverificação dos fluxos críticos derrubou uma afirmação que eu tinha feito no relatório,
nos comentários do código e na mensagem de commit da Branch 1.

O teste *"o esqueleto aparece enquanto a próxima aba não chega"* falhou em **2 de 3**
execuções da suíte completa. Duas hipóteses minhas foram testadas e descartadas antes da
certa: hidratação tardia (adicionei espera, continuou falhando) e atraso do `reload`
(passou a falhar em 3 de 3, porque `page.route` segura o **início** da resposta e não o
render do servidor).

A causa está numa frase do doc do `loading.js` que eu tinha lido sem entender —
seção "Navigation": *"The Fallback UI is **prefetched**, making navigation immediate unless
prefetching hasn't completed."* Toda navegação deste painel é `prefetch={false}`. Sem
prefetch, o roteador não tem o fallback em mãos no momento do clique: ele busca o segmento,
e quando a resposta chega, o conteúdo já vem junto. O esqueleto só aparecia quando o render
do servidor demorava o bastante para o fallback ser pintado no meio do streaming — sorte,
não garantia.

**O que isso muda, e o que não muda.** O desenho está certo e nada precisou ser removido:
`loading.tsx` atende o **carregamento completo** (primeiro acesso, F5, link colado), que era
o pior número da medição — 1738 ms de tela em branco no F5 de `/leads`. Quem dá sinal na
**troca de aba** é o `IndicadorDeLink` (`useLinkStatus`), e o doc daquele hook recomenda
exatamente esse par para o caso `prefetch={false}`. Eu tinha atribuído o benefício ao
mecanismo errado.

**Correções:** o teste passou a afirmar uma propriedade estável do documento — que o
marcador do esqueleto sai no HTML **antes** da `<table>` —, e o comentário de
`(painel)/loading.tsx` foi reescrito para dizer qual caminho ele atende e qual não atende.
Três execuções determinísticas, e **sabotado**: apagando `loading.tsx`, o marcador some do
HTML e o teste fica vermelho.

A mensagem do commit `026b38f` continua afirmando o benefício errado. Não reescrevo
histórico (regra 6 da skill); fica corrigido aqui e no código.

## Verificação da Fase 2

| | |
|---|---|
| `npm run typecheck` | 0 erros |
| `npm run lint` | 0 erros, 2 warnings pré-existentes |
| `npx vitest run` | 933/933 em 94 arquivos, duas execuções consecutivas |
| `npm run test:e2e` | 42/42, tres execucoes consecutivas apos o R6 |

### Nota operacional — reincidência a NÃO descartar

Uma execução da suíte de unidade durante esta fase reportou **93 arquivos / 919 testes, com
zero falhas** — um arquivo inteiro não rodou, em silêncio. As duas execuções seguintes
voltaram a 94/933 e um relatório JSON confirmou que nenhum arquivo ficou de fora.

É a mesma assinatura registrada na nota operacional do PR do CRUD de etapas
(`Worker exited unexpectedly`, perdendo um arquivo sem nenhum teste falhar), e a mesma
correlação: `.next` existe de novo dentro da pasta sincronizada pelo OneDrive, agora com
**254 MB**, recriado pelo `npm run build` desta auditoria.

Correlação, não prova. **Se voltar a acontecer sem `.next` presente, é sinal independente e
merece investigação própria — não descarte como teste instável.** Um relatório que diz
"93 passed" sem nenhuma falha é indistinguível de sucesso a olho nu, e é exatamente assim
que uma regressão real passa.
