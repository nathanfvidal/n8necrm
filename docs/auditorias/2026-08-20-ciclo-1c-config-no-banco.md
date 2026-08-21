# Auditoria de segurança — Ciclo 1c (configuração de cliente no banco)

**Data:** 2026-08-20
**Escopo:** os 8 commits do Ciclo 1c na branch `ciclo-1a-tenancy`, `031f515..0817907` — a tabela
`CompanyConfig` (12º modelo de tenant), a forma derivada e a fusão pura `mesclarConfig`, a leitura
escopada e memoizada `configDaEmpresa`, o portão de módulos saindo de `src/lib/module-gate.ts` para
`src/core/config/modulos.ts`, o segundo `<style>` com a marca da empresa no layout do painel, o seed
garantindo a linha de config, e a correção da fixture e2e que destravou a suíte inteira.
**Ambiente:** leitura de código e histórico local, execução dos quatro portões e da suíte Playwright
nesta árvore, consulta ao Postgres real do Supabase (projeto `uzumzfxjcxrbxaucvfsr`) via MCP e via
`pg` com a `DIRECT_URL`.
**Escritas ao banco:** esta auditoria **não apagou, criou nem alterou nenhuma linha por conta
própria**. O que escreveu foi consequência dos testes que ela mandou rodar — `npm test` (que roda o
seed e **reescreve o `senhaHash` do admin**, ⚠️ R1 / 🔍 NV5 do Ciclo 1a) e a suíte Playwright, cujas
fixtures criam e apagam as próprias linhas. O estado final está medido na seção **Sonda final ao
banco**. A sonda auxiliar (`sonda-auditoria-1c.cjs`) foi apagada em seguida, e `git status --short`
confirma árvore limpa.

## Resumo

**❌ Críticas em aberto: 0 · ⚠️ Riscos e dívidas: 12 (3 medidos aqui pela primeira vez, 6 declarados
pelo próprio spec, 6 herdados do Ciclo 1a — R3 conta duas vezes por ter piorado) ·
✅ Verificados: 24 · 🔍 Não verificados: 5**

Este ciclo não introduziu vazamento de tenancy. Ele acrescentou **uma** tabela, e a tabela nasceu
com RLS ligada, zero políticas e zero grants para `anon`/`authenticated` — o mesmo default-deny das
outras 15, confirmado sem lista fixa pelo e2e `banco-blindado` e pelo advisor do Supabase, que subiu
de 15 para 16 `rls_enabled_no_policy` exatamente como o spec previu.

**Mas um relatório que parasse aqui seria falso pelo que omite.** O ciclo descobriu, no caminho,
coisas que ninguém tinha ido procurar:

- **A suíte e2e inteira estava em ZERO testes executados, e ninguém sabia.** A fixture
  `garantirContasDeTeste` nunca criou `Membership`; desde o Ciclo 1a `usuarioAtual()` lança sem
  vínculo e o layout do painel devolve para `/login`. O sintoma reportado era "o link Equipe não
  está visível". É o **mesmo defeito** que o commit `e67e1e6` fechou nas fixtures de unidade — a
  fixture e2e ficou de fora daquela varredura, e um relatório anterior a classificou como
  "pré-existente e alheio". Não era alheio: era a mesma família, e era o que separava 0 de 46 testes
  passando.
- **O `cache()` do React tem duas implementações**, e sob Vitest carrega a passa-fio. Um teste
  ingênuo de memoização passaria verde sem memoização nenhuma existir.
- **O JSDoc do layout raiz afirmava um custo que a medição desmente.** Dizia que ler algo dinâmico
  ali "tornaria toda rota dinâmica"; medido, o custo é **1 rota** (`/_not-found`).
- **`User` tem NOVE relações inversas, não oito** como `escopo.ts` afirmava — e esse número é a
  contagem das portas de saída do tenant na leitura aninhada, que é ponto cego DECLARADO do escopo.
  O ciclo abriu a nona ao pendurar `CompanyConfig.atualizadoPorId` em `User`.
- **Três achados novos de fixture e2e, medidos NESTA auditoria** (⚠️ N1, N2, N3), nenhum deles
  introduzido por este ciclo e nenhum deles corrigido aqui — o `AGENTS.md` manda reportar antes.
- **A marca continua nula em toda empresa.** O ciclo destrava a possibilidade de marca por empresa
  sem tomar a decisão nº 8 do programa (identidade do produto), que segue **EM ABERTO por escolha do
  dono**. Isso é cumprimento do spec, não pendência.

---

## Como a verificação foi feita

Toda linha marcada `✅ OK` abaixo carrega o comando e a saída. O que este ambiente não provou está em
`🔍 Não verificados`, com o comando que um humano precisa rodar — nunca como "ok" presumido. A
revisão final do Ciclo 4 pegou uma auditoria afirmando um gate que o código não tinha; a regra existe
por causa disso.

Três restrições de método valem registro:

- **Nada de `vitest` em paralelo.** O banco de teste **não é separado** do de desenvolvimento
  (⚠️ R1 do Ciclo 1a). Todas as execuções citadas aqui foram em série, sozinhas.
- **`npm test` foi executado, e reescreveu a senha do admin.** É `vitest run`; `tests/unit/seed.test.ts`
  chama `seed()` de verdade contra o Postgres e grava literais versionados no `senhaHash` de
  `admin@exemplo.com` e `vendedor@exemplo.com`. Foi rodado porque o Step 3 do briefing desta tarefa
  exige a suíte inteira verde como critério de aceite, e porque a alternativa (`npx vitest run tests/unit`)
  **não** é equivalente: ela roda exatamente os mesmos arquivos de seed contra o mesmo banco. Escolher
  o comando menor mudaria o rótulo, não o efeito. **Rotacionar as duas senhas é ação do dono**, e é
  a única pendência operacional imediata deste documento (🔍 NV5).
- **`grep` desta sessão não é confiável para padrões com aspas.** `grep -c '"src/' eslint.config.mjs`
  devolveu `0` onde o arquivo tem 9 ocorrências — efeito do proxy de linha de comando deste ambiente,
  não do arquivo. Todas as contagens deste documento usam `/usr/bin/grep` ou um parser em Node, e a
  divergência está registrada em **Erros meus, do controlador**, item 1.

---

## 1. O que o ciclo mudou na superfície de segurança

Quatro superfícies, e só quatro:

