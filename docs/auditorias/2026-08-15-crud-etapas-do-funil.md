# Auditoria de segurança — CRM Autus

**Data:** 2026-08-15
**Escopo:** superfície da branch `feat/crud-etapas-do-funil` (20 commits, `f3077de..1ebce76`)
**Ambiente:** dev local em `localhost:3000` + banco Supabase **real** (banco único, dev e produção)

## Resumo

**❌ Críticas: 0 · ⚠️ Riscos: 6 · ✅ Verificados: 17 · 🔍 Não verificados: 4**

A defesa que esta branch precisava acertar — cinco endpoints HTTP novos que reescrevem
`stageId` de leads em massa — está no lugar, provado ao vivo: um VENDEDOR autenticado
chamando a Server Action direto, sem passar pela tela, recebe recusa do servidor.

O achado que pede decisão é o **R1**: as guardas que impedem o funil de ficar vazio ou sem
etapa de fechamento são lidas fora da transação que escreve.

---

## ⚠️ Riscos

### R1 — As guardas de invariante são lidas fora da transação que escreve

**Onde:** `src/core/pipeline/service.ts:265-273` e `:214-219`

**Impacto:** dois `excluirEtapaAction` disparados em paralelo (ADMIN, dois POSTs) passam
ambos pela checagem `count() <= 1` e deixam o funil com **zero etapas** — a criação de lead
para de funcionar e o quadro fica vazio. A mesma corrida entre `definirEtapaDeFechamento(X)`
e `excluirEtapa(X)` deixa o funil **sem nenhuma etapa `ehGanho`**, e a taxa de conversão do
painel passa a mentir em silêncio.

**Evidência (leitura de código; a corrida não foi executada — ver NV4):**

```
service.ts:265   if (etapa.ehGanho) { throw ... }                              ← lido fora
service.ts:271   if ((await prisma.pipelineStage.count()) <= 1) { throw ... }   ← lido fora
service.ts:295   const leadsMovidos = await prisma.$transaction(async (tx) => {  ← escreve aqui
```

Prisma usa o isolamento padrão do Postgres (`READ COMMITTED`); duas transações apagando
linhas diferentes não conflitam, então nada aborta.

**Correção proposta:** ver a nota de correção abaixo — a proposta original desta linha
("mover as checagens para dentro do `$transaction`") estava **errada por insuficiência**.

> **Correção da proposta (2026-08-15, antes da Fase 2).** Mover as checagens para dentro do
> `$transaction` **não resolve sozinho**. Sob `READ COMMITTED`, um `count()` dentro da
> transação continua enxergando só o que já foi comitado: as duas transações leriam `2`, as
> duas passariam, e o funil terminaria vazio do mesmo jeito. Contagem não trava linha
> nenhuma. O conserto precisa de uma leitura **travante** —
> `SELECT ... FOR UPDATE` sobre as linhas de `PipelineStage` — e das guardas avaliadas em
> cima dessa leitura. Sob `READ COMMITTED`, uma leitura travante reavalia a linha depois de
> o lock ser liberado, então a segunda transação enxerga o funil já reduzido e recusa.

**Risco de corrigir:** nenhum para uso de uma pessoa só. Sob concorrência, a segunda chamada
passa a esperar a primeira comitar (milissegundos, numa tabela de 5 linhas).

---

### R2 — Tabela futura criada por `supabase_admin` nasceria aberta a `anon`

**Onde:** `pg_default_acl`, schema `public` (banco, não código) — **pré-existente, fora da
superfície desta branch**

**Impacto:** uma tabela criada pelo papel `supabase_admin` nasce com `arwdDxtm` para `anon`
e `authenticated` — legível por qualquer um com a chave pública. As migrações do projeto
rodam como `postgres`, que está limpo, então isso não afeta nada que exista hoje.

**Evidência:**

```
$ SELECT defaclrole::regrole, defaclnamespace::regnamespace, defaclobjtype, defaclacl FROM pg_default_acl
supabase_admin | public | r | {postgres=arwdDxtm/…,anon=arwdDxtm/…,authenticated=arwdDxtm/…}
postgres       | public | r | {postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}   ← limpo

$ SELECT current_user   →  postgres
```

O teste de regressão que existe (`tests/e2e/banco-blindado.spec.ts:76`) filtra
`defaclrole = 'postgres'` — cobre o papel que este projeto usa, e por isso passa verde com a
linha do `supabase_admin` presente.

**Correção proposta:** decisão do dono. Ou
`ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated`,
ou registrar como aceito e alargar o teste para falhar se alguma tabela nascer exposta,
independente de quem a criou.

---

### R3 — O rastro forense do funil não registra de onde a ação veio

**Onde:** `AuditLog.ip` — `src/core/audit/log.ts:66`; o campo existe, nenhum chamador o preenche

