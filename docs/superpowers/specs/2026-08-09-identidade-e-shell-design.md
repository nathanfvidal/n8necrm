# Identidade visual e shell do painel

Data: 2026-08-09 · Primeira das specs de front-end. Cobre **tokens + shell**; a revisão
tela a tela é a spec seguinte.

> **Legenda** ✅ decidido · 🟡 decidido com reversão barata · ❓ em aberto

## 1. O problema

O CRM tem 13 telas funcionando e nenhuma identidade. Concretamente, medido no código:

| Sintoma | Evidência |
|---|---|
| Marca declarada e nunca ligada | `config/client.marca` tem `logo`, `corPrimaria: "#0F62FE"` e `fonte: "Inter"`; **nenhum arquivo do `src/` lê esse campo** |
| Cor real é cinza | `--primary: oklch(0.205 0 0)` — croma zero |
| Fonte real não é a declarada | `layout.tsx` carrega **Geist**, não Inter |
| Logo não existe | `public/` só tem os cinco SVGs do `create-next-app` |
| Navegação sem estrutura | `painel-nav.tsx` é um `flex` com 7 links, sino, nome e "Sair" na mesma linha; nenhum `md:`, nenhum recolhimento |
| Modo escuro inalcançável | `globals.css` define `.dark` completo; **nenhum `ThemeProvider` existe** — e `ui/sonner.tsx` já chama `useTheme()` contra esse provedor ausente |
| Sidebar sem sidebar | `globals.css` define 8 tokens `--sidebar-*` em claro e escuro; não existe `ui/sidebar.tsx` |
| Layout raiz intocado | `title: "Create Next App"`, `lang="en"` num sistema em português |

`lang="en"` não é estética: faz leitor de tela pronunciar português com fonética inglesa.

**Resultado pretendido:** trocar um hex em `config/client.ts` muda a cara das 13 telas, e a
navegação passa a comportar o crescimento por módulo e a tela pequena.

## 2. Decisão de produto ✅

**White-label por cliente.** Cada fork veste a marca do cliente. `config/client.marca` é a
fonte, e passa a ser lida de verdade.

### 2.1 A referência visual ✅

**O painel da Vercel.** Ela define coisas que nenhuma regra de token define sozinha:

| Traço da referência | Consequência aqui |
|---|---|
| Tipografia **Geist** | já é a fonte carregada em `layout.tsx` — custo zero |
| Ícone monocromático + rótulo por item | `lucide-react` já é dependência e já é usada |
| Ativo = preenchimento **neutro** arredondado | não é barra colorida nem cor de marca |
| Grupos separados por régua fina | os 7 links deixam de ser uma lista plana |
| Usuário, tema e sino no **rodapé da barra** | some a barra superior no desktop |
| **Superfícies quase sem cor** | ver o aviso abaixo |

> ⚠️ **Isto contradiz a § 5.4 da primeira versão desta spec.** Lá eu defendi croma
> perceptível nas superfícies como o que separa white-label de "trocamos a cor do botão".
> A referência escolhida diz o contrário: a contenção **é** o design, e o cinza é cinza.
>
> A § 5.4 foi reescrita para a resolução que mantém os dois valores: **a marca vive na
> ação** — botão, foco, gráfico — e as superfícies ficam praticamente neutras, com um
> sussurro de croma que o olho lê como temperatura sem ler como cor. Os multiplicadores da
> § 5.3 caíram de 3 a 5 vezes.

## 3. Restrições medidas ✅

Do `src/proxy.ts:123-131`, não de suposição:

```
style-src 'self' 'unsafe-inline'
font-src  'self'
script-src 'self' 'nonce-<n>' 'strict-dynamic'
```

**Três consequências que amarram o desenho:**

1. **Cor pode ser injetada em tempo de execução** — `unsafe-inline` já está lá porque o
   quadro de funil pinta etapas com atributo `style`.
2. **Fonte não pode vir de CDN.** `marca.fonte` vira **enum fechado**, empacotado no build.
3. **Script inline sem nonce não roda.** Com `'strict-dynamic'`, o `'self'` é ignorado — o
   script anti-flash do `next-themes` precisa receber o nonce ou o tema escuro pisca branco
   a cada carga, **e só em produção**.