| Superfície | O que entrou | Onde |
|---|---|---|
| **Banco** | tabela `CompanyConfig`, uma linha por empresa, com RLS e REVOKE na própria migração | `prisma/migrations/20260820180000_company_config/migration.sql` |
| **Leitura escopada** | `configDaEmpresa(companyId)`, via `prismaDaEmpresa`, memoizada por `cache()` | `src/core/config/leitura.ts` |
| **Autorização de rota** | portão de módulos passa a ler o banco, com `companyId` explícito | `src/core/config/modulos.ts` (e `src/lib/module-gate.ts` apagado) |
| **HTML servido** | segundo bloco `<style>` no layout do painel, com valor vindo do banco | `src/app/(painel)/layout.tsx` |

```bash
git diff --stat 031f515^..0817907
# 35 files changed, 2462 insertions(+), 238 deletions(-)
```

**O que NÃO está na lista importa tanto quanto o que está:** `eslint.config.mjs` e
`tests/unit/catraca-prisma-cru.test.ts` não aparecem no `--stat`, porque o ciclo **não os tocou**.

```bash
git diff --stat 031f515^..0817907 -- eslint.config.mjs tests/unit/catraca-prisma-cru.test.ts
# (saída vazia)
```

Essa saída vazia é a prova mais forte de ✅21 e ✅22 abaixo: não houve exceção nova de lint nem
afrouxamento de catraca, porque os dois arquivos que poderiam concedê-los estão byte a byte iguais.

---

## 2. A tabela nova nasceu blindada — e sem backfill

A migração é a única do ciclo, e o que ela faz de segurança está em duas linhas que o Prisma **não**
emite sozinho:

```sql
-- prisma/migrations/20260820180000_company_config/migration.sql:55-56
ALTER TABLE "CompanyConfig" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "CompanyConfig" FROM anon, authenticated;
```

E o que ela **não** faz:

```bash
/usr/bin/grep -nE "ENABLE ROW LEVEL|REVOKE|INSERT|CREATE TABLE|ADD CONSTRAINT|CREATE UNIQUE" \
  prisma/migrations/20260820180000_company_config/migration.sql
# 18:CREATE TABLE "CompanyConfig" (
# 33:CREATE UNIQUE INDEX "CompanyConfig_companyId_key" ON "CompanyConfig"("companyId");
# 36:ALTER TABLE ... ADD CONSTRAINT "CompanyConfig_companyId_fkey" ... REFERENCES "Company"("id")
# 39:ALTER TABLE ... ADD CONSTRAINT "CompanyConfig_atualizadoPorId_fkey" ... REFERENCES "User"("id")
# 55:ALTER TABLE "CompanyConfig" ENABLE ROW LEVEL SECURITY;
# 56:REVOKE ALL ON TABLE "CompanyConfig" FROM anon, authenticated;
```

**Zero `INSERT`.** A tabela nasceu vazia, por decisão do spec (4.4): backfill congelaria no banco uma
identidade de produto que o dono ainda não decidiu. Quem cria a linha é o seed, depois, e só com
`modulos`.

RLS ligada com **zero políticas** é default-deny, e é o estado correto por decisão (§6 do spec). A
exceção NOMEADA para o Realtime continua sendo Ciclo 3, e este ciclo não a antecipou.

### A segunda relação, e o preço dela

`CompanyConfig` tem duas FKs: `companyId → Company` e `atualizadoPorId → User`. A primeira é o que
faz dela modelo de tenant. **A segunda é o que abriu a nona relação inversa em `User`** — ver §4.

---

## 3. O escopo obrigatório continua sendo a defesa real (RLS não protege o Prisma)

A armadilha da base vale integralmente aqui: **RLS não protege o caminho do Prisma**, que conecta com
papel dono de tabela e ignora política de linha. O isolamento por empresa são duas defesas separadas,
e este ciclo mexeu na primeira.

`configDaEmpresa` lê pelo cliente escopado, com `companyId` explícito como primeiro parâmetro:

```
src/core/config/leitura.ts:3   import { prismaDaEmpresa } from "@/core/tenancy/escopo";
src/core/config/leitura.ts:117 export const configDaEmpresa = cache(async function configDaEmpresa(
```

Não existe versão sem argumento, não há `AsyncLocalStorage`, não há estado de módulo. O último ponto
tem caso executável que varre o próprio fonte (`tests/unit/config-leitura.test.ts`), reprovando
`let`/`var`/`new Map`/`new Set`/`new WeakMap`/`globalThis` em escopo de módulo — não é afirmação de
prosa.

O isolamento tem prova contra **Postgres real, com duas empresas**:
`tests/unit/config-isolamento.test.ts` (4 casos), na mesma forma dos sete `*-isolamento.test.ts` do
Ciclo 1d — a empresa A não lê a linha da B, e uma sonda no mesmo arquivo afirma que a consulta **sem**
escopo leria. Sem essa segunda metade, um teste que não encontrasse nada por qualquer motivo passaria.

---

## 4. O ponto cego declarado do escopo ficou **maior**, e o número estava errado

`src/core/tenancy/escopo.ts` documenta quatro pontos cegos. O segundo — leitura aninhada através de
`User` — é contado por um número, e o número envelhece a cada relação nova:

```
src/core/tenancy/escopo.ts:196-201
 * `User` não é modelo de tenant (não tem `companyId` ...) e tem NOVE relações inversas —
 * `leadsAtribuidos`, `tasks`, `notes`, `notifications`, `auditLogs`, `conversasPausadas`,
 * `botConfigsEditadas`, `memberships`, `configsEditadas` (`prisma/schema.prisma`).
 * Eram oito até o Ciclo 1c pendurar `CompanyConfig` em `User` por `atualizadoPorId` — o número
 * aqui não é decorativo, ele conta as portas de saída do tenant e envelhece a cada relação nova.
```

O arquivo dizia **oito**. A Task 1 mediu nove e corrigiu — e o briefing daquela tarefa **não pedia**
essa correção; ela foi a sexta numa lista de cinco. Registro isso como acerto do processo e como
aviso: o número é uma medição com data de validade, não uma constante.

O caminho concreto continua sendo:

```ts
lead.findMany({ include: { responsavel: { include: { leadsAtribuidos: true } } } })
```

