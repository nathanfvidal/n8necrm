# Estado do n8necrm — 2026-08-21

Branch `ciclo-1a-tenancy`, **~145 commits, nada integrado, nada publicado.**

Este documento existe para responder duas perguntas: **o que dá para testar
agora**, e **o que só você pode desbloquear**.

---

## Verificação, rodada por inteiro nesta data

Os números abaixo são de **2026-08-21, ANTES do Ciclo 2d** (a saída da Vercel e
a fila em Postgres). A verificação final daquele ciclo os remede e substitui —
enquanto esta linha existir, leia-os como o último estado medido, não como o
atual.

| | |
|---|---|
| `npm run typecheck` | limpo, sem saída |
| `npm run lint` | 0 erros (6 avisos pré-existentes, herdados da base) |
| `npm run build` | verde |
| `npx vitest run tests/unit` | **1622 passando**, 13 pulados, 0 falhas |
| `npm run test:e2e` | **54 passando** (3 workers) |

Banco de desenvolvimento, medido depois de tudo: 1 empresa, 6 usuários, 6
vínculos, 4 contatos, 4 leads, 4 etapas, 0 conversas, 0 conexões, 135 linhas de
auditoria. **Zero usuário sem vínculo, zero resíduo de fixture.**

---

## Como testar agora

```bash
npm run dev
```

Entre em `http://localhost:3000/login`.

| conta | senha |
|---|---|
| `admin@exemplo.com` | `uBT2XKTPNqYC3k40yYysFHXhDNpEOvEo` |
| `vendedor@exemplo.com` | `+3wi9uKIrqw4KZYLO0OV+bsQQweLHhiM` |

**Estas senhas são rotacionadas toda vez que a suíte roda**, porque o seed
reescreve as duas. Se o login falhar, é isso — e a rotação é uma linha:
`prisma/seed.ts` grava `SEED_PASSWORD`.

### O que funciona de ponta a ponta

Leads (criar, mover no funil, arquivar, exportar), contatos, tarefas, etapas do
funil, gestão de equipe, painel de fluxos do n8n com o editor em iframe,
configurações com a aba de conexões, e a tela de conversas com o agente de IA.

### O que NÃO funciona sem você

**Conversa de WhatsApp de verdade.** Não há conexão cadastrada (`0` linhas em
`WhatsappConnection`), e cadastrar exige a apikey da Evolution mais colar a URL
do webhook no painel dela. A tela existe em `/configuracoes/conexoes`.

**Tempo real.** O Ciclo 3 depende do Ciclo 1b, que depende de você (abaixo).

---

## O que só você pode desbloquear

Em ordem de impacto.

### 1. Realtime → Settings → desligar *Allow public access*

**Sem isso, todo o Ciclo 1b vira decoração.** O RLS de canal não tranca nada se
o acesso público estiver ligado. É um clique, e é o item mais importante desta
lista.

### 2. Settings → JWT Keys — me diga o que aparece

Quantas chaves existem e o estado de cada uma (`in_use`, `standby`,
`previously_used`), e se a legada ainda está listada. Hoje isso é `NÃO
VERIFICADO` no spec do Ciclo 1b, e o plano assume a leitura pessimista por não
saber.

### 3. Registrar o provider de third-party auth

Com o JWKS do CRM. **Em desenvolvimento tem que ser `custom_jwks` inline** — o
Supabase não alcança `localhost`. A documentação da Meta se contradiz aqui (o
guia exige OIDC discovery, o OpenAPI aceita `jwks_url`/`custom_jwks`); me diga o
que o formulário mostra de verdade.

Precisa de um Personal Access Token se o registro só sair pela Management API.

### 4. Escolher a hospedagem, e ligar o gatilho da fila

A Vercel saiu (Ciclo 2d). O app roda em qualquer Node, e **onde** é decisão
sua. Três coisas dependem dela.

**Ligue um gatilho da fila — sem isso o WhatsApp fica mudo.** Mensagem entra,
vira linha em `TurnoJob`, e ninguém responde. **Nenhum erro aparece em lugar
nenhum**: é o pior modo de falha possível, porque o sistema parece saudável. O
Vercel Queues empurrava sozinho; agora alguém tem de puxar.

- Node sempre ligado (recomendado): `npm run fila:worker` como serviço. Não
  abre porta nenhuma, e o laço de 2s mantém a resposta em ~8-10s — praticamente
  o que a Vercel entregava.
- Ou um agendador batendo em `POST /api/queues/whatsapp-turn` com o cabeçalho
  `x-fila-segredo` (pg_cron+pg_net do Supabase, cron de VPS, workflow do n8n).
  Um cron de um minuto faz a resposta ao cliente sair em até ~68s.

**`WHATSAPP_QUEUE_SECRET` virou a única defesa dessa rota.** Até o Ciclo 2d ela
era segunda camada atrás do air-gap que a plataforma garantia — a rota não era
alcançável da internet. Agora é, e o que a protege é só o segredo em cabeçalho,
comparado em tempo constante, com 404 para quem erra. Gere com
`openssl rand -hex 32`, não reaproveite, e trate como credencial de produção.

**Defina três variáveis no ambiente do deploy:**

- `IP_CABECALHO_CONFIAVEL` — o cabeçalho que a sua borda SOBRESCREVE (não o que
  ela acrescenta). Sem ela não há limite por IP no login, o balde do webhook é
  por empresa e `AuditLog.ip` fica nulo.
- `SENTRY_ENVIRONMENT` — `VERCEL_ENV` não existe mais; sem ela todo evento
  chega ao painel rotulado `local`, inclusive os de produção.