> ⚠️ **Não acrescentar nonce à diretiva `style-src`.** Pela especificação de CSP, a presença
> de nonce ou hash **invalida `'unsafe-inline'`** — e todo atributo `style=` do sistema
> morreria junto, a começar pelas cores das etapas no kanban. A política fica exatamente
> como está: esta spec **não altera o CSP**.

## 4. Arquitetura ✅

```
src/lib/tema/
  cor.ts       hex ⇄ oklch, contraste WCAG, giro de matiz   (matemática pura)
  paleta.ts    { corPrimaria } → tokens de claro e escuro
  fontes.ts    enum fechado → next/font
  index.ts     derivarTema(marca) → string de CSS
```

`src/lib/` e não `src/core/`, seguindo a convenção do projeto: `core/` é domínio (leads,
tarefas, usuários), `lib/` é utilidade (`dinheiro.ts`, `date.ts`, `module-gate.ts`). Sendo
função pura, testa sem banco, sem React e sem `server-only`.

### 4.1 Como o CSS chega na página ✅

Uma tag `<style>` emitida pelo **layout raiz** — ele cobre `/login` e o painel, e como
`config/client` é importação estática, o layout **continua síncrono**.

**Não é atributo `style` no `<html>`**: atributo carrega um único conjunto de valores, e
precisamos de claro **e** escuro no mesmo documento. Atributo tornaria o modo escuro
impossível.

**A especificidade é dobrada de propósito:**

```css
:root:root      { --primary: …; --background: …; }
:root:root.dark { --primary: …; --background: …; }
```

`:root:root` casa exatamente o mesmo elemento que `:root`, mas com especificidade (0,2,0)
contra (0,1,0). Isso torna a vitória sobre os valores de `globals.css` **independente da
ordem de inserção** — que não controlamos, porque o Next decide onde põe o bundle de CSS.
`globals.css` fica intacto e passa a ser o fallback: se a injeção falhar, o sistema mostra
o cinza padrão em vez de ficar sem cor.

## 5. Derivação da paleta ✅

Entrada: **um** hex. Saída: ~30 tokens em dois temas.

### 5.1 Validação da entrada

| Regra | Ação |
|---|---|
| Formato `#RRGGBB` | falha o build |
| Croma OKLCH **< 0.04** | falha o build |
| Luminosidade em qualquer valor | **aceita e ajusta** |

O piso de croma existe porque abaixo dele as superfícies derivadas (`accent`, `muted`,
`border`) ficam indistinguíveis de cinza neutro — a premissa do white-label colapsa em
silêncio, e o cliente conclui que o sistema ignorou a marca dele. Falhar alto é melhor.

**Luminosidade não recusa.** Uma marca azul-marinho escura é perfeitamente utilizável;
recusá-la seria o sistema sendo burro. A identidade é o **matiz e o croma**; a luminosidade
é negociável e o algoritmo a negocia.

### 5.2 O ajuste de luminosidade da primária

```
1. Converte a marca para OKLCH → (L, C, H)
2. Calcula contraste WCAG de branco e de preto contra a cor
3. Escolhe o vencedor como --primary-foreground
4. Enquanto contraste < 4.5:1 e couberem iterações:
     move L em 0.02 na direção que aumenta o contraste
5. --primary = oklch(L_ajustado, C, H)
```

Termina sempre: o contraste é monotônico em cada direção de `L`, e nos extremos (`L=0` com
branco, `L=1` com preto) chega a 21:1. Limite de 40 iterações como rede de segurança, com
erro explícito se estourar — um limite silencioso esconderia um bug de conversão.

O limiar é **4.5:1** e não 3:1: rótulo de botão é texto normal (14–16px). O relaxamento de
3:1 só vale para texto grande (≥24px, ou ≥18.66px em negrito), que não é o caso aqui.

### 5.3 Os tokens

`C` é o croma da marca, `H` o matiz. Valores de partida — a **restrição vinculante é o
invariante da § 9**, não estes números.

**Claro**