**Impacto:** se alguém apagar etapas do funil, o log diz **quem** e **o quê**, nunca **de
onde**. Numa investigação de conta comprometida, é a diferença entre "foi o Rodrigo" e
"foi alguém usando a sessão do Rodrigo".

**Evidência:**

```
$ SELECT (ip IS NULL) AS ip_nulo, count(*) FROM "AuditLog" GROUP BY 1
true | 223       ← 100% das linhas
```

Pré-existente e sistêmico. Registrado aqui porque a branch soma quatro ações novas ao mesmo
log cego, e uma delas é destrutiva.

---

### R4 — A suíte e2e escreve ação sensível no `AuditLog` de produção, a duas de disparar alerta falso

**Onde:** `tests/e2e/etapas.spec.ts` · `LIMITE_ALERTA = 10` em `src/core/audit/alerta.ts:77`

**Impacto:** cada `npm run test:e2e` grava 2 linhas `excluir_etapa` — ação que está em
`ACOES_SENSIVEIS`. Rodar a suíte 5 vezes em 5 minutos (normal ao depurar um teste) manda
notificação de "atividade destrutiva" para o sino de todo ADMIN ativo. O próprio docstring
do detector diz que o falso positivo "treina o ADMIN a ignorar o sino, que é o pior
resultado possível para um detector".

**Evidência:**

```
$ maior rajada de ações sensíveis em janela de 5 min, por autor
cmsjhvl970000dcldpqt0g68g | 8      ← o admin de e2e; o limite é 10

$ SELECT acao, count(*) FROM "AuditLog" WHERE entidade='PipelineStage' GROUP BY 1
criar_etapa 26 | editar_etapa 11 | excluir_etapa 22 | reordenar_etapa 24

$ SELECT tipo, count(*) FROM "Notification" GROUP BY 1
CONVERSA_AGUARDANDO 6 | NOVO_LEAD 94      ← nenhum alerta de atividade disparou até hoje
```

Consequência direta da decisão de banco único.

**Correção proposta:** excluir o `userId` da conta de e2e do detector, no molde de
`idsDeSistema()` (`alerta.ts:113`). **É um trade-off de segurança e a decisão é do dono:**
a conta de e2e é um ADMIN real no banco real, e excluí-la significa que uma rajada
destrutiva vinda dela deixa de ser vista.

---

### R5 — `criar_etapa` não tem teto e não entra no detector de rajada

**Onde:** `src/core/audit/alerta.ts:56-64` · `src/core/pipeline/actions.ts:83`

**Impacto:** um ADMIN (ou alguém com a sessão dele) pode criar milhares de etapas em
sequência. O quadro do funil e o grid do painel ficam inutilizáveis, e **nenhum alerta
dispara** — só `excluir_etapa` é sensível. A destruição por adição não é vista pelo detector
que existe para ver destruição.

**Evidência:** `ACOES_SENSIVEIS` contém `excluir_etapa` e não `criar_etapa`; nenhuma das
cinco actions consulta `checarRateLimit`.

**Correção proposta:** decisão do dono. O conserto barato é um teto de etapas em
`criarEtapa` (o kanban já não é usável acima de ~15 colunas), não um rate limit.

---

### R6 — A fronteira servidor→cliente de `/etapas` não tem trava automatizada

**Onde:** `src/app/(painel)/etapas/page.tsx:37` · `tests/e2e/fronteira-rsc.spec.ts` não cobre
esta rota

**Impacto:** hoje o payload está limpo (provado — ver ✅9). Mas trocar o `.map()` por
`etapas` cru não quebraria teste nenhum, e é exatamente o defeito que esta base já teve uma
vez, no quadro do funil. Não é um defeito: é a ausência da trava que impede a regressão.

---

## ✅ Verificado e correto

