# Auditoria de segurança — Fase 1 (diagnóstico)

Branch `ciclo-1a-tenancy`, HEAD `084247f`, 133 commits, nada integrado.
Executada em 2026-08-21, conforme a regra do `AGENTS.md`: nenhuma branch é
integrada sem esta varredura, e **correção só começa depois da aprovação do dono
do projeto**. Nada foi corrigido.

Checklist: `auditing-supabase-security`, Fase 1, 40 itens em 10 categorias.
Quatro auditores independentes, um por superfície.

## Placar

| | |
|---|---|
| ❌ FALHA CRÍTICA | **0** |
| ⚠️ RISCO | 16 |
| ✅ OK, com comando e saída | 27 |
| 🔍 NÃO VERIFICADO | 17 |

Um achado da própria auditoria foi verificado por mim e **refutado** — ver "Erro
da auditoria", no fim.

## Nota sobre a skill

O `AGENTS.md` nomeia a skill como `auditoria-seguranca`. Ela **não existe
instalada**; o que existe é `auditing-supabase-security`, que tem a "Phase 1 —
Diagnosis" e cobre a intenção. Mas a *tabela de armadilhas* que o `AGENTS.md`
cita nominalmente ("Sessão que sobrevive") **não está nela**. A regra aponta para
algo que só existe pela metade — e era justamente aquela tabela que teria evitado
o incidente que originou a regra.

---

## O achado que a regra do AGENTS.md existe para pegar

**A mesma família de defeito reincidiu, no mesmo lugar.**

O `AGENTS.md` conta que a branch da gestão de equipe deixou passar um logout
desfeito por prefetch de `<Link>`: o Auth.js reemitia o cookie e "Sair" deixava
de revogar. Foi achado por e2e intermitente, quase descartado como teste instável
(commit `0a81737`).

O invariante que fechou aquilo — "toda navegação do painel é `prefetch={false}`"
— é **afirmado em dois lugares** (`(painel)/loading.tsx:36`,
`transicao.spec.ts:10,65`) e **existe em um só arquivo**: `nav-links.tsx:76`. Não
há padrão global em `next.config.ts`.

Dois grupos de `<nav>` ficaram de fora, **na mesma tela onde vive o botão
"Sair"**:

- `src/app/(painel)/configuracoes/layout.tsx:50`
- `src/app/(painel)/fluxos/[id]/page.tsx:103,120`

O e2e só exercita a barra lateral, que já estava coberta. Ou seja: o teste que
provou a correção não alcança os caminhos novos, e a afirmação no comentário é
mais larga que o código que a sustenta.

**Não verificado contra navegador** — a reprodução exige rodar o e2e, que está na
lista do que não foi executado.

---

## Riscos, por categoria

### Autenticação (4)

- **13 — logout não invalida sessão no servidor.** Sessão JWT sem store
  (`src/lib/auth.ts:10-12`, documentado): cookie copiado antes do "Sair" vale até
  8h. A metade local está provada; a do servidor não existe. Mais o achado de
  prefetch acima.
- **10 — MFA não existe** em nenhuma forma, e não consta como decisão adiada em
  spec nenhum.
- **11 — senha só tem comprimento** (mín. 8, máx. 72 bytes), sem lista de recusa.
  Agravado: a senha é definida pelo ADMIN e não há troca obrigatória no primeiro
  login.
- **9 — sem verificação de e-mail**, com justificativa que se sustenta enquanto o
  cadastro for fechado (sem auto-cadastro, sem "esqueci a senha").

### Banco e dado pessoal (6)

- **A7 — PII em texto claro.** `Contact.documento` (CPF/CNPJ), `endereco`,
  `observacoes`, `email`, `telefone`. O cofre do Ciclo 2a cifra segredo de API; a
  cifra do CPF **nunca foi decidida nem escrita**.

  Achado concreto: `contacts/service.ts:208-225` exclui `documento` do `AuditLog`
  e reduz `observacoes` a tamanho, mas grava **`endereco` inteiro, duas vezes por
  edição**, sob o mesmo argumento que venceu para o CPF. Linha de `AuditLog` não
  tem FK nem prazo de descarte: sobrevive à exclusão do contato.

  **Hoje: 4 contatos, nenhum com documento ou endereço preenchido.** É o momento
  mais barato possível para decidir.
- **R-A** — `public.rls_auto_enable()` é SECURITY DEFINER com EXECUTE para `anon`
  (os 2 WARN do advisor). É da plataforma, tem `search_path` fixo e retorna
  `event_trigger` — linha de base aceita em 4 ciclos, mas nunca decidida.

  **MEDIDO em 2026-08-21 contra a API real, com a chave `anon` legada:**
  `POST /rest/v1/rpc/rls_auto_enable` responde **HTTP 400**, não 403 — ou seja, a
  função **é alcançável**, e para na serialização do retorno
  (`0A000: cannot display a value of type event_trigger`). Função de gatilho de
  evento chamada fora do contexto dela não recebe dado de evento, então o
  impacto prático é baixo. **Continua risco, deixa de ser incógnita.**

  Não foi revogado: é função gerida pela plataforma, e a correção é ação do dono
  — `REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated;`
  Revogar muda a linha de base do advisor (2 WARN somem) e os documentos de
  auditoria que a citam precisam ser atualizados junto.
