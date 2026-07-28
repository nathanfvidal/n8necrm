# CRM Base — Design

**Data:** 2026-07-28
**Status:** Aprovado para implementação (Fase 0 + 1)

---

## 1. Objetivo

Construir um CRM B2B base, clonável por cliente, que controla os dados de um site
institucional ou mostruário: leads, funil de vendas, catálogo publicado e métricas
de origem de tráfego.

O primeiro caso concreto é um mostruário automotivo estilo WebMotors: a revenda
cadastra veículos no painel, eles aparecem no site público, e todo interesse
gerado (formulário, WhatsApp, telefone) vira lead rastreável até o fechamento.

### O que significa "adaptável"

O sistema atende clientes de verticais diferentes — revenda de veículos hoje,
imobiliária ou clínica amanhã. A adaptação acontece por **fork do repositório**,
não por configuração em runtime.

Consequência aceita: um bugfix no núcleo precisa ser propagado manualmente para
cada fork. A mitigação é arquitetural — o núcleo é pequeno, estável e isolado dos
módulos, então o merge entre forks tende a não conflitar.

### Fora de escopo

- Isolamento multi-tenant (cada fork atende uma empresa)
- Inbox de WhatsApp via Cloud API (registrado como fase futura)
- Aplicativo mobile
- Qualificação de lead por IA

---

## 2. Decisões estruturais

Cinco decisões explicam o resto do documento.

### 2.1 Modelo agência, não SaaS

Cada cliente recebe um clone do repositório, com seu próprio deploy e banco.

**Por quê:** o usuário atende clientes sob medida, com sites visualmente distintos.
Um SaaS multi-tenant exigiria isolamento por tenant, RLS e um motor de temas —
complexidade que não se paga com um cliente.

**Custo:** manutenção multiplicada por N forks.

### 2.2 Sem `tenantId`

Nenhuma tabela carrega identificador de organização.

**Custo, dito às claras:** migrar para SaaS hospedado depois exigirá adicionar
`tenantId` a todas as tabelas e revisar todas as queries. Risco aceito
conscientemente, coerente com 2.1.

### 2.3 Pessoa e oportunidade são tabelas separadas

`Contact` é a pessoa (telefone único). `Lead` é a oportunidade.

**Por quê:** o mesmo comprador retorna meses depois interessado em outro veículo.
Com uma tabela só, ele vira dois registros e o histórico se perde. A separação
também torna a deduplicação natural — o telefone é a chave.

### 2.4 Etapas do funil são dados, não enum

`PipelineStage` é tabela, populada no seed a partir de `config/client.ts`.

**Por quê:** o funil da revenda ("Visita agendada") difere do funil do corretor.
Como `enum`, cada cliente exigiria migração de schema.

### 2.5 Campos da vertical em JSONB

`Item.dados` é `JSONB`, validado por schema Zod gerado de `config/client.ts`.
Colunas reais só para o que é filtrado, ordenado ou indexado: título, preço,
status, slug.

**Por quê:** veículo tem `km` e `cambio`; imóvel tem `quartos` e `bairro`.
Colunas fixas obrigariam migração por vertical; JSONB puro perderia performance de
filtro. O híbrido resolve os dois.

---

## 3. Arquitetura

### 3.1 Topologia

Aplicação Next.js única. Um projeto, um deploy, um banco. Dentro dela, dois grupos
de rota: `(painel)` autenticado e `(site)` público.

**Por quê:** com zero clientes ativos, monorepo é complexidade adiantada. A
migração para Turborepo depois é mecânica — mover pastas e ajustar imports.

### 3.2 Estrutura de pastas

```
src/
  core/                    Todo fork tem, sempre
    auth/                    sessão, papéis, permissões
    leads/                   captação, deduplicação, atribuição
    pipeline/                etapas, movimentação
    tasks/                   tarefas, lembretes
    notifications/           in-app, e-mail, webhook
    audit/                   registro de alterações
  modules/                 Liga/desliga por cliente
    catalog/                 itens, imagens, publicação
    analytics/               eventos, UTM, agregação
    automation/              regras, webhooks          [Fase 4]
    campaigns/               Meta Ads, Google Ads      [Fase 5]
    finance/                 propostas, comissão       [Fase 6]
  app/
    (painel)/              rotas autenticadas
    (site)/                rotas públicas
    api/track/             ingestão de eventos
    ir/whatsapp/[itemId]/  redirecionamento rastreado
  components/ui/           shadcn — livre para redesenhar por fork
  lib/                     prisma, auth, storage, validação
config/
  client.ts                O arquivo que define o fork
```

### 3.3 A regra de dependência

**`modules/` pode importar de `core/`. `core/` nunca importa de `modules/`.**

Garantida por regra de ESLint que quebra o build. É isso que permite desligar o
catálogo sem quebrar o funil, e propagar correções do núcleo entre forks sem
conflito.