| Token | L | C |
|---|---|---|
| `--background`, `--card`, `--popover` | 1.00 | **0** |
| `--foreground` | 0.15 | `min(C×0.04, 0.008)` |
| `--primary` | ajustado (§ 5.2) | **C** (cheio) |
| `--primary-foreground` | calculado (§ 5.2) | 0 |
| `--ring` | = `--primary` | |
| `--secondary`, `--muted` | 0.97 | `min(C×0.03, 0.006)` |
| `--muted-foreground` | 0.55 | `min(C×0.05, 0.010)` |
| `--accent` | 0.95 | `min(C×0.06, 0.012)` |
| `--border`, `--input` | 0.92 | `min(C×0.04, 0.008)` |
| `--sidebar` | 0.985 | `min(C×0.03, 0.006)` |
| `--sidebar-accent` | 0.95 | `min(C×0.05, 0.010)` |
| `--destructive` | 0.58 | **0.22** (H 27) |

**Escuro** — tabela própria, **não** espelhamento de `L`. Espelhar 0.99 em torno de 0.5
daria fundo 0.01, ou seja, preto absoluto: superfícies deixam de se distinguir umas das
outras e o contorno some.

| Token | L | C |
|---|---|---|
| `--background`, `--sidebar` | 0.13 | **0** |
| `--card`, `--popover` | 0.16 | `min(C×0.03, 0.006)` |
| `--foreground` | 0.97 | `min(C×0.03, 0.006)` |
| `--secondary`, `--muted` | 0.22 | `min(C×0.04, 0.008)` |
| `--muted-foreground` | 0.70 | `min(C×0.04, 0.008)` |
| `--accent`, `--sidebar-accent` | 0.26 | `min(C×0.06, 0.012)` |
| `--border`, `--input` | 0.28 | `min(C×0.05, 0.010)` |
| `--destructive` | 0.62 | **0.20** (H 27) |

O tema **escuro é o principal** — é o da referência. Barra e conteúdo compartilham o mesmo
fundo (`L 0.13`), e a separação entre eles vem da régua, não de dois tons.

`--primary` roda **o mesmo laço da § 5.2 outra vez**, agora contra o fundo escuro — não
reaproveita o resultado do tema claro. Na prática ela sai mais clara, porque acento escuro
sobre fundo escuro desaparece.

**Gráficos:** `chart-1..5` = `H`, `H±40°`, `H±80°`, com **L e C constantes** —
`L = 0.65` (claro) / `0.70` (escuro), `C = clamp(C_marca, 0.10, 0.16)`.

Duas defesas:

- **L e C constantes é a razão de existir o OKLCH aqui.** Girar matiz em OKLCH preserva a
  luminosidade percebida, então nenhuma série parece mais importante que outra. Em HSL não
  seria assim: amarelo e azul com o mesmo "lightness" têm brilhos muito diferentes na tela.
- **O piso de croma dos gráficos** (0.10) impede que uma marca de croma baixo produza cinco
  séries indistinguíveis entre si.

> Cor nunca é o único código de uma série. Onde houver gráfico, rótulo ou legenda textual
> acompanha — matiz sozinho falha para daltônicos, e cinco matizes num arco de 160° falham
> mais.

### 5.4 Onde a marca aparece, e onde não ✅

*(Reescrita depois da referência da § 2.1.)*

**A marca vive na ação, não na superfície.** Ela aparece com força em três lugares —
`--primary` (botão, link), `--ring` (foco) e os cinco tokens de gráfico. Fundo, cartão,
barra lateral e borda ficam praticamente neutros.

**O sussurro de croma nas superfícies não é meio-termo covarde.** Os tetos absolutos
(`0.006` a `0.012`) estão abaixo do limiar em que o olho nomeia uma cor, mas acima do
limiar em que ele percebe **temperatura**. Numa tela inteira, uma marca fria e uma marca
quente produzem ambientes distintos sem que nada pareça colorido — que é exatamente o
efeito da referência. Croma zero em tudo entregaria o mesmo cinza para todo cliente, e a
premissa do white-label morreria de um jeito difícil de perceber e fácil de justificar.

**Por que `--destructive` é fixo:** num cliente de marca vermelha, derivar destruição da
marca deixaria "Excluir" visualmente idêntico a "Salvar". É segurança de interface, não
preferência — e a contenção da referência torna isso **mais** importante, porque num
ambiente quase sem cor o vermelho é praticamente o único sinal de perigo que sobra.

