# Auditoria de segurança — Ciclo 0 (fundação) do n8necrm

Data: 2026-08-19 · Escopo: branch `ciclo-0-fundacao` completa, `1fea1fc..HEAD`
(reidentificação do fork, refatoração da fila do WhatsApp, correção de
`npx prisma db seed`, documentação de env) · Ambiente: leitura de código e
histórico local + consulta somente-leitura ao Postgres real do Supabase
(projeto `uzumzfxjcxrbxaucvfsr`) via MCP. Nenhuma escrita no banco, nenhum
seed/migration executado nesta auditoria.

## Resumo

**❌ Críticas: 0 · ⚠️ Riscos: 0 · ✅ Verificados: 9 · 🔍 Não verificados: 2**

Este ciclo não abre rota, endpoint nem Server Action nova, e não muda schema
nem migration — a superfície é reidentificação de produto (nomes, cores,
funil) e uma refatoração mecânica de módulo (`fila.ts` → `fila/{tipos,vercel,
index}.ts`, mesma API pública). Nada aqui amplia o que alguém consegue ler ou
escrever no banco além do que os ciclos anteriores já auditaram
(`docs/auditorias/2026-08-15-*.md`).

O que este ciclo teve foi um **incidente operacional**: o seed criou uma
conta ADMIN com senha pública, porque o mecanismo que evita isso
(`SEED_PASSWORD`) não estava documentado em `.env.example`. Seção dedicada
abaixo — causa raiz, remediação e como a rotação foi verificada, sem expor a
senha em nenhum momento.

---

## Superfície tocada por este branch

`git diff --stat 1fea1fc..HEAD` (excluindo documentação e planos):

```
.env.example                          |  alterado (comentários + SEED_PASSWORD)
CLAUDE.md                             |  alterado (identidade do fork)
README.md                             |  alterado (setup + comandos)
config/client.ts                      |  alterado (identidade: nome, cor, funil, entidade)
package.json                          |  alterado (name: crm-geral -> n8necrm)
prisma.config.ts                      |  alterado (fix: seed via --conditions=react-server)
prisma/seed.ts                        |  alterado (SEED_PASSWORD)
src/modules/whatsapp/fila.ts          |  removido
src/modules/whatsapp/fila/index.ts    |  novo
src/modules/whatsapp/fila/tipos.ts    |  novo
src/modules/whatsapp/fila/vercel.ts   |  novo
tests/unit/whatsapp-fila-vercel.test.ts | novo
```

### 1. Identidade (`config/client.ts`, `package.json`, `CLAUDE.md`)

Constantes lidas em tempo de build, validadas por `clientConfigSchema.parse`
em escopo de módulo (`config/client.ts:12`) — sem `process.env` envolvido,
então não há como faltar em produção nem vazar segredo por essa via. O funil
mudou de 5 para 4 etapas (`["Novo", "Em contato", "Proposta", "Fechado"]`),
confirmado no banco real:

```sql
SELECT count(*) AS total_etapas, count(*) FILTER (WHERE "ehGanho") AS etapas_ganho
FROM "PipelineStage";
-- total_etapas: 4, etapas_ganho: 1
```

Consequência dessa mudança, não um risco de segurança: `prisma/seed-demo.ts`
assume 5 etapas e `tests/unit/seed-demo.test.ts` pula com motivo impresso —
ver achado I2 na revisão que gerou este documento.

### 2. Fila do WhatsApp (`src/modules/whatsapp/fila/`)

Refatoração mecânica de `fila.ts` (arquivo único) para três arquivos
(`tipos.ts` sem efeito colateral, `vercel.ts` adaptador, `index.ts` fábrica
com `import "server-only"`), espelhando o padrão já existente em
`gateway/{tipos,evolution,index}.ts`. A costura de segurança relevante —
`WHATSAPP_QUEUE_SECRET` embutido no payload do job e conferido pelo
consumidor antes de processar (defesa em profundidade além do "air-gapping"
da rota de fila, documentado em `.env.example`) — não mudou: `getSegredoFila`
continua lida a cada publicação, nunca em escopo de módulo, e o schema Zod
(`segredoEnvSchema`, `fila/vercel.ts`) continua recusando string vazia.

`git diff b27c959..3faa3b3` (a volta de correção da Task 3 deste ciclo) só
altera comentário — restaura evidência que tinha sido diluída no meio da
divisão de arquivo (citação da doc da Vercel, `dist/index.js`, rótulo do
código de retry). Nenhuma linha de lógica mudou entre o arquivo original e a
versão dividida.