### 3.4 O arquivo do fork

```ts
// config/client.ts
export const client = {
  nome: "AutoCenter Silva",
  vertical: "automotivo",
  marca: { logo: "/logo.svg", corPrimaria: "#0F62FE", fonte: "Inter" },
  modulos: ["catalog", "analytics"],
  entidade: {
    singular: "Veículo",
    plural: "Veículos",
    campos: [
      { nome: "marca",  tipo: "texto",   obrigatorio: true,  filtravel: true },
      { nome: "modelo", tipo: "texto",   obrigatorio: true,  filtravel: true },
      { nome: "ano",    tipo: "numero",  obrigatorio: true,  filtravel: true },
      { nome: "km",     tipo: "numero",  obrigatorio: false, filtravel: true },
      { nome: "cambio", tipo: "opcao",   opcoes: ["Manual", "Automático"] },
      { nome: "cor",    tipo: "texto",   obrigatorio: false, filtravel: false },
    ],
  },
  funil: ["Novo", "Contato feito", "Visita agendada", "Proposta", "Fechado"],
  whatsapp: { numero: "5511999999999", mensagem: "Olá, tenho interesse no {item}" },
}
```

Trocar de vertical é trocar esse arquivo. Módulo ausente de `modulos` some do menu
e sua rota devolve 404 — não é CSS escondendo botão.

### 3.5 Stack

| Camada | Escolha |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript |
| Estilo/UI | Tailwind v4 + shadcn/ui |
| Banco | PostgreSQL + Prisma 7 |
| Autenticação | Auth.js v5 (credentials + Google) |
| Storage | Interface `lib/storage.ts`; Supabase Storage inicial, R2 depois |
| Imagens | `sharp` — WebP, thumbnail, blurhash |
| Formulários | react-hook-form + Zod v4 |
| Tabelas | TanStack Table |
| Kanban | dnd-kit |
| Gráficos | Recharts |
| E-mail | Resend + React Email |
| Agendamento | Vercel Cron + QStash |
| Erros | Sentry |
| Testes | Vitest + Playwright |
| Deploy | Vercel |

Todas gratuitas na fase de construção. O primeiro custo real (~US$20/mês, Vercel
Pro) surge quando houver cliente comercial.

---

## 4. Modelo de dados

### 4.1 Núcleo

| Tabela | Campos |
|---|---|
| `User` | nome, email✦, senhaHash, papel(ADMIN\|GESTOR\|VENDEDOR), ativo |
| `Contact` | nome, telefone✦, email, criadoEm |
| `Lead` | contactId?, itemId?, stageId, responsavelId, canal(FORMULARIO\|WHATSAPP\|MANUAL), valorEstimado, sessionId?, utm{}, criadoEm, ultimaInteracaoEm |
| `PipelineStage` | nome, ordem, cor, ehGanho, ehPerdido |
| `LeadNote` | leadId, autorId, texto, criadoEm |
| `Task` | titulo, descricao, vencimento, concluidaEm, responsavelId, leadId? |
| `Notification` | userId, tipo, payload{}, lidaEm |
| `AuditLog` | userId, acao, entidade, entidadeId, antes{}, depois{}, ip, criadoEm |
| `RateLimit` | chave✦, janelaInicio, contagem |

✦ = índice único

`Lead.contactId` é opcional porque o lead vindo de clique no WhatsApp (5.2) nasce
antes de a pessoa se identificar. Todo lead tem etapa e responsável; nem todo lead
tem, desde o primeiro instante, um nome.

### 4.2 Módulo `catalog`

| Tabela | Campos |
|---|---|
| `Item` | titulo, slug✦, descricao, preco, status(RASCUNHO\|PUBLICADO\|RESERVADO\|VENDIDO\|ARQUIVADO), destaque, dados{}, publicadoEm, criadoEm |
| `ItemImage` | itemId, url, ordem, alt, largura, altura, blurhash |

### 4.3 Módulo `analytics`

| Tabela | Campos |
|---|---|
| `Event` | tipo(VIEW_ITEM\|CLICK_WHATSAPP\|SUBMIT_FORM), itemId?, sessionId, utm{}, referrer, criadoEm |
| `DailyItemStat` | itemId, dia, views, cliques, leads |

`Event` tem índice único em `(sessionId, itemId, tipo, dia)`. Essa constraint é a
garantia de idempotência: recarregar a página cinquenta vezes conta uma view.

### 4.4 O `sessionId` costura o sistema

Nasce como cookie anônimo na primeira visita ao site, viaja em cada evento e é
gravado no `Lead` quando a pessoa converte. É o que permite responder: *"este lead
veio de um anúncio do Instagram, olhou 4 veículos antes de decidir, e fechou por
R$ 68 mil."*