## 6. Fonte e logo ✅

### 6.1 Fonte ✅

**`Geist` é o padrão** — é a fonte da referência (§ 2.1) e **já é a que `layout.tsx`
carrega**. O trabalho aqui é ligar o valor do config à variável CSS, não trocar de
tipografia.

`marca.fonte` vira `z.enum(["Geist", "Inter", "Manrope", "IBM Plex Sans"])` 🟡 — a lista é
ajustável, o mecanismo não. Fork que escreva um nome fora dela falha no build.

Todas as fontes da lista entram no bundle e só a escolhida é aplicada via variável CSS.
Para quatro fontes isso é irrelevante e evita um passo de geração de código. Se a lista
crescer muito, aí vale reconsiderar.

`--font-mono` continua Geist Mono, sem entrar no config: nenhuma tela mostra código, e o
único uso é herdado do `create-next-app`.

### 6.2 Logo — adiado ✅

**`marca.logo` passa a ser opcional** (`z.string().optional()`), e nenhum arquivo de logo
entra agora.

Componente `<Marca>`, com dois caminhos:

- **Com logo:** `<img src={client.marca.logo} alt={client.nome}>`. Sem `next/image` (SVG
  não se beneficia do otimizador) e sem `onError` (exigiria componente de cliente).
- **Sem logo (o caso de hoje):** renderiza `client.nome` como texto, na fonte da marca,
  com peso semibold — não é remendo, é o estado normal enquanto não houver arquivo.

O caminho de texto é o mesmo que o navegador já usaria com `alt` de imagem quebrada, então
acrescentar o SVG depois não muda mais nada além de trocar o `undefined` por um caminho.

## 7. Shell do painel ✅

### 7.1 Estrutura

```
┌──────────────┬────────────────────────────┐
│ ▧ Marca      │                            │
│              │                            │
│ ▤ Dashboard  │                            │
│ ◎ Leads      │                            │
│ ▥ Funil      │        conteúdo            │
│ ⚇ Contatos   │                            │
│ ☑ Tarefas    │                            │
│ ──────────── │                            │
│ ▭ Conversas  │                            │
│ ⚙ Equipe     │                            │
│              │                            │
│ ⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯ │                            │
│ ◍ Rodrigo    │                            │
│   ☾  🔔  ⇥   │                            │
└──────────────┴────────────────────────────┘
```

| Largura | Comportamento |
|---|---|
| ≥ 1024px | coluna lateral fixa de **248px** 🟡, **sem barra superior** |
| < 1024px | gaveta; barra superior fina com o botão, `<Marca>` e nada mais |

**Sem barra superior no desktop** é o que mais aproxima a tela da referência: usuário, tema,
sino e "Sair" descem para o rodapé da barra lateral, onde a referência os coloca.

**Grupos separados por régua, sem título.** É o que a referência faz, e evita o problema de
grupo de um item só. São dois:

1. Dashboard · Leads · Funil · Contatos · Tarefas
2. Conversas (módulo) · Equipe (papel)

> ⚠️ A régua **não renderiza quando o segundo grupo fica vazio** — módulo desligado num
> fork **e** usuário sem permissão de equipe. Separador pendurado sobre o nada é o defeito
> clássico desse padrão, e ele só aparece na combinação que ninguém testa.

**Ícones** de `lucide-react` (já é dependência), 16px, herdando `currentColor` — ícone com
cor própria brigaria com o estado ativo. Mapeamento 🟡: `LayoutDashboard`, `Target`,
`Columns3`, `Users`, `ListChecks`, `MessageSquare`, `UserCog`.

**Estado ativo:** preenchimento neutro (`--sidebar-accent`) com cantos arredondados, **mais
`aria-current="page"`**. O `aria-current` não é enfeite: sem ele o estado ativo é só cor, e
cor sozinha não chega a quem usa leitor de tela.

**Rodapé:** `ui/avatar.tsx` (já existe) · nome com `data-testid="usuario-logado"` ·
alternador de tema · sino · "Sair".

A gaveta usa `ui/sheet.tsx` do shadcn, que **precisa ser acrescentado** (hoje há `dialog`,
não há `sheet`). Radix cuida de foco preso e `Escape`.