- **R-B** — `pg_default_acl` de `supabase_admin` em `public` ainda concede a
  `anon`/`authenticated`. A migration `20260813180000` admite não alcançar, mas
  descreve essas entradas como sendo de `auth/storage/realtime` — a linha medida
  é `public`. O e2e filtra só `defaclrole='postgres'`: ponto cego assumido.
- **R-C** — ~~`realtime.subscription` com RLS **desligada** e `SELECT` para
  `anon`~~ — **REBAIXADO em 2026-08-21, medido contra a API real.**
  A combinação existe, mas **não tem porta**: o schema `realtime` não está
  exposto na Data API. `GET /rest/v1/subscription` com a chave `anon` devolve
  `PGRST205: Could not find the table 'public.subscription' in the schema cache`.
  Fica registrado como observação, não como risco. Volta a ser risco no dia em
  que alguém expuser o schema `realtime` — o que o Ciclo 3 pode querer fazer.

  **De graça, na mesma medição: a blindagem foi confirmada ao vivo.**
  `GET /rest/v1/Contact` com a chave `anon` devolve
  `401 / 42501: permission denied for table Contact`. Não é só teste e migration
  — é o comportamento da API pública hoje.
- **F26/F27 — o `storage.ts` afirma uma rede que não existe.** O JSDoc diz que o
  bucket é privado e que há limite de tamanho e allowlist de MIME configurados no
  Supabase "em duplicidade" com o código. Medido: **zero buckets no projeto**,
  nada cria `crm-arquivos`. O arquivo está dormente (zero importadores), mas
  descreve uma segunda camada que ninguém construiu.

### Validação e abuso (4)

- **18 — `criarLead` não valida `nome` nem `email`.** `leads/service.ts:174-213`
  repassa intactos a `db.contact.create`. `telefone` é normalizado, os outros
  dois não: sem obrigatoriedade, teto nem formato. As regras só existem no Zod do
  cliente. Assimetria com o caminho de CONTATO, que valida tudo. Teto de fato: 1
  MB do `bodySizeLimit`.
- **24 — teto da OpenAI só por conversa** (20/h). Nenhum limite por empresa ou
  global: N conversas escalam o custo sem freio. O código admite
  (`turno.ts:114-118`) que o backstop é o teto de gasto no painel da OpenAI.
- **21 — `storage.ts` não renomeia o arquivo**: o `path` vem do chamador. Valida
  MIME por magic bytes, tamanho e traversal. Latente — zero importadores, nenhum
  `type="file"` no projeto.
- **20 — `parseValorBR` sem máximo** (`lib/dinheiro.ts:52`). 25 dígitos passam e
  quem recusa é o `Decimal(14,2)` do Postgres: mensagem genérica e erro
  inesperado no Sentry por entrada de formulário.

### Registro e monitoramento (2)

- **39 — login, logout e tentativa de login falha NÃO são auditados.** Troca de
  senha e exclusão são; a porta de entrada não, sem justificativa escrita. O
  `RateLimit` não substitui: conta acerto e erro junto (`login.ts:38-41`), é
  volátil (janela de 10 min) e não guarda o par conta/IP/instante.

  Sub-achado: **`AuditLog.ip` só é preenchido em 1 dos 23 pontos** que gravam
  auditoria (`export/leads/route.ts:279`).
- **40 — o alerta de rajada não passa por `dispatch.ts`.** Faz
  `notification.createMany` direto: lead novo rende e-mail, rajada destrutiva
  rende só um badge no sino. Nada cobre acesso suspeito nem pico de tráfego.

  **Deriva confirmada e maior que a relatada:** `ACOES_SENSIVEIS` foi
  6 → 7 → 9 → 10 → **14**, enquanto `LIMITE_ALERTA` aparece **uma única vez** na
  história do repositório (`4f4fb1d`, valor 10). Como o conjunto é contado junto,
  ampliá-lo equivale a baixar o limiar — e o próprio arquivo declara essa a
  direção segura. Deriva real, dano prático baixo.

---

## Fora da checklist: um achado do código que este ciclo acabou de escrever

**SSRF em `WhatsappConnection.dominio`.** A regex aceita `localhost` e
`169.254.169.254` (metadados de nuvem). Exige ADMIN — não é qualquer um — mas um
ADMIN pode apontar a conexão para dentro da rede do servidor e usar o CRM como
proxy. É do desenho do cofre (Ciclo 2a) e não estava previsto.