### 4.5 Agregação

Contar eventos ao vivo funciona com mil registros e trava com dois milhões. Um job
noturno agrega o dia anterior em `DailyItemStat`; o dashboard lê a tabela agregada.
`Event` guarda o detalhe bruto para investigação.

### 4.6 Índices

- `Lead(stageId, responsavelId)` — carregamento do kanban
- `Lead(criadoEm)` — relatórios por período
- `Item(status, publicadoEm)` — listagem do site
- `Event(itemId, criadoEm)` — agregação
- `Contact(telefone)` único — deduplicação

---

## 5. Fluxos

Cada fluxo indica a fase em que é construído. Os das fases posteriores estão aqui
porque o modelo de dados da Fase 1 precisa acomodá-los sem retrabalho.

### 5.1 Visitante vira lead (formulário) — Fase 2

```
Site → validação no cliente (Zod) → Server Action
  → honeypot + tempo mínimo de preenchimento + rate limit por sessão
  → busca Contact por telefone, ou cria
  → cria Lead na primeira etapa, com itemId, sessionId e UTM
  → responde SUCESSO ao visitante        ◄── visitante liberado aqui
  → em segundo plano: notificação in-app, e-mail, webhook
```

A ordem é deliberada. A confirmação vai ao visitante **antes** das notificações.
Se o Resend estiver fora do ar, o lead já está salvo — o cliente perde o aviso,
não o negócio.

### 5.2 Clique no WhatsApp — Fase 2

```
Botão → /ir/whatsapp/[itemId] (rota do servidor)
  → grava Event CLICK_WHATSAPP
  → cria Lead com canal WHATSAPP (contato ainda desconhecido)
  → 302 para wa.me com mensagem pré-preenchida
```

Rota no servidor, não `fetch` no navegador: bloqueadores de anúncio comeriam o
registro feito pelo cliente, e o painel mostraria "0 cliques" num botão usado o dia
inteiro.

O lead criado aqui nasce sem `contactId` — a pessoa ainda não se identificou.
O vendedor completa o cadastro quando a conversa começa.

### 5.3 Publicação de item — Fase 2

```
Painel: RASCUNHO → PUBLICADO
  → valida campos da vertical (Zod gerado de config/client.ts)
  → gera slug único a partir do título
  → processa imagens: WebP, thumbnail, blurhash
  → revalidateTag('catalogo') → site atualiza sem rebuild
```

### 5.4 Trabalho do vendedor — Fase 1

Kanban por `PipelineStage`. Arrastar card grava `ultimaInteracaoEm` e um
`AuditLog`. Etapa marcada como `ehGanho` ou `ehPerdido` encerra a oportunidade e
alimenta a taxa de conversão do dashboard.

---

## 6. Erros e resiliência

**Falha de módulo secundário nunca derruba o principal.** Analytics indisponível
não impede a criação de lead. Foto que falhou no upload não perde o veículo
cadastrado — entra como pendente e é reprocessada.

**E-mail e webhook são entregas com retry** (QStash), não chamadas diretas.
Falha definitiva aparece no painel como pendência visível — silêncio é pior que
erro.

**Validação em duas bordas, um schema só.** O mesmo Zod valida no navegador e no
servidor. O do navegador é conveniência; o do servidor é a verdade.

**O usuário vê linguagem; o Sentry vê stack.** Nunca o contrário.

---

## 7. Segurança e custo de abuso

O site público é a superfície mais atacável, e os endpoints mais expostos são
justamente os que sustentam o produto.

| Vetor | Sem proteção |
|---|---|
| Formulário de lead | Bot despeja milhares de leads falsos; o funil vira lixo |
| `/api/track` | Views e cliques inflados; o analytics passa a mentir |
| Login | Brute force nas contas dos vendedores |
| Imagens | Hotlink e transformação sob demanda: banda explode |
| APIs de Ads (Fase 5) | Quota estourada por chamada ao vivo no dashboard |

### Três camadas

**1. Aplicação — desde a Fase 1, sem depender de fornecedor:**
honeypot e tempo mínimo no formulário, rate limit por sessão e por usuário,
deduplicação de contato por telefone.

O rate limit inicial é implementado no próprio PostgreSQL — contagem por janela
deslizante numa tabela `RateLimit`, sem serviço externo. É suficiente para o volume
de um cliente único e mantém o custo em zero. A troca por Upstash Redis fica
registrada como opção para quando o volume provar necessidade, atrás da mesma
interface.

**2. Banco — idempotência:** view contada uma vez por sessão por dia, garantida
por constraint única. Mesmo que as outras camadas falhem, o número não infla.

**3. Borda — Cloudflare, a partir da Fase 2:** WAF, Bot Fight Mode, rate limiting
por rota, cache das páginas do mostruário e Turnstile no formulário.