> A gaveta **fecha ao navegar**. Sem isso, tocar num link deixa o painel aberto por cima da
> página nova — é o defeito mais comum de menu móvel e não aparece em teste de componente,
> só em uso.

**O sino tem um único ponto de montagem**, no rodapé da barra. No celular ele fica dentro da
gaveta, então o botão que abre a gaveta ganha **um ponto quando há não lida** — o aviso não
se perde atrás de um toque, e não existe um segundo `<NotificationBell>` para o e2e
confundir com o primeiro.

### 7.2 O que precisa sobreviver intacto

| O que | Por quê |
|---|---|
| `prefetch={false}` em todo `<Link>` | **correção de segurança**, não estilo — ver abaixo |
| `<form action={sairAction}>` | logout por GET é disparável por `<img src>` de qualquer site |
| `PainelNav` síncrona e sem Prisma | é o que a deixa testável sem mock de banco |
| `moduloAtivo` e `hasPermission` | os gates de menu |
| `data-testid="usuario-logado"` | o e2e depende |

> ⚠️ **O `prefetch={false}` é a armadilha desta spec.** O padrão do Next pré-carrega todo
> `<Link>` visível; como a nav aparece em toda página do painel, há requisições a rotas
> protegidas em voo o tempo todo. No logout, uma delas chega **depois** carregando o cookie
> recém-invalidado, e o Auth.js **reemite o cookie de sessão** — "Sair" deixa de revogar.
> Isso foi medido, não suposto: o e2e passou a falhar de forma intermitente a cada link
> novo. Uma reforma de navegação é exatamente o lugar onde alguém "limpa" essa prop.
> A § 9 trava isso com teste.

### 7.3 A divisão servidor/cliente

Estado ativo exige `usePathname()`, que é de cliente. Transformar a nav inteira em
componente de cliente arrastaria `config/client` para o navegador — incluindo número e
mensagem de WhatsApp. Não é segredo, mas é dado que não precisa sair do servidor.

```
painel-nav.tsx    servidor  — calcula os links, aplica os gates, monta a casca
nav-links.tsx     cliente   — recebe links: {href,label}[], pinta o ativo
```

`nav-links.tsx` **não importa `config/client`**. A propriedade de testabilidade de
`PainelNav` (síncrona, sem Prisma) fica de pé.

**Regra do ativo:** vence o `href` **mais longo** que casa com o caminho — exato, ou prefixo
seguido de `/`. Sem isso, `/leads` e `/leads/kanban` acendem os dois ao mesmo tempo no
kanban.

## 8. Modo escuro ✅

`ThemeProvider` do `next-themes` (já é dependência, já é esperado por `ui/sonner.tsx`) no
layout **do painel**, com `attribute="class"` — casando o `@custom-variant dark
(&:is(.dark *))` que `globals.css` já define.

**Dois temas, sem "sistema"** ✅:

```tsx
<ThemeProvider attribute="class" themes={["light", "dark"]}
               enableSystem={false} defaultTheme="dark" nonce={nonce}>
```

`enableSystem={false}` é o que torna o alternador um interruptor de dois estados em vez de
um menu de três. Com "sistema" no meio, o botão precisa de três ícones e de um rótulo para
explicar em qual estado está — custo de interface que só se paga quando alguém realmente
alterna com o horário do sistema operacional.

`defaultTheme="dark"` 🟡 segue a referência da § 2.1. Primeira visita cai no escuro; a
partir daí vale a escolha guardada.

**Por que no painel e não na raiz:** `(painel)/layout.tsx` já é `force-dynamic` e já é
`async`, então `await headers()` para ler o nonce não custa nada ali. Na raiz, tornaria
toda rota dinâmica para servir um recurso que só o painel usa.

O preço, dito claro: o script anti-flash entra logo depois de `<body>`, não no `<head>`.
Como não há conteúdo pintado antes dele, não há flash visível — mas é um degrau a menos de
margem do que montar na raiz. 🟡 Se aparecer piscada, mover para a raiz é uma linha.

`suppressHydrationWarning` vai no `<html>` do layout **raiz**, porque é lá que o elemento
é renderizado e é nele que a classe aparece depois.