### 3. Invocação do seed (`prisma.config.ts`, `prisma/seed.ts`)

`npx prisma db seed` estava quebrado incondicionalmente antes deste ciclo
(`src/lib/prisma.ts` importa `"server-only"`, que lança fora da condição de
build do Next.js) — corrigido com `tsx --conditions=react-server` em
`prisma.config.ts`. Efeito colateral relevante para segurança: com o seed
quebrado, `SEED_PASSWORD` nunca tinha chance de ser lida — o que tornou mais
fácil a conta ADMIN nascer só com o literal público. Ver o incidente abaixo.

### 4. Documentação de env (`.env.example`, `README.md`)

`SEED_PASSWORD` foi documentada nesta branch (commit `6d642e5`) e depois
corrigida nesta revisão (achado C1: a linha publicada, `SEED_PASSWORD=""`,
era uma variável definida com string vazia — não ausente — e reabria o
incidente de um jeito novo). `EVOLUTION_APIKEY`, `WHATSAPP_QUEUE_SECRET`,
`WHATSAPP_WEBHOOK_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY` e demais segredos não
foram tocados por este ciclo.

---

## O incidente: conta ADMIN com senha pública

### O que aconteceu

`prisma/seed.ts` cria duas contas na primeira execução — `admin@exemplo.com`
(papel ADMIN) e `vendedor@exemplo.com` (papel VENDEDOR) — com a senha vinda
de `process.env.SEED_PASSWORD`, caindo no literal `"senha123"` (público
neste repositório) quando a variável não está definida. Ao montar o `.env`
deste ciclo (Task 4) a partir de `.env.example`, `SEED_PASSWORD` não estava
documentada ali — então não foi definida, e `npx prisma db seed`, rodado
contra o Postgres real (o mesmo banco único que dev e produção compartilham,
com deploy público), criou a conta ADMIN com a senha pública.

### Causa raiz

O mecanismo que evita isso (`SEED_PASSWORD`, com upsert condicional em
`prisma/seed.ts`) já existia no código antes deste ciclo, mas nunca tinha
sido documentado em `.env.example`. Ninguém montando um `.env` a partir do
exemplo tinha como saber que precisava defini-la. O próprio `.env.example`,
antes desta remediação, já descrevia um incidente quase idêntico no
comentário de `E2E_SENHA` (contas de teste E2E com senha pública, remediado
em 2026-08-07) sem documentar a variável equivalente para a conta ADMIN real
— o padrão se repetiu porque só metade da lição tinha sido registrada.

### Quando foi descoberto

Revisão de segurança feita depois do portão de verificação (Task 5) deste
ciclo, antes do fechamento — não fazia parte de nenhum critério de aceite
formal, foi um achado da revisão.

### Remediação

1. `SEED_PASSWORD` foi definida com um valor aleatório forte
   (`openssl rand -base64 24`) e `npx prisma db seed` foi reexecutado. O
   mecanismo de `atualizarSenhaNaReexecucao` em `prisma/seed.ts` regrava
   `senhaHash` das duas contas (`admin@exemplo.com` e `vendedor@exemplo.com`)
   quando a variável está explicitamente definida — é exatamente para isto
   que ele existe: rotacionar a senha sem editar código.
2. `SEED_PASSWORD` foi documentada em `.env.example` (commit `6d642e5`) para
   o erro não se repetir num próximo fork.

### Como a rotação foi verificada

`bcrypt.compare(senha_nova, senhaHash)` lido do banco retornou **`true`**, e
`bcrypt.compare("senha123", senhaHash)` retornou **`false`**, para as duas
contas (`admin@exemplo.com` e `vendedor@exemplo.com`). A senha em si nunca
foi impressa nem versionada em nenhum documento, commit ou relatório.

### Defeito que a própria remediação introduziu — e a correção

A linha publicada em `.env.example` foi `SEED_PASSWORD=""` — uma variável
**definida** com string vazia, não ausente. `prisma/seed.ts` usava `??`, que
só cai no fallback para `null`/`undefined`, nunca para string vazia. Duas
consequências: (a) o setup documentado no README (`cp .env.example .env` +
`npx prisma db seed`) produzia um ADMIN com `bcrypt("")`, login impossível;
(b) `atualizarSenhaNaReexecucao` ficava `true` com a variável "definida"
vazia, então rodar `npx prisma db seed` de novo — comando de rotina segundo o
README — **regravava a senha rotacionada por um hash de string vazia**,
reabrindo o mesmo incidente de outro jeito.