| # | Item | Como foi verificado |
|---|---|---|
| 1 | **VENDEDOR autenticado chamando a Server Action direto é recusado** | POST real da action capturado com sessão ADMIN, **abortado** antes de escrever, e replicado com o cookie do VENDEDOR → `{"ok":false,"erro":"Você não tem permissão para gerenciar o funil."}` |
| 2 | VENDEDOR abrindo `/etapas` | Playwright com `storageState` de vendedor → URL final `http://localhost:3000/` |
| 3 | Sem sessão, GET e POST `/etapas` | `curl` → `307 → /login` nos dois métodos, inclusive com `origin: https://evil.example` |
| 4 | Matcher do proxy cobre a rota nova | Regex compilada e executada: `/etapas` e `/etapas/qualquer` → PROTEGIDO; `/etapas.txt` → 404 (não existe rota) |
| 5 | Headers na resposta de `/etapas` | `curl -sI` → `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `HSTS`, CSP com nonce; sem `X-Powered-By` |
| 6 | `autorId` nunca vem do cliente | As cinco actions derivam de `usuarioAtual()`; nenhuma aceita id de autor por parâmetro |
| 7 | Nenhum export extra no arquivo `"use server"` | Só as 5 actions são exportadas — `exigirGestorDoFunil`, `paraResultadoErro` e `MENSAGEM_SEM_PERMISSAO` são privados |
| 8 | Regex de cor ancorada nos dois lados | 8 payloads executados: `#0F62FE`, `#0f62fe\n`, `#0f62fe;background:url(x)`, `#0f62fee`, `javascript:`, ` ` → todos rejeitados; só `#0f62fe` passa |
| 9 | Payload de `/etapas` sem PII nem segredo | 15 termos buscados no HTML servido (`senhaHash`, `@teste.invalid`, `valorEstimado`, `utm`, `telefone`, `documento`, `DATABASE_URL`, `supabase`…) → todos ausentes; até `ehPerdido` ficou de fora, provando que o DTO estreita |
| 10 | `AuditLog` do funil não guarda PII | `jsonb_object_keys` sobre as 83 linhas reais → `antes`: `{nome, cor, ordem}`; `depois`: `{nome, cor, ordem, destinoId, leadsMovidos}` |
| 11 | RLS ligada nas 13 tabelas | `pg_class.relrowsecurity` → todas `true` |
| 12 | `anon`/`authenticated` sem grants | `role_table_grants` → 0 linhas |
| 13 | Privilégio padrão do papel que migra | `pg_default_acl` para `postgres` → só `postgres` e `service_role` |
| 14 | Nenhum segredo novo na branch | `git diff f3077de..HEAD` contra padrões de chave, `NEXT_PUBLIC`, `process.env` → nada; `git log -S AUTH_SECRET -S service_role` → vazio |
| 15 | Dependências | `npm audit --audit-level=high` → 0 vulnerabilidades |
| 16 | FK e integridade do funil | `Lead_stageId_fkey … ON DELETE RESTRICT` confirmada; 0 leads órfãos; 0 resíduo `ZZ%` ou `ordem < 0` em `PipelineStage` |
| 17 | Sem HTML cru novo | `git grep dangerouslySetInnerHTML -- src/` → só o `<style>` do tema em `app/layout.tsx`, pré-existente |

**Um susto que não era:** as cinco etapas de produção estão gravadas em maiúsculas
(`#94A3B8`), e o schema novo exige minúsculas. Testado se o `<input type="color">` zeraria o
valor para preto ao abrir "Editar" — o Chromium normaliza para `#94a3b8` e o campo abre com
a cor certa. Não há perda de cor. Fica só a inconsistência cosmética: editar qualquer etapa
semeada grava a mesma cor em minúsculas.

---

## 🔍 Não verificados

| # | Item | Por que não deu | Comando que falta | O que cada resposta significa |
|---|---|---|---|---|
| NV1 | CSP em **produção** | O CSP capturado tem `'unsafe-eval'` porque é o servidor de desenvolvimento | `curl -sI https://<dominio-vercel>/etapas \| grep -i content-security` | Com `'unsafe-eval'` → o build saiu em modo dev, falha. Sem ele → correto |
| NV2 | HTTPS forçado e HSTS no domínio real | Sem a URL do deploy | `curl -sI http://<dominio>/ \| grep -i location` | Não redirecionar para `https://` → risco de downgrade |
| NV3 | Revogação de sessão nas ações novas | Exigiria `UPDATE "User" SET ativo=false` no banco de produção | Desativar um usuário de teste, repetir o POST da action com o cookie dele | Se responder `{ok:true}` → falha crítica. Esperado: a mensagem de sessão expirada |
| NV4 | A corrida do R1 | Exigiria criar e apagar etapas concorrentemente no banco de produção | Contra um banco descartável: `Promise.all([excluirEtapa(A), excluirEtapa(B)])` com só duas etapas | Funil terminar com 0 etapas → R1 confirmado |

---

## Só um humano pode fazer

1. **Decidir sobre R2** — `ALTER DEFAULT PRIVILEGES` do papel `supabase_admin` é comando de
   banco; a Fase 1 não escreve em produção.
2. **Rodar NV1 e NV2** contra o deploy da Vercel — a URL do ambiente real não está acessível
   daqui.
3. **Decidir R4** — excluir a conta de e2e do detector de rajada é trade-off de segurança.
4. **Decidir R5** — quantas etapas o funil pode ter é decisão de produto.

---

## Ordem sugerida de correção

1. **R1** — o único achado com estrago permanente.
2. **R6** — travar a fronteira RSC de `/etapas`, hoje correta só por disciplina.
3. **R4** — depende da decisão do dono.
4. **R3 e R5** — escopo maior que a branch; viram itens próprios.
5. **R2** — decisão do dono, no banco.