O `findMany` externo é escopado; `responsavel` é `User` e passa **intacto** (comportamento medido:
`escopo-empresa.test.ts` compara por identidade de referência); `leadsAtribuidos` sai do tenant.
`configsEditadas` é agora mais uma porta nessa mesma parede. **Nada neste ciclo fecha isso** — é o
⚠️ R3 do Ciclo 1a, e ele ficou uma unidade mais largo.

---

## 5. O portão de módulos saiu de `src/lib/` — e isso é ganho de lint, não cosmética

Antes: `src/lib/module-gate.ts` lia `config/client.ts` (arquivo, global, sem empresa).
Depois: `src/core/config/modulos.ts` lê o banco, com `companyId` como primeiro parâmetro.

```
src/core/config/modulos.ts:61  export async function moduloAtivo(companyId: string, nome: ModuloNome): Promise<boolean>
src/core/config/modulos.ts:87  export async function exigirModulo(companyId: string, nome: ModuloNome): Promise<void>
src/core/config/modulos.ts:88    if (!(await moduloAtivo(companyId, nome))) notFound();
```

```bash
ls src/lib/module-gate.ts   # No such file or directory
ls src/core/config/modulos.ts  # existe
```

**O ganho de segurança é o bloco de lint.** `eslint.config.mjs` só aplica `no-restricted-imports`
sobre `src/core/**`, `src/modules/**` e `src/app/**` (linhas 465, 488, 495). `src/lib/**` **não tem
bloco**. Mover o leitor para `src/core/` o põe debaixo da regra que torna `@/lib/prisma`
inalcançável; deixá-lo em `src/lib/` o mantinha numa árvore que o lint não cobre.

### A ordem das guardas nas seis páginas: sessão → módulo → permissão

Efeito desejado e escrito em cada página: visitante **sem sessão** vai para `/login` em vez de
receber 404. Consequência de segurança concreta: um anônimo deixa de conseguir **enumerar quais
módulos a empresa tem** pela diferença entre as duas respostas. Antes, o portão vinha antes da
sessão e o 404 era observável sem autenticar.

---

## 6. O segundo `<style>`: o que ele carrega, e o que não pode carregar

O layout do painel emite um bloco `:root:root` com a paleta derivada da cor da empresa, por
`dangerouslySetInnerHTML`. Três guardas, e as três têm caso:

1. **Nenhum texto do config chega ao `<style>`.** `tests/unit/painel-layout-marca.test.tsx:156` —
   *"o texto do `<style>` não contém `<`"* — afirma `innerHTML).not.toContain("<")`. O que entra ali
   são números OKLCH derivados de um hex já validado por `marcaSchema`, nunca string livre do banco.
2. **O CSP não mudou e não precisava mudar.** `src/proxy.ts:134` já traz `style-src 'self'
   'unsafe-inline'`. O bloco novo é do mesmo tipo do que a raiz já emitia e **não leva nonce** —
   acrescentar nonce à diretiva invalidaria o `'unsafe-inline'` e quebraria o atributo `style` das
   cores de etapa no kanban. Provado no navegador: `tests/e2e/seguranca-headers.spec.ts` e
   `tests/e2e/tema.spec.ts` verdes (✅19), incluindo o canário que confirma que script inline **sem**
   nonce chegando pela rede continua sendo recusado.
3. **A recusa é alta, não silenciosa.** Linha de config inválida (croma abaixo de `CROMA_MINIMO`,
   fonte fora do enum, logo pela metade, módulo desconhecido) **derruba o render daquela empresa** em
   vez de pintar cinza. É decisão 4.4 do spec, e tem caso que afirma as duas metades na mesma corrida
   (`painel-layout-marca.test.tsx:205`): o componente rejeita **e** a `generateMetadata` degrada para
   o nome do produto.

**A marca de `/login` continua sendo a do arquivo** (D5), com caso próprio no e2e — e isso não é
descuido: sem sessão não há empresa. Um discriminador antes do login (subdomínio, parâmetro) é
desenho de multi-tenant público, de outro ciclo.

---

## 7. O que o ciclo DESCOBRIU, e que é desconfortável

Esta seção existe porque o `AGENTS.md` não permite relatório de sucesso. Nenhum item abaixo é elogio.

### 7.1 A suíte e2e inteira estava em ZERO — e um relatório anterior a arquivou como "alheia"

`tests/e2e/global-setup.ts` provisiona as contas da suíte. Ele criava `User` e **nunca**
`Membership`. Desde o Ciclo 1a, `usuarioAtual()` (`src/core/auth/session.ts`) resolve `companyId` e
`papel` pelo vínculo e **lança** quando não há nenhum; `(painel)/layout.tsx` captura e faz
`redirect("/login")`.

A cadeia era: login funcionava → `/` devolvia para `/login` → `auth.setup.ts` falhava esperando o
link "Equipe" → **nenhum projeto do Playwright chegava a rodar**. A mensagem
(`getByRole('link', { name: 'Equipe' })` … `element(s) not found`) não aponta para nada disso.

Sonda que fechou o diagnóstico, feita pela Task 7 em 2026-08-20:

```
'e2e-admin@teste.invalid'    │ ativo: true │ vinculos: 0
'e2e-vendedor@teste.invalid' │ ativo: true │ vinculos: 0
```

