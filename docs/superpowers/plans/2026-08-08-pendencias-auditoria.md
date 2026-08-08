# Pendências abertas — auditoria da branch `feature/edicao-do-que-ja-existe`

Data: 2026-08-08

A Fase 1 da skill `auditoria-seguranca` encontrou oito riscos nesta branch. **Seis foram
corrigidos** (commit `d6a66ad`). Os dois abaixo continuam abertos porque dependem de
decisão de produto, não de código — e ficam registrados aqui para não evaporarem no
histórico da conversa.

Nenhum é crítico. Nenhum bloqueia o uso do sistema.

---

## 1. Server Action sem limite de taxa

**O que é.** O limitador de taxa (`src/core/rate-limit/`) existe para o login, para o
webhook do WhatsApp e para o turno do atendente. **Nenhuma Server Action tem limite** — nem
as sete desta entrega, nem as que já existiam.

Server Action é endpoint HTTP público: quem tem sessão válida pode chamá-la em laço. Não dá
acesso a dado alheio (a autorização continua valendo a cada chamada), mas permite consumir
banco e CPU do servidor sem teto.

**Por que não foi corrigido junto.** Implementar exige decisões que são do dono, e chutar
erraria para os dois lados — um limite frouxo não protege, um apertado atrapalha quem
trabalha rápido:

| Decisão | Opções |
|---|---|
| Escopo da chave | Por conta, por IP, ou os dois |
| Teto | Quantas chamadas por minuto |
| Alcance | Todas as actions, ou só as que escrevem |

**Onde mexer quando decidir.** `src/core/rate-limit/limiter.ts` já tem a mecânica; o
modelo `RateLimit` já existe no banco. Seria um guarda no topo de cada action, no molde do
que `credenciais.ts` faz no login.

---

## 2. Criar e editar discordam sobre quem atribui responsável

**O que é.** As duas metades da mesma regra não combinam:

| Operação | Comportamento hoje |
|---|---|
| **Criar** (`criarLeadManual`) | Força o responsável para o próprio autor quando quem cria não tem `ver_dashboard_geral` — ou seja, VENDEDOR não cadastra lead no nome de um colega |
| **Editar** (`atualizarLead`) | Aceita qualquer responsável para quem tem `mover_lead` — que os três papéis têm |

Na prática a trava de criação não trava nada: o vendedor cria o lead para si e, no clique
seguinte, reatribui ao colega. Dá trabalho sem impedir o resultado.

**Contexto da decisão.** O dono já afirmou, nesta auditoria, que "os leads têm que ser
vistos por todos daquela empresa" — o que aponta para soltar a criação. Mas isso muda
**quem pode atribuir lead a outra pessoa**, que é regra de negócio, e por isso não foi
alterado por conta própria.

**Os dois caminhos:**

- **Soltar a criação** — remover o clamp em `criarLeadManual` (`src/core/leads/actions.ts`)
  e mostrar o `<select>` de responsável para todo papel em `leads/page.tsx`. Coerente com o
  modelo colaborativo.
- **Fechar a edição** — exigir `ver_dashboard_geral` para *trocar* o responsável em
  `atualizarLead`, mantendo valor e etapa livres. Coerente com a trava de criação.

O que não se sustenta é o estado atual, que é o pior dos dois.

---

## Registrado, mas fora do escopo desta branch

- **WhatsApp inerte em produção.** Faltam `EVOLUTION_*`, `OPENAI_API_KEY` e `WHATSAPP_*`
  na Vercel. Decisão deliberada do dono, não esquecimento.
- **`feature/conversa-aguardando-humano` sem merge**, embora a migração dela **já esteja
  aplicada no banco de produção** — foi o que quase provocou um reset do banco ao gerar a
  migração desta branch. A branch precisa ser integrada ou descartada; deixá-la nesse
  meio-termo mantém o banco à frente do código de `main`.
- **O sistema fora da superfície desta branch nunca passou por varredura completa.** As
  auditorias até aqui foram sempre escopadas à branch da vez.