Corrigido nesta revisão (achado C1, commit `56f5f2f`):
`prisma/seed.ts` passa a tratar string vazia como ausente
(`process.env.SEED_PASSWORD || undefined`), e `.env.example` volta a publicar
a linha **comentada** (`# SEED_PASSWORD=`), com instrução para descomentar e
preencher antes de rodar o seed. Verificado com um `.env` de teste isolado
fora do projeto (nunca o real): linha comentada e `SEED_PASSWORD=""`
produzem, ambos, `senhaPlanoExplicita === undefined` e
`atualizarSenhaNaReexecucao === false`; só um valor não vazio produz `true`.

---

## ✅ Verificado e correto

| # | Item | Como foi verificado |
|---|---|---|
| 1 | Funil real tem 4 etapas, 1 marcada como ganho | `SELECT count(*), count(*) FILTER (WHERE "ehGanho")` no Postgres real via MCP → `4, 1` |
| 2 | `WHATSAPP_QUEUE_SECRET` continua lido fora do escopo de módulo | `src/modules/whatsapp/fila/vercel.ts` — `getSegredoFila()` chamada dentro de `publicar()`, não no topo do arquivo |
| 3 | Schema do segredo da fila recusa string vazia | `segredoEnvSchema` (`fila/vercel.ts`) — `z.string().min(1)` |
| 4 | Nenhum segredo novo introduzido pelo branch | `git diff 1fea1fc..HEAD` (fora `docs/` e `.superpowers/`) contra padrões de chave/senha/token literal → nada além das referências a `process.env.*` já esperadas |
| 5 | Nenhuma rota, endpoint ou Server Action nova neste ciclo | `git diff --stat 1fea1fc..HEAD` — só `config/`, `prisma/`, `src/modules/whatsapp/fila/`; nada em `src/app/` |
| 6 | Refatoração da fila preserva a lógica original | `git diff b27c959..3faa3b3` só altera comentário (evidência restaurada); nenhuma linha de código |
| 7 | Rotação da senha do ADMIN e do VENDEDOR provada | `bcrypt.compare` da senha nova → `true`; da `senha123` → `false`; para as duas contas (ver seção do incidente) |
| 8 | `SEED_PASSWORD=""` não sobrevive a uma reexecução do seed, depois da correção | Cenário reproduzido isoladamente (`.env` de teste fora do projeto): `senhaPlanoExplicita === undefined`, `atualizarSenhaNaReexecucao === false` |
| 9 | `client.entidade.campos` não tem consumidor real | `grep -rn "\.campos" src/ tests/ config/` → só `tests/unit/client-config.test.ts:129` (teste do próprio schema) e o comentário de `config/client.ts`; `prisma/schema.prisma:75-78` documenta colunas fixas como a decisão vigente |

---

## 🔍 Não verificados

| # | Item | Por que não deu | O que destravaria |
|---|---|---|---|
| NV1 | Se algum outro fork/ambiente ainda tem `SEED_PASSWORD=""` publicada num `.env` já montado | Esta auditoria não tem acesso a ambientes fora deste checkout | Rodar `grep -n "^SEED_PASSWORD=\"\"$" .env` (nunca imprimir o `.env` inteiro) em cada ambiente que já rodou `cp .env.example .env` antes desta correção |
| NV2 | Se a conta ADMIN teve atividade entre a criação com `"senha123"` e a rotação | `AuditLog`/logs de acesso não foram consultados nesta auditoria (fora do escopo pedido) | `SELECT * FROM "AuditLog" WHERE "userId" = <id do admin> ORDER BY "criadoEm"` no período entre a Task 4 e a rotação |

---

## Só um humano pode fazer

1. **Rodar NV1** contra qualquer ambiente (dev de outra máquina, staging) que
   já tenha montado `.env` a partir da versão anterior de `.env.example` —
   esta auditoria só cobre o repositório, não ambientes externos.
2. **Decidir se NV2 vale a pena** — a janela de exposição foi curta (dentro
   do mesmo ciclo de trabalho), mas só um humano com acesso ao `AuditLog` de
   produção pode fechar essa dúvida com certeza.