Aproveitando o layout raiz: `lang="pt-BR"`, e `metadata` deixa de dizer "Create Next App".

## 9. Erros, e onde falham ✅

**Tudo falha no build, nada em produção.**

`config/client.ts` hoje só **declara** o tipo (`const client: ClientConfig = {…}`) — o schema
Zod existe e **nunca é executado**. Passa a ser:

```ts
export const client = clientConfigSchema.parse({ … });
```

Validação em escopo de módulo já quebrou o deploy deste projeto uma vez — o módulo
`whatsapp` validava variáveis de ambiente na importação, e `next build` fazia a validação
rodar sem elas na Vercel, derrubando o build inteiro. **Aqui é seguro pelo motivo oposto:**
os valores estão no arquivo versionado, não no ambiente. Não há como faltarem no build.
A distinção precisa ficar escrita, senão a lição anterior vira regra cega.

| Erro | Momento |
|---|---|
| Hex malformado ou acinzentado | build |
| Fonte fora do enum | build |
| Laço de contraste estourando 40 iterações | build, com mensagem |
| Logo ausente | runtime, degrada para o nome em texto |

## 10. Testes ✅

Regra do projeto: **todo teste novo é sabotado antes de aceito.**

| # | O que prova | Sabotagem que precisa quebrá-lo |
|---|---|---|
| 1 | **Para toda marca válida, `primary-foreground` atinge 4.5:1 sobre `primary`** | fixar o texto em branco |
| 2 | Conversão hex⇄oklch bate com valores de referência congelados | trocar a matriz de conversão |
| 3 | Croma < 0.04 falha o build | aceitar cinza |
| 4 | `chart-1..5` têm L e C iguais entre si | derivar L do matiz |
| 5 | `--destructive` não muda com a marca | derivá-lo da primária |
| 6 | **Todo `<Link>` da nav tem `prefetch={false}`** | remover a prop de um link |
| 7 | Ativo é o `href` mais longo que casa | usar `startsWith` simples |
| 8 | `PainelNav` renderiza sem mock de banco | tornar a função assíncrona |
| 9 | Link de Equipe some para VENDEDOR; link de módulo some com módulo desligado | remover os gates |
| 10 | **VENDEDOR com módulo desligado não renderiza a régua** | renderizar o separador sempre |
| 11 | Item ativo carrega `aria-current="page"` | marcar o ativo só por classe |

O **#1 é o invariante central** e se testa sobre uma grade, não sobre um caso:
`H` de 0 a 345 de 15 em 15, `C` de 0.04 a 0.37 de 0.03 em 0.03, `L` de 0.1 a 0.9 de 0.1 em
0.1 — ~2.600 combinações de matemática pura, rápidas. A sabotagem de fixar branco precisa
quebrar nos amarelos.

O **#6 é o que impede a regressão do logout.** É teste de componente, barato, e é a única
coisa que separa uma reforma de navegação de reabrir um defeito de sessão.

**e2e:** o alternador de tema persiste entre navegações; a gaveta fecha ao navegar; e
`auth.spec.ts` ("o botão Sair encerra a sessão de verdade") **continua verde** — é o
detector histórico desse defeito.

## 11. Fora desta spec, de propósito

Revisão tela a tela: as tabelas cruas de `/contatos` e da equipe, a atividade recente do
dashboard mostrando nome técnico de ação (`log.acao` direto da auditoria), tratamento
consistente de formulário. É a spec seguinte, e depende desta — tokens primeiro, telas
depois.

## 12. Em aberto

**Nada bloqueia o plano.** As três perguntas da primeira versão foram respondidas:

| Era | Resposta |
|---|---|
| Quais fontes na lista fechada | **Geist** é o padrão e já está carregada (§ 6.1) |
| Qual `logo.svg` padrão | **nenhum** — adiado, `marca.logo` vira opcional (§ 6.2) |
| Alternador de três ou dois estados | **dois**, sem "sistema" (§ 8) |

Sobram só ajustes marcados 🟡, todos de uma linha e decidíveis durante a execução:

- largura da barra (248px) e mapeamento de ícones (§ 7.1)
- `defaultTheme="dark"` (§ 8)
- as três fontes além da Geist na lista (§ 6.1)