**Cloudflare entra depois porque ativar é trocar nameservers — não toca em código.**
Duas exceções recebem preparo antecipado:

- **Turnstile:** o gancho já nasce no componente de formulário, desligado por
  variável de ambiente. Ligar depois não exige refatoração.
- **Storage:** nasce atrás de `lib/storage.ts`. Trocar Supabase Storage por R2 vira
  trocar uma implementação, sem migrar URLs já indexadas.

**APIs de Ads nunca são chamadas ao vivo.** Um job sincroniza métricas em intervalo
fixo e grava no banco local; o dashboard lê do banco. A quota fica previsível
independente de quantas pessoas abram o painel.

---

## 8. Testes

| Camada | Cobertura | Justificativa |
|---|---|---|
| **Vitest** | Fase 1: deduplicação de contato por telefone, transição de etapa, permissões por papel, rate limit. Fase 3: idempotência de view, agregação diária | Regras onde bug é silencioso — ninguém percebe até o número estar errado há um mês |
| **Playwright** | Fase 1: criar lead manual → mover no funil → marcar como ganho. Fase 2: visitante → formulário → lead no funil; publicar item → aparece no site | Atravessam site, banco e painel. Se passam, o produto funciona |
| **Sem teste** | CRUD trivial, componentes shadcn, layout | Teste que repete o framework custa manutenção e não pega bug |

O seed é determinístico: um cliente fictício, dois vendedores, doze veículos, leads
distribuídos pelas etapas. Serve para teste, desenvolvimento e demonstração a
prospect.

---

## 9. Fases

Cada fase recebe seu próprio ciclo spec → plano → implementação.
**Esta spec cobre Fase 0 + 1 em detalhe de implementação.** As demais estão
registradas para que o modelo de dados nasça correto e não exija retrabalho.

| Fase | Entrega | Estado do produto |
|---|---|---|
| **0** | Fundação: auth, papéis, banco, storage, design system, deploy, audit log | Esqueleto que sobe |
| **1** | CRM núcleo: contatos, leads, funil kanban, tarefas, notas, notificações, dashboard | **Vendável** |
| **2** | Catálogo + site mostruário, formulário e WhatsApp rastreados, SEO, Cloudflare | Caso da revenda completo |
| **3** | Analytics: eventos, UTM, desempenho por item, relatórios, metas | O diferencial do produto |
| **4** | Automação: webhooks, regras, integração n8n, alertas | Escala sem intervenção |
| **5** | Campanhas pagas: Meta Ads, Google Ads | Depende de conta do cliente |
| **6** | Financeiro: propostas, contratos, comissão | Sob demanda |

### Escopo detalhado da Fase 0

- Projeto Next.js 16 + TypeScript + Tailwind v4 + shadcn/ui
- Prisma 7 + PostgreSQL, migrações e seed determinístico
- Auth.js v5: login por credenciais, sessão, middleware de proteção de rota
- Papéis ADMIN / GESTOR / VENDEDOR e verificação de permissão
- `config/client.ts` e o carregamento de módulos
- Regra de ESLint que impede `core/` importar de `modules/`
- `lib/storage.ts` com implementação inicial
- `AuditLog` gravado por um wrapper das operações de escrita
- Layout do painel: navegação, cabeçalho, estados de carregamento e vazio
- Sentry, Vitest, Playwright configurados
- Deploy na Vercel com preview por branch

### Escopo detalhado da Fase 1

- CRUD de `Contact` com deduplicação por telefone
- CRUD de `Lead`, criação manual (canal MANUAL) e atribuição a vendedor
- `PipelineStage` populado do `config/client.ts`
- Kanban com dnd-kit: arrastar entre etapas, gravar auditoria
- Listagem de leads com TanStack Table: filtro por etapa, responsável e período
- `LeadNote`: histórico de anotações por lead
- `Task`: criação, vencimento, conclusão, vínculo opcional a lead
- `Notification`: central in-app e disparo de e-mail via Resend
- Dashboard: leads por etapa, taxa de conversão, tarefas vencendo, atividade recente
- Exportação de leads em CSV
- Testes das regras acima em Vitest; E2E do fluxo lead → ganho em Playwright

---

## 10. Riscos conhecidos

| Risco | Mitigação |
|---|---|
| Propagação de correções entre forks | Núcleo pequeno, estável e isolado por regra de lint |
| Migração para SaaS exigiria `tenantId` em tudo | Aceito conscientemente (2.2) |
| `Item.dados` em JSONB não é validado pelo banco | Zod na borda + testes; campos filtráveis viram colunas quando o uso provar necessidade |
| Lead de WhatsApp nasce sem contato identificado | Vendedor completa no painel; o lead existe e é rastreável desde o clique |
| Vercel Hobby proíbe uso comercial | Migrar para Pro no primeiro cliente pagante |