**É a mesma família do commit `e67e1e6`** ("test(audit): fixture cria vinculo, exigido desde o Ciclo
1a"), que fechou exatamente isto nas fixtures de unidade. A fixture e2e ficou de fora daquela
varredura. Corrigido em `c06b1fe`: `garantirContasDeTeste` passou a fazer `upsert` do `Membership`
na empresa mais antiga do banco, **sem criar empresa nova** — porque empresa por execução de suíte é
o resíduo que a auditoria do Ciclo 1a mediu.

O que isso custa registrar: **um relatório anterior classificou a falha como "pré-existente e alheia
ao trabalho recente"**. Era pré-existente, sim. Alheia, não. A diferença entre as duas palavras foi
46 testes e2e.

### 7.2 O `cache()` do React tem duas implementações, e a de teste não memoiza

Medido, não deduzido. O pacote `react` (19.2.4 nesta árvore) publica duas builds, escolhidas pela
condição de exportação `react-server`:

```js
// node_modules/react/cjs/react.development.js:917 — a que o Vitest resolve
exports.cache = function (fn) {
  return function () { return fn.apply(null, arguments); };
};
```

```
// node_modules/react/cjs/react.react-server.development.js:575 — a que o Next carrega num RSC
// lê o dispatcher em ReactSharedInternals.A e desce num nó de cache por valor;
// a chave É a lista de argumentos, não um balde por requisição.
```

**Consequência dura:** um teste de memoização escrito do jeito óbvio, sob Vitest, passa verde sem
memoização nenhuma existir. `src/core/auth/session.ts` já registrava esse fato, e
`tests/unit/session.test.ts` **depende** dele.

A saída foi dois arquivos, e não um afrouxamento (as duas implementações se excluem dentro de um
mesmo arquivo, porque `vi.mock` vale para o arquivo inteiro):

- `tests/unit/config-leitura.test.ts` prova que a **corretude não depende do cache** — duas chamadas
  fora de requisição fazem DUAS consultas com a mesma resposta.
- `tests/unit/config-memoizacao.test.ts` troca `react` pela build `react-server` via `createRequire`,
  instala um dispatcher por caso, e prova a memoização de verdade: mesmo `companyId` → **uma**
  consulta e a mesma referência; `companyId` diferente → duas; dispatcher novo → consulta nova.

O que continua **não** provado: que o Next instala esse dispatcher uma vez por requisição. É contrato
de framework; medir exigiria o painel no ar (🔍 NV3).

### 7.3 O JSDoc do layout raiz afirmava um custo 21 vezes maior do que o medido

A frase dizia que ler algo dinâmico na raiz "tornaria toda rota dinâmica". Medido com `npm run build`:
o custo é **1 rota**.

```
src/app/layout.tsx:28-32
 * Ler o nonce na raiz tornaria dinâmica a única rota que ainda é estática — medido em
 * 2026-08-20 com `npm run build`: `/_not-found`, e nada mais (as outras já são dinâmicas,
 * `/login` inclusive, porque ela chama `usuarioAtual()`). Esta frase dizia "toda rota
 * dinâmica"; o número medido é 1.
```

A frase foi corrigida, **e o argumento de não mexer na raiz foi trocado por um que se sustenta**: a
raiz envolve `/login`, onde não há sessão e portanto não há `companyId`. Esse é o motivo real; o
custo de build nunca foi.

Registro porque é o padrão que o `AGENTS.md` combate: um número inventado que ninguém confere vira
justificativa de arquitetura.

### 7.4 O mock com a forma de `User` do Prisma, terceira reincidência

`tests/unit/fluxos-pages-gate.test.tsx` montava a sessão como `{ papel: "ADMIN" } as const` — a
forma de `User` do Prisma, que **não tem `companyId`**, e não a de `UsuarioAtivo`. Com as páginas
passando a chamar `exigirModulo(usuario.companyId, "automation")`, os casos ficariam **verdes
repassando `undefined`**, e o mock esconderia isso para sempre.

Corrigido acrescentando `companyId` às três fixturas **e** dois casos novos que afirmam o argumento:

```
tests/unit/fluxos-pages-gate.test.tsx:98-99
const ADMIN  = { papel: "ADMIN",  companyId: EMPRESA } as const;
const GESTOR = { papel: "GESTOR", companyId: EMPRESA } as const;
```

É a **terceira** vez que este padrão aparece (as duas anteriores estão no Ciclo 1d e na Task 5 deste
ciclo). Não há mecanismo que o pegue: `as const` num objeto literal não é checado contra
`UsuarioAtivo`. Fica registrado como padrão a procurar, não como caso fechado.

### 7.5 A marca continua NULA em toda empresa — e isso é o spec sendo cumprido

Sonda final: uma `Company`, uma `CompanyConfig`, e `corPrimaria`, `fonte`, `logoClaro` e `logoEscuro`
todos `null`.

O seed cria a linha **só com `modulos`** de propósito (`ddf8f58`). Gravar a cor atual de
`config/client.ts` congelaria no banco a decisão nº 8 do programa — identidade do produto —, que
está **EM ABERTO por escolha do dono**, e a partir daí editar o arquivo deixaria de ter efeito, em
silêncio (D2).

O efeito prático: **o caminho de marca por empresa está ligado, correto e provado, e não está em uso
por ninguém.** Quem quiser exercitá-lo hoje escreve a linha por SQL (D3). Isso é o desenho, não uma
entrega pela metade — mas alguém lendo "marca por empresa entregue" sem este parágrafo entenderia
errado.

---

## 8. Achados novos, medidos NESTA auditoria

Os três são de fixture e2e, **nenhum introduzido por este ciclo**, e nenhum corrigido aqui — o
`AGENTS.md` manda entregar o relatório e parar. Todos ficaram visíveis só porque §7.1 destravou a
suíte.

### ⚠️ N1 — `seguranca-headers.spec.ts` quebra de forma **determinística** com mais de um worker

O arquivo tem um `test.beforeAll` de nível de arquivo (linha 48) que cria um `Contact` com telefone
fixo:

```
tests/e2e/seguranca-headers.spec.ts:24  const TELEFONE_TESTE = "11933330001";
tests/e2e/seguranca-headers.spec.ts:57  const contato = await prisma.contact.create({ ... telefone: TELEFONE_TESTE });
```

`playwright.config.ts` tem `fullyParallel: true` e `workers: 3`. Com testes do mesmo arquivo
distribuídos entre workers, o `beforeAll` roda **uma vez por worker**, e o segundo bate na unicidade
**global** de `Contact.telefone` — que é exatamente o ⚠️ R2 do Ciclo 1a:

```
PrismaClientKnownRequestError:
Invalid `prisma.contact.create()` invocation in tests\e2e\seguranca-headers.spec.ts:57:40
Unique constraint failed on the fields: (`telefone`)
```

Reproduzido de propósito, três execuções:

| Comando | Resultado |
|---|---|
| `npx playwright test tests/e2e/seguranca-headers.spec.ts` (workers=3) | `2 failed · 2 did not run · 4 passed` |
| `npx playwright test <os 4 specs do briefing>` (workers=3) | `1 failed · 1 did not run · 20 passed` |
| `npx playwright test <os 4 specs do briefing> --workers=1` | **`22 passed`** |

Não é teste instável: o resultado muda com o número de workers, e com `--workers=1` é verde sempre.
Na suíte inteira o arquivo não falha, porque a distribuição acaba concentrando seus testes num worker
só — o que torna o defeito **invisível no comando que as pessoas rodam** (`npm run test:e2e`) e
visível em qualquer execução focada. É a pior combinação possível para diagnóstico.

**Conserto sugerido (não aplicado):** `test.describe.configure({ mode: "serial" })` no arquivo, ou
telefone derivado do índice do worker, ou `upsert` no lugar do `create`. Fechar o R2 do Ciclo 1a
(unicidade composta com `companyId`) **não** resolve este caso, porque as duas linhas seriam da mesma
empresa.

### ⚠️ N2 — a conta e2e descartável fica **ATIVA** quando o teste estoura

`tests/e2e/sessao-e-cache.spec.ts` cria `e2e-revogacao-cache@teste.invalid` com
`prisma.user.create` e limpa num `finally`. Quando o teste estoura por timeout (30s), o `finally`
não completa e a conta **sobra ativa**. Medido na sonda final desta auditoria:

```
'e2e-revogacao-cache@teste.invalid' │ ativo: true │ vinculos: 0
```

A Task 7 já tinha encontrado e apagado essa conta à mão. **Ela voltou** na execução desta auditoria —
ou seja, é reincidente por construção, não resíduo de uma vez.

**Não foi apagada aqui,** e a razão é diferente da que a Task 7 usou. Três fatos medidos:
(a) a senha **não** é literal versionado — vem de `E2E_SENHA` no `.env`, que o `.gitignore` cobre
(`tests/e2e/credenciais.ts`); (b) com `vinculos: 0`, `usuarioAtual()` lança e o painel devolve para
`/login`, então a conta não alcança tela nenhuma; (c) apagar linha é escrita num banco compartilhado
com produção, e esta auditoria não faz escritas por conta própria. O risco é real e é de **higiene**,
não de acesso. Comando para o dono, se quiser limpar:

```sql
delete from "User" where email = 'e2e-revogacao-cache@teste.invalid';
```

### ⚠️ N3 — o conjunto de falhas do e2e **não é estável entre execuções**

A Task 7 reportou duas falhas: `sessao-e-cache.spec.ts:198` e `whatsapp-agente.spec.ts:244`. Esta
auditoria, mesma árvore, mesmo comando:

```
npx playwright test
  2 failed
    [chromium] › tests\e2e\sessao-e-cache.spec.ts:198:5 › desativado no meio da sessão não escreve
                 nem alcança tela nova, mesmo com o cache quente
    [chromium] › tests\e2e\whatsapp-agente.spec.ts:283:5 › erro de sessão inválida chega à tela ao
                 tentar pausar a IA
  2 did not run
  46 passed (1.3m)
```

`:244` passou; `:283` — que a Task 7 viu verde — falhou. Rodando os dois arquivos juntos e isolados
do resto, com 1 e com 3 workers, o resultado é pior nos dois casos (`3 failed`, incluindo
`sessao-e-cache.spec.ts:37`), o que descarta paralelismo como causa única: **os dois specs desativam
contas e mexem em estado compartilhado que o outro observa.**

O que isso significa para quem lê: **"2 falhas conhecidas" não identifica um par fixo de testes.**
Qualquer relatório futuro que cite números de linha precisa citar também a execução que os produziu.

### A causa raiz de `sessao-e-cache.spec.ts:198` está **provada**, não mais suposta

A Task 7 levantou a hipótese; a sonda desta auditoria a fecha. `comContaDescartavel`
(`tests/e2e/sessao-e-cache.spec.ts:177-196`) faz `prisma.user.create` **sem `Membership`**:

```ts
await prisma.user.create({
  data: { nome: "E2E Revogacao Cache", email: EMAIL_REVOGACAO,
          senhaHash: await bcrypt.hash(senhaE2e(), 10), papel: "VENDEDOR", ativo: true },
});
```

Sonda: `vinculos: 0`. `session.ts` lança sem vínculo, o painel devolve para `/login`, o teste espera
para sempre. **É a quarta ocorrência da mesma família de §7.1** — fixture que cria `User` sem
`Membership` num mundo onde, desde o Ciclo 1a, isso não é mais um usuário utilizável. O conserto é o
mesmo `membership.create` de `c06b1fe`. **Não aplicado**: é fixture de outro ciclo, e a regra é
reportar antes.

---

## 9. Erros meus, do controlador

1. **A verificação de exceções de lint do briefing estava errada, e teria sido citada como prova.**
   O Step 1 manda rodar `grep -c '"src/' eslint.config.mjs` e esperar **5**. O número real é **9**:
   além das 5 entradas de `EXCECAO_PERMANENTE`, o padrão pega três globs (`files: ["src/core/**/..."]`,
   `src/modules/**`, `src/app/**`) e uma string de mensagem na linha 18. O comando é um proxy ruim
   para a afirmação que interessa. Substituído por um parser que ignora comentários e conta só
   caminhos de arquivo, com o resultado abaixo — e a asserção verdadeira (**5 permanentes, 0
   temporárias**) confirmada.
   Complicação a mais, registrada porque me custou uma execução: `grep` **sem caminho absoluto**
   devolveu `0` para esse mesmo padrão nesta sessão. É o proxy de linha de comando do ambiente
   mexendo no argumento com aspas, não o arquivo. Todas as contagens deste documento usam
   `/usr/bin/grep` ou Node.

2. **Considerei trocar `npm test` por `npx vitest run tests/unit` para poupar as senhas, e a troca
   não poupa nada.** Os arquivos que rodam o seed (`tests/unit/seed.test.ts`) estão dentro de
   `tests/unit/`. Rodar o subconjunto mudaria o rótulo do comando no relatório, não o efeito no
   banco. Rodei `npm test` inteiro, que é o que o critério de aceite pede, e registro o efeito em vez
   de escondê-lo.

3. **Rodei o Step 4 uma vez a mais do que o briefing pedia**, e foi o que revelou ⚠️ N1. O briefing
   manda rodar os quatro specs e esperar verde. Deu vermelho. Em vez de reportar "falha", medi com
   `--workers=1` e com o arquivo isolado, e aí o defeito virou reprodutível e explicado. Se eu
   tivesse colado o primeiro vermelho e parado, o relatório teria um achado sem causa.

---

## ✅ Verificado e correto

| # | Item | Como foi verificado |
|---|---|---|
| 1 | `npm run typecheck` verde | `tsc --noEmit` → sem saída, `TYPECHECK_EXIT:0` |
| 2 | `npm run lint` sem **erro** | `✖ 6 problems (0 errors, 6 warnings)`. Os 6 são pré-existentes e nomeados: `src/components/leads/lead-table.tsx:117` (`react-hooks/incompatible-library`, TanStack Table), `src/core/contacts/actions.ts:61` (`_ignorado`), `tests/unit/proxy-matcher.test.ts:53` (diretiva `eslint-disable` órfã) e `tests/unit/whatsapp-fila-vercel.test.ts:22` (3× parâmetro não usado). **Nenhum em arquivo criado por este ciclo** |
| 3 | `npm run build` verde | `✓ Compiled successfully in 893ms` · `Finished TypeScript in 4.8s` · exit 0 |
| 4 | A tabela de rotas continua com **1** estática | `○ /_not-found` e mais nada; 21 `ƒ` dinâmicas + `ƒ Proxy (Middleware)`. Bate **linha a linha** com a linha de base da §7 do spec — nenhuma rota saiu de `○`, nenhuma entrou |
| 5 | Suíte unitária inteira verde | `npm test` (`vitest run`, sozinho) → `Test Files 121 passed \| 1 skipped (122)` · `Tests 1353 passed \| 13 skipped (1366)` · `Duration 421.37s` · exit 0. **Esta execução reescreveu a senha do admin** — ver 🔍 NV5 |
| 6 | O 1 arquivo pulado é conhecido e alheio | `tests/unit/seed-demo.test.ts`, `describe.skipIf(!funilEhOSemeado)`: exige 5 etapas com a última `ehGanho`; o banco de dev tem 4. Pré-existente, medido na Task 6, nada deste ciclo toca `PipelineStage` |
| 7 | `tests/unit/catraca-prisma-cru.test.ts` verde | `npx vitest run` isolado → `Test Files 1 passed (1)` · `Tests 18 passed (18)` |
| 8 | `LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS` continua em **0** | `/usr/bin/grep -n` → `108:const LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS = 0;` |
| 9 | **Nenhuma exceção nova de lint**, e a prova é o diff vazio | `git diff --stat 031f515^..0817907 -- eslint.config.mjs tests/unit/catraca-prisma-cru.test.ts` → **saída vazia**. Os dois arquivos que poderiam conceder exceção estão byte a byte iguais aos de antes do ciclo |
| 10 | `EXCECAO_PERMANENTE` tem exatamente **5** caminhos, e as três filas temporárias têm **0** | Parser em Node que remove comentários e conta só strings terminadas em `.ts`/`.tsx` → `EXCECAO_PERMANENTE: 5` (`credenciais.ts`, `session.ts`, `users/empresa.ts`, `rate-limit/limiter.ts`, `tenancy/escopo.ts`); `VIOLADORES_TEMPORARIOS_{CORE,MODULES,APP}: 0 caminho(s)` cada. Corrobora o item 9 por outro caminho |
| 11 | `CompanyConfig` é modelo de tenant de verdade, e a trava de deriva morde | `tests/unit/escopo-empresa.test.ts` (64 casos): o caso de deriva **nomeou o modelo** quando ele estava no schema e fora de `MODELOS_DE_TENANT` (RED colado em `task-1c-1-report.md`), e o caso de `companyId` único passou a exigir `["BotConfig", "CompanyConfig"]` |
| 12 | A migração liga RLS, revoga grants e **não insere nada** | `/usr/bin/grep -nE "ENABLE ROW LEVEL\|REVOKE\|INSERT\|..."` sobre `20260820180000_company_config/migration.sql` → linhas 55 e 56 presentes, **zero ocorrências de `INSERT`** |
| 13 | A tabela nasceu com RLS ligada, zero políticas, zero grants e **zero linhas** | Sonda ao Postgres na Task 1: `rls: { relrowsecurity: true } politicas: 0 grants anon/authenticated: 0 linhas: 0` |
| 14 | `tests/unit/migracoes-seguras.test.ts` verde com a migração nova em disco, **sem entrar em `PERDOADAS`** | Verde dentro de ✅5. O motivo é estrutural: o analisador isenta `ALTER TABLE` cuja tabela aparece em `CREATE TABLE` na mesma migração, e o `NOT NULL` sem `DEFAULT` de `atualizadoEm` vive dentro do `CREATE TABLE` |
| 15 | A leitura é escopada, sem estado global e sem `AsyncLocalStorage` | `src/core/config/leitura.ts:3` importa `prismaDaEmpresa`; `companyId` é o primeiro parâmetro e não há sobrecarga sem ele; caso executável em `config-leitura.test.ts` varre o fonte e reprova `let`/`var`/`new Map`/`new Set`/`new WeakMap`/`globalThis` em escopo de módulo |
| 16 | A empresa A não lê a linha da B, contra **Postgres real** | `tests/unit/config-isolamento.test.ts`, 4 casos, duas empresas — e a sonda do mesmo arquivo afirma que a consulta **sem** escopo leria. Verde dentro de ✅5 |
| 17 | A corretude não depende do cache, **e** a memoização existe | Dois arquivos, porque as duas builds de `react` se excluem: `config-leitura.test.ts` (8 casos, duas chamadas → duas consultas, mesma resposta) e `config-memoizacao.test.ts` (4 casos, build `react-server` carregada por `createRequire`, mesmo `companyId` → uma consulta e a mesma referência). Ver §7.2 |
| 18 | O portão devolve respostas **diferentes** para duas empresas na mesma execução, e não engole erro | `tests/unit/config-modulos.test.ts`, 8 casos, incluindo *"a MESMA rota passa para uma empresa e dá 404 para a outra"* e *"NÃO engole o erro de config inválida"*. Sem o primeiro, um portão que barrasse tudo e outro que não barrasse nada passariam cada um por metade |
| 19 | O segundo `<style>` **não** quebrou o CSP nem o script anti-flash | `npx playwright test banco-blindado tema marca-por-empresa seguranca-headers --workers=1` → **`22 passed (37.8s)`**, exit 0. Inclui o canário de script inline sem nonce e *"nenhuma tela do painel viola o CSP"* |
| 20 | Nenhum texto do config chega ao `<style>` | `tests/unit/painel-layout-marca.test.tsx:156-166`, `innerHTML).not.toContain("<")`. Mais 7 casos no mesmo arquivo, entre eles a metade oposta (*"a empresa SEM sobreposição continua vendo exatamente o padrão do arquivo"*), sem a qual `not.toBe(padrão)` passaria com `<style>` vazio |
| 21 | No navegador, `--primary` do `<html>` reflete a cor da EMPRESA | `tests/e2e/marca-por-empresa.spec.ts`, 5 casos, dentro dos 22 de ✅19. A premissa virou asserção: o teste calcula os dois matizes por `hexParaOklch` e afirma que distam mais de 10 graus, senão passaria com a cor do arquivo (defeito que o briefing original tinha) |
| 22 | `src/lib/module-gate.ts` não existe mais, e a colisão de glob não voltou | `ls src/lib/module-gate.ts` → `No such file or directory`; `ls src/core/config/modulos.ts` → existe; `npm run lint` verde (✅2) com o arquivo novo em disco |
| 23 | Advisor de segurança do Supabase **sem achado novo além do previsto** | `get_advisors(security)` em `uzumzfxjcxrbxaucvfsr` → **16 × `rls_enabled_no_policy` (INFO)** — as 15 do Ciclo 1a mais `public.CompanyConfig` — e **2 × WARN**, os mesmos dois sobre `public.rls_auto_enable()` ser executável por `anon` e por `authenticated`. Bate **exatamente** com a previsão do critério de aceite. RLS ligada sem política é o default-deny desejado, não achado |
| 24 | Nenhuma `Company` órfã de fixture, e nenhuma empresa sem linha de config | Sonda final (abaixo): `Company: 1`, `CompanyConfig: 1`, consulta de órfãs vazia, consulta de "empresas SEM linha de config" vazia. **Fecha o 🔍 NV1 do spec** |

---

## Sonda final ao banco

Executada **depois** de `npm test` e de todas as execuções do Playwright, com a `DIRECT_URL`. O
script foi copiado para a raiz (o Node resolve `dotenv` pela pasta do arquivo), executado e apagado;
`git status --short` em seguida não devolveu nada.

```
Company: 1 | CompanyConfig: 1 | User: 7 | Membership: 6

-- Company (todas) --
│ 'company-migracao-1a' │ 'n8necrm' │ 2026-08-20T03:58:24.460Z │

-- orfas de fixture (nome like 'teste-%' / 'ZZTeste%' / '%e2e%') --
(nenhuma linha)

-- CompanyConfig --
│ companyId             │ corPrimaria │ fonte │ logoClaro │ logoEscuro │ modulos                      │
│ 'company-migracao-1a' │ null        │ null  │ null      │ null       │ [ 'whatsapp', 'automation' ] │

-- marca 100% nula? --
│ linhas: 1 │ marca_toda_nula: 1 │

-- empresas SEM linha de config --
(nenhuma linha)

-- User + vinculos --
│ 'admin@exemplo.com'                 │ ativo: true  │ 1 │
│ 'e2e-admin@teste.invalid'           │ ativo: true  │ 1 │
│ 'e2e-revogacao-cache@teste.invalid' │ ativo: true  │ 0 │   ← ⚠️ N2
│ 'e2e-vendedor@teste.invalid'        │ ativo: true  │ 1 │
│ 'gestor-teste-task6@exemplo.com'    │ ativo: false │ 1 │
│ 'vendedor@exemplo.com'              │ ativo: true  │ 1 │
│ 'whatsapp-bot@sistema.invalid'      │ ativo: false │ 1 │
```

Leitura, item a item:

- **NV1 fechado, com número diferente do do Ciclo 1a.** Aquela auditoria mediu **7** `Company` (1
  legítima + 6 órfãs de fixture). Hoje é **1**. As 6 órfãs sumiram com as limpezas dos ciclos
  seguintes; nenhuma nova apareceu apesar de `npm test` e de quatro execuções de Playwright nesta
  sessão. **Zero empresas ficariam sem linha de config** — o seed cobre a única que existe.
- **A marca é nula em 100% das linhas** (§7.5).
- **`gestor-teste-task6@exemplo.com`** é resíduo declarado da Task 6, inativo, com vínculo. Deixado
  onde está: apagar dado de outra tarefa sem pedir é o oposto do que a regra de resíduo quer.
- **`e2e-revogacao-cache@teste.invalid`** é ⚠️ N2.

---

## ⚠️ Riscos e dívidas

### Medidos nesta auditoria (novos)

- **N1** — `seguranca-headers.spec.ts` falha determinística com `workers > 1` (§8). Invisível na
  suíte inteira, reprodutível em execução focada.
- **N2** — a conta e2e descartável fica ativa quando o teste estoura (§8). Reincidente.
- **N3** — o conjunto de falhas do e2e não é estável entre execuções (§8).

### Declaradas pelo próprio spec do Ciclo 1c (§11), todas de pé

- **D1 — não existe função de escrita validada, e é escolha.** A validação mora só na LEITURA. Um
  `definirConfigDaEmpresa` foi **recusado por não ter chamador**: o seed grava valores que vêm de
  `client.modulos` (já validado na importação) e os outros dois processos que escreveriam rodam como
  Node comum, fora da condição `react-server`, onde `import "server-only"` lança. Nasce junto com a
  tela de 4.6.
- **D2 — depois que a linha existe, o arquivo deixa de ter efeito para aquela empresa, em silêncio.**
  Mitigado por o seed criar a linha só com `modulos`. Não há aviso mecânico; o comentário novo em
  `config/client.ts` é a única defesa, e comentário não é trava.
- **D3 — `modulos` fica editável por SQL e por mais nada.** Sem tela e sem Server Action.
- **D4 — linha inválida derruba o painel daquela empresa.** Escolha explícita de 4.4: falhar alto em
  vez de pintar cinza. O único caminho até lá é `UPDATE` à mão, porque não há escrita pelo produto.
- **D5 — a marca de `/login` continua sendo a do arquivo, para todo mundo.** Consequência do
  ovo-e-galinha: sem sessão não há empresa.
- **D6 — as herdadas do Ciclo 1a** (abaixo).

### Herdadas do Ciclo 1a, nenhuma tocada aqui — e uma **piorou**

- **R1 — o banco de teste não é separado do de desenvolvimento.** Bloqueio duro antes de qualquer
  deploy público, registrado desde o Ciclo 0. Esta auditoria o exercitou três vezes: `npm test`
  reescrevendo senha, N1 e N2. Cada ciclo que passa aumenta o custo.
- **R2 — quatro unicidades globais bloqueiam a segunda empresa.** `Contact.telefone`,
  `Conversation.waId`, `PipelineStage.ordem`, `WhatsappMessage.idExterno`. **É a de `Contact.telefone`
  que produz N1.**
- **R3 — os quatro pontos cegos declarados do escopo.** ⚠️ **Ficou maior:** `User` passou de oito
  para nove relações inversas (§4).
- **R4 — `User.papel` sobrevive como espelho, com dual-write.** `a8dd76a` marcou a coluna como
  espelho depreciado; ela continua lá.
- **R5 — `EVOLUTION_COMPANY_ID` é ponte, e é segunda fonte de verdade sobre a conversa.**
- **R6 — nove chamadas ainda resolvem a empresa por um vínculo arbitrário** (`companyIdDoUsuario`).

> **Não vale mais desde 2026-08-21:** a coluna saiu no Ciclo 1f.

---

## ❌ Herdado, não corrigido aqui

Os achados de **infraestrutura** que esta base já registrou continuam abertos. Nenhum introduzido
aqui, nenhum corrigido aqui. Ficam citados porque um relatório de "0 críticas em aberto" não fica de
pé sem eles — quem lesse só este documento sairia acreditando que a infraestrutura não tem problema
crítico nenhum.

1. **`N8N_ENCRYPTION_KEY=nateksoft`** — criptografa todas as credenciais salvas no n8n, e é
   adivinhável a partir do nome da empresa.
2. **A chave global da Evolution é `nateksoft`** — cria, apaga e lê qualquer instância.
3. **Senha reusada** — `DB_POSTGRESDB_PASSWORD` do n8n é a mesma senha do projeto Supabase do CRM.
   É o **mesmo Postgres** onde `CompanyConfig` acabou de nascer e onde a blindagem de ✅13 é medida.
4. **O JWT da API do n8n não expira** (sem claim `exp`).
5. Do Ciclo 4: as ações destrutivas de fluxo (`ativar`/`desativar`/`apagar`) **não têm teto de taxa**.

Detalhe e origem em `docs/auditorias/2026-08-19-ciclo-4-fluxos.md` e
`docs/auditorias/2026-08-19-ciclo-1a-tenancy.md`.

---

## 🔍 Não verificados

O **NV1** do spec fechou (✅24). Os outros quatro continuam abertos, e o item novo entra como NV6.

| # | Item | Por que não deu | O que fecha |
|---|---|---|---|
| NV2 | Se uma `CHECK` escrita à mão numa migração faz `prisma migrate dev` acusar deriva e propor reset | Não medido; medir exige shadow database. É por isso que a trava de banco para o par de logos **não entrou**, e a cobrança do par ficou na leitura (`mesclarConfig`) | `npx prisma migrate dev --create-only` num branch descartável, depois de acrescentar a `CHECK`, e ler se ele avisa de deriva |
| NV3 | Se `generateMetadata` num layout `force-dynamic` compartilha a memoização de `cache()` com o render da mesma requisição | A doc do Next afirma que metadata e render acontecem na mesma requisição; a contagem de consultas não foi medida. O que ESTÁ medido é que a chave do cache é a lista de argumentos (§7.2) e que o Next instala o dispatcher — não que o instale **uma vez** por requisição | Instrumentar `configDaEmpresa` com um contador, carregar `/leads` uma vez e comparar com 1. Se der 2, o custo é uma consulta a mais por navegação — não incorreção |
| NV4 | Se algum navegador fora do Chromium ordena diferente dois blocos `:root:root` de mesma especificidade | `playwright.config.ts` tem um projeto só, `chromium`. A regra da cascata (mesma especificidade, vence o último) é do CSS, não do navegador — mas a medição é de **um** motor | `npx playwright test tests/e2e/marca-por-empresa.spec.ts --project=firefox` (e `webkit`), se o projeto passar a suportá-los |
| NV5 | Estado da senha do admin no banco de desenvolvimento | `npm test` rodou aqui (✅5) e reescreveu o `senhaHash` de `admin@exemplo.com` e `vendedor@exemplo.com` com literais versionados. Esta auditoria **não rotaciona senha** — não tem, nem deve ter, o valor novo, e nada deste documento pode conter senha | `SEED_PASSWORD=<valor forte gerado> npx prisma db seed`, e depois `bcrypt.compare` provando que os literais antigos não autenticam mais |
| NV6 | Se acrescentar o `Membership` à conta descartável de `sessao-e-cache.spec.ts` faz o teste passar | A causa está **provada** (conta com `vinculos: 0` na sonda + `create` sem `membership` no fonte + `session.ts` lançando sem vínculo). O que não foi medido é o efeito do conserto, porque o `AGENTS.md` manda reportar antes de corrigir | Acrescentar `prisma.membership.create` a `comContaDescartavel` (mesmo formato de `c06b1fe`) e rodar `npx playwright test tests/e2e/sessao-e-cache.spec.ts --workers=1` |

---

## Só um humano pode fazer

1. **Rotacionar as senhas de `admin@exemplo.com` e `vendedor@exemplo.com` agora.** `npm test` rodou
   nesta auditoria (✅5) e gravou literais públicos deste repositório no `senhaHash` das duas contas.
   É o 🔍 NV5, e é a única pendência **operacional imediata** deste documento.
2. **Aprovar ou recusar este relatório antes de qualquer merge ou PR.** O `AGENTS.md` exige a Fase 1
   da `auditoria-seguranca` sobre a superfície que a branch mexeu, entregue e **parada** até o dono
   aprovar. Correção começa depois disso, não antes — e é por isso que ⚠️ N1, N2, N3 e 🔍 NV6 estão
   descritos com o conserto sugerido e **não aplicados**.
3. **Decidir os três achados de fixture e2e** (N1, N2, N3). São baratos de consertar e caros de
   diagnosticar de novo daqui a três meses.
4. **Decidir R1** — banco de teste separado do de desenvolvimento. É a causa raiz de N1, N2 e da
   rotação de senha do item 1. Está registrado como bloqueio duro desde o Ciclo 0.
5. **Decidir a identidade do produto** (decisão nº 8 do programa). O ciclo entregou o caminho e
   deixou a decisão intacta, como combinado; enquanto ela não vier, a marca por empresa fica ligada,
   provada e sem uso.