Menores, do mesmo levantamento: `pushName` do webhook sem `.max()`;
`criarLeadDeWhatsapp` sem chamador — se ligado, cai no mesmo buraco do item 18
com o nome controlado externamente; e `direcao` em `pipeline/actions.ts:124` sem
validação de runtime (benigno: qualquer valor diferente de `"cima"` vira
`"baixo"`).

---

## O que passou, e como foi provado

**Chaves e segredos — a prova mais forte da auditoria.** Existe build de produção
em disco **posterior ao HEAD**, e ele foi varrido: zero ocorrências em
`.next/static` de `SUPABASE_JWT_PRIVATE_JWK`, `COFRE_CHAVE_MESTRA`,
`service_role`, `AUTH_SECRET`, `eyJ`, `"kty"`, `postgresql://` e dos oito valores
reais do `.env`. Zero `NEXT_PUBLIC_` no projeto inteiro. A rota `/api/jwks` foi
conferida **executando** (`npx tsx`): publica só `alg,crv,kid,kty,use,x,y`, sem
`d`, e por lista branca — não por `delete`. A apikey da Evolution é write-only
pela tela, com e2e afirmando sobre o HTML servido.

**Cabeçalhos — 5 de 5.** CSP com nonce por requisição (`proxy.ts:128-152`), sem
`unsafe-inline` em `script-src`, `unsafe-eval` só em dev, com canário de rede
provando que script sem nonce não executa. HSTS `max-age=63072000` **no código**
(`next.config.ts:55-64`), não delegado à Vercel. `X-Frame-Options: DENY` mais
`frame-ancestors 'none'`. `nosniff`. `Referrer-Policy:
strict-origin-when-cross-origin`.

As duas diretivas que os ciclos futuros precisam: `connect-src 'self'` continua
**fechado** (Realtime não foi antecipado), e `frame-src` foi aberto só para
`https://n8n.nateksoft.com` — origem única, sem curinga, `script-src` intocado.

**Isolamento no banco.** 17/17 tabelas com RLS. Zero políticas é o default-deny
**correto**, não falha: o caminho do navegador ainda não está aberto, e criar
política para calar o advisor abriria o que está fechado. Zero grants a
`anon`/`authenticated`, zero views em `public`.

**SQL cru.** 5 chamadas, todas *template tag*, zero `*Unsafe`, 4 com `WHERE
companyId` escrito à mão — o `$queryRaw` está fora do alcance do mecanismo de
escopo, e as quatro compensam.

**Overfetching e mensagem de erro** — os dois pontos onde este projeto já falhou.
Varredura de relação curinga: 7 ocorrências, **7 em comentário, 0 em código**.
Nove repasses de `erro.message`, todos por allowlist; `P2002` e `P2003`
traduzidos.

**Rate limit de login:** 20/IP e 10/conta, atômico, IP antes de conta, e a cota é
consumida mesmo quando o e-mail não existe — não vira oráculo de enumeração.

**Sessão:** vida do cookie medida, não presumida — exatamente 8,00 h no cookie
real gravado pela suíte.

---

## Erro da auditoria, verificado por mim

Um auditor reportou que **`src/lib/env.ts` não é importado por ninguém**, e que
portanto a validação `AUTH_SECRET: z.string().min(32)` nunca roda.

**Falso.** `src/lib/prisma.ts:14` faz `import { env } from "./env"`, e tudo
importa `prisma.ts`. As outras sete ocorrências do grep são prosa. A validação
roda.

Fica registrado porque uma auditoria que não registra o próprio erro não merece
crédito nos demais achados.

---

## O que NÃO foi verificado

Dezessete itens, cada um com o comando no relatório da superfície correspondente
(`.superpowers/sdd/auditoria-fase1-*.md`). Os que mais importam:

- **Nenhum teste foi executado** — os quatro auditores rodaram em paralelo e
  `vitest`/`playwright` conflitariam. Vários `✅ OK` se apoiam em ler o teste, não
  em vê-lo passar. A suíte inteira passou na verificação do Ciclo 1f (1524
  testes, e2e 53/53), mas não dentro desta auditoria.
- **O achado do prefetch não foi reproduzido em navegador.**
- **Headers e CSP na resposta HTTPS real** — tudo foi lido do código.
- **`curl -X POST .../rpc/rls_auto_enable` com a anon key** — se responder 200,
  R-A deixa de ser risco e vira crítico.
- **Schemas expostos do PostgREST** — decide se R-C é alcançável de fora.
- **Teto de gasto no painel da OpenAI** — é o único backstop do item 24.

---

## Fase 2 não começou

O `AGENTS.md` é explícito: correção só depois da aprovação do dono. Nenhum dos 16
riscos foi tocado. Nenhum push, nenhum PR.