- `SUPABASE_JWT_ISSUER` — a origem pública real (Ciclo 1b).

E gere `COFRE_CHAVE_MESTRA` (`openssl rand -base64 32`) onde for publicar —
sem ela o WhatsApp não sobe, e não há fallback.

Se existir projeto na Vercel, **apague-o e as variáveis que estiverem lá**, em
especial `EVOLUTION_DOMAIN`, `EVOLUTION_INSTANCE`, `EVOLUTION_APIKEY` e
`EVOLUTION_COMPANY_ID`: elas morreram no código no Ciclo 2a, e apikey esquecida
em painel é credencial viva sem dono.

### 5. Uma linha de SQL, se você quiser

```sql
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated;
```

Medido: a função **é** alcançável por `anon`, e para na serialização do retorno.
Impacto prático baixo. Não revoguei porque é função gerida pela plataforma e
você estava dormindo — e porque revogar muda a linha de base do advisor que
quatro documentos de auditoria citam.

---

## Decisões que ficaram esperando você

Estas **não** são defeitos. São recursos que nunca existiram, e construí-los sem
você pedir seria ampliar escopo. A auditoria os lista porque a checklist
pergunta.

| | O que existe hoje |
|---|---|
| **MFA** | não existe em nenhuma forma |
| **Verificação de e-mail** | não existe; se sustenta enquanto o cadastro for fechado |
| **Complexidade de senha** | só comprimento (8 a 72 bytes), sem lista de recusa |
| **Invalidação de sessão no servidor** | não existe: sessão JWT sem store, cookie copiado antes do "Sair" vale 8h |

O último é o mais caro: fechá-lo significa trocar sessão JWT por sessão em
banco, o que é decisão de arquitetura, não correção.

**Um item de retenção**, também seu: tentativa de login **recusada** não vira
linha de `AuditLog`. Foi decisão consciente — gravar só a metade identificável
reabriria o oráculo de tempo que o `HASH_INERTE` fechou. A alternativa (tabela
`LoginAttempt` sem FK) está escrita no relatório da Fase 2.

---

## O que foi feito enquanto você dormia

Auditoria de segurança Fase 1 (40 itens, quatro auditores independentes,
**zero falhas críticas**), e a Fase 2 corrigindo dez achados.

O que mais importa dos dez:

**A reincidência que a regra do `AGENTS.md` existe para pegar.** O invariante
"toda navegação do painel é `prefetch={false}`" era afirmado em dois lugares e
existia num arquivo só. A auditoria nomeou 2 `<nav>` fora; a varredura achou
**13 dos 15 `<Link>` do painel**. Todos corrigidos, com trava que reprova
`<Link>` sem a prop e e2e que observa o fio no build de produção. E o passo do
defeito foi **observado**: a resposta de uma rota do painel traz mesmo
`set-cookie: authjs.session-token`.

**SSRF no domínio da conexão** — do código que eu mesmo escrevi no Ciclo 2a. A
regex aceitava `localhost` e `169.254.169.254`, e teria perdido para
`2130706433`, `0177.0.0.1` e `127.1`. Trocada por `new URL()`, com HTTPS exigido
e `redirect: "error"` — sem este último, um 302 para o endereço de metadados
continuava aberto.

**Login e logout agora são auditados**, com o `ip` chegando aos 22 pontos que
não o tinham.

**A incoerência do dado pessoal**: `contacts/service.ts` excluía o CPF do log de
auditoria e gravava o **endereço inteiro, duas vezes por edição**, sob o mesmo
argumento. Agora o critério está escrito uma vez, para os onze campos.

**Teto de custo da IA por empresa** — antes só havia teto por conversa, e N
conversas escalavam sem freio, com o backstop sendo o painel da OpenAI.

O relato completo está em `docs/auditorias/2026-08-21-fase1-seguranca-branch-tenancy.md`
e nos relatórios `.superpowers/sdd/fase2*.md`.

---

## Pendências técnicas que sobram

| | |
|---|---|
| **A fila não drena sozinha** | Nenhum gatilho é ligado por padrão. É a única regressão funcional da saída da Vercel, que empurrava sozinha. Falha em SILÊNCIO. **Bloqueio antes de publicar.** |
| **Sem IP confiável** | Enquanto `IP_CABECALHO_CONFIAVEL` não for definida: login sem limite por IP (o por conta continua valendo), `AuditLog.ip` nulo, e o balde do webhook é por empresa — quem souber o `companyId` pode queimá-lo. |
| **Banco de teste separado** | o de desenvolvimento é o mesmo; a suíte reescreve as senhas do seed e duas execuções simultâneas de `vitest` o envenenam. **Bloqueio antes de publicar.** |
| `REMETENTE` do e-mail | ainda é `notificacoes@exemplo.com`, domínio de exemplo que o Resend recusará |
| Bucket de storage | não existe; `storage.ts` está dormente e agora **diz** isso |
| Máscara de dinheiro no cliente | deixa digitar acima do teto; só o servidor recusa |
| Conversas antigas sem `connectionId` | param de ser respondidas quando a empresa cadastrar a 2ª conexão (hoje: 0 conversas, então 0 linhas afetadas) |

---

## O que não fiz de propósito

Nenhum push, nenhum PR, nenhum deploy. Nada na VPS. Nenhum projeto criado no
Supabase. Nenhuma instância da Evolution pareada. Nenhum grant revogado.

O `AGENTS.md` proíbe merge sem a auditoria aprovada por você — ela está pronta e
esperando sua leitura.
