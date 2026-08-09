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

| Token | L | C | H |
|---|---|---|---|
| `--background` | 0.99 | `min(C×0.03, 0.006)` | H |
| `--foreground` | 0.15 | `min(C×0.10, 0.02)` | H |
| `--card`, `--popover` | 1.00 | 0 | — |
| `--primary` | ajustado (§ 5.2) | C | H |
| `--primary-foreground` | calculado (§ 5.2) | 0 | — |
| `--secondary`, `--muted` | 0.96 | `C×0.05` | H |
| `--muted-foreground` | 0.55 | `C×0.10` | H |
| `--accent` | 0.94 | `C×0.15` | H |
| `--border`, `--input` | 0.90 | `C×0.08` | H |
| `--ring` | = `--primary` | | |
| `--sidebar` | 0.97 | `C×0.06` | H |
| `--sidebar-accent` | 0.93 | `C×0.14` | H |
| `--destructive` | 0.58 | **0.22** | **27** |

**Escuro** — tabela própria, **não** espelhamento de `L`. Espelhar 0.99 em torno de 0.5
daria fundo 0.01, ou seja, preto absoluto: superfícies deixam de se distinguir umas das
outras e o contorno some.

| Token | L | C |
|---|---|---|
| `--background` | 0.15 | `min(C×0.03, 0.008)` |
| `--foreground` | 0.97 | `min(C×0.06, 0.015)` |
| `--card`, `--popover` | 0.19 | `C×0.03` |
| `--secondary`, `--muted` | 0.25 | `C×0.06` |
| `--muted-foreground` | 0.68 | `C×0.08` |
| `--accent` | 0.29 | `C×0.14` |
| `--border`, `--input` | 0.31 | `C×0.08` |
| `--sidebar` | 0.17 | `C×0.05` |
| `--sidebar-accent` | 0.27 | `C×0.13` |
| `--destructive` | 0.62 | **0.20** (H 27) |

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

### 5.4 Croma baixo nas superfícies, e o vermelho fora ✅

**Por que `secondary`, `muted`, `border` e `background` recebem croma:** é o que separa
white-label de verdade de "trocamos a cor do botão". Fundo, cartão e hover ficam levemente
tingidos, e a ferramenta inteira parece do cliente.

**Por que `--destructive` é fixo:** num cliente de marca vermelha, derivar destruição da
marca deixaria "Excluir" visualmente idêntico a "Salvar". É segurança de interface, não
preferência.

## 6. Fonte e logo ✅

### 6.1 Fonte

`marca.fonte` vira `z.enum(["Inter", "Geist", "Manrope", "IBM Plex Sans"])` 🟡 — a lista é
ajustável, o mecanismo não. Fork que escreva um nome fora dela falha no build.

Todas as fontes da lista entram no bundle e só a escolhida é aplicada via variável CSS.
Para quatro fontes isso é irrelevante e evita um passo de geração de código. Se a lista
crescer muito, aí vale reconsiderar.

### 6.2 Logo

`public/logo.svg` passa a existir — hoje o caminho declarado aponta para o vazio.

Componente `<Marca>`: `<img src={client.marca.logo} alt={client.nome}>`. Sem
`next/image` (SVG não se beneficia do otimizador) e sem `onError` (exigiria componente de
cliente). **Fork sem logo mostra o nome do cliente como texto**, porque é o que o navegador
faz com `alt` de imagem quebrada — degradação de graça.

## 7. Shell do painel ✅

### 7.1 Estrutura

| Largura | Comportamento |
|---|---|
| ≥ 1024px | coluna lateral fixa de 240px |
| < 1024px | gaveta, aberta por botão no cabeçalho |

Cabeçalho carrega `<Marca>`, o sino, o nome do usuário, o alternador de tema e "Sair".

A gaveta usa `ui/sheet.tsx` do shadcn, que **precisa ser acrescentado** (hoje há `dialog`,
não há `sheet`). Radix cuida de foco preso e `Escape`.

> A gaveta **fecha ao navegar**. Sem isso, tocar num link deixa o painel aberto por cima da
> página nova — é o defeito mais comum de menu móvel e não aparece em teste de componente,
> só em uso.

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

## 12. Em aberto ❓

| # | Assunto |
|---|---|
| 1 | Quais fontes entram na lista fechada (§ 6.1) |
| 2 | O `logo.svg` padrão é a marca da Nateksoft ou um genérico neutro |
| 3 | O alternador de tema é claro/escuro/sistema, ou só claro/escuro |
