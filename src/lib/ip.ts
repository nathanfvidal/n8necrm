/**
 * IP de origem de uma requisição — quando existe uma borda em que confiar.
 *
 * Nasceu em `src/app/api/whatsapp/evolution/[companyId]/[token]/route.ts`
 * (fix round 1/5, achado MENOR do revisor da Fatia 1) e virou módulo
 * compartilhado ao ganhar o segundo chamador (o rate limit de login): a regra
 * abaixo é uma decisão de segurança, e mantê-la em dois lugares garantiria que
 * um dia alguém corrigisse só uma das cópias.
 *
 * ## O que quebrou no Ciclo 2d, e por que a resposta é uma variável
 *
 * Até aqui a ordem era `x-vercel-forwarded-for`, `x-real-ip`,
 * `x-forwarded-for`, e o primeiro era o único não forjável — por uma
 * propriedade da PLATAFORMA: ela SOBRESCREVIA, não concatenava, o que viesse de
 * fora com aquele nome. A decisão nº 6 (`CLAUDE.md`) foi reaberta e a Vercel
 * saiu do código (`be37342`), então esse cabeçalho some.
 *
 * O que sobra é escolhido pelo CLIENTE quando não há um proxy confiável na
 * frente reescrevendo. Manter a mesma precedência fora da Vercel seria trocar
 * um cabeçalho não forjável por um forjável **sem mudar uma linha de
 * comentário**: o pior desfecho possível, porque o código continuaria afirmando
 * uma garantia que perdeu — e a chave do rate limit passaria a ser ESCOLHIDA
 * por quem faz a requisição, no login e no webhook.
 *
 * Então: **nenhum cabeçalho é confiável até alguém dizer qual é.**
 * `IP_CABECALHO_CONFIAVEL` nomeia o cabeçalho que a borda escolhida
 * SOBRESCREVE. Exemplos que valem: `x-vercel-forwarded-for` na Vercel,
 * `x-real-ip` atrás de nginx com `proxy_set_header X-Real-IP $remote_addr`,
 * `cf-connecting-ip` atrás da Cloudflare.
 *
 * **O aviso que anda junto:** o cabeçalho precisa ser um que a borda
 * SOBRESCREVA, não um que ela ACRESCENTE. `x-forwarded-for` atrás de um nginx
 * com `proxy_add_x_forwarded_for` continua tendo o valor que o cliente mandou
 * na primeira posição — apontar a variável para ele é escolher a aparência de
 * segurança em vez dela.
 *
 * ## Ausente é o estado seguro, e o que ele custa
 *
 * Sem a variável, não existe IP: `IP_DESCONHECIDO` aqui, `undefined` em
 * `ipDaRequisicaoAtual`. Isso custa três coisas, e as três estão escritas onde
 * doem:
 *
 * - `core/rate-limit/login.ts` PULA a dimensão por IP. Colapsar todo mundo numa
 *   chave só transformaria a defesa contra força bruta em negação de serviço
 *   global — o IP é checado PRIMEIRO ali, então 20 tentativas erradas de um
 *   atacante trancariam o login de todos por 10 minutos.
 * - O webhook da Evolution cai para uma chave por EMPRESA
 *   (`app/api/whatsapp/evolution/[companyId]/[token]/route.ts`), pelo mesmo
 *   motivo: um balde único derrubaria mensagens legítimas de todas as empresas
 *   juntas.
 * - `AuditLog.ip` volta a ser nulo. A canalização que a Fase 2 da auditoria de
 *   2026-08-21 construiu — levar o `ip` aos 22 pontos que não o tinham — fica
 *   inteira; o que desaparece é um valor em que se possa confiar. E IP forjado
 *   num log de auditoria é pior que campo vazio: vazio é ausência de
 *   informação, forjado é informação falsa que pode apontar para a pessoa
 *   errada.
 *
 * Uma linha no ambiente devolve as três.
 *
 * ## Leitura preguiçosa
 *
 * `process.env` é lido DENTRO da função, nunca em escopo de módulo. Validar
 * ambiente no topo do arquivo já derrubou o build deste projeto uma vez
 * (armadilha registrada no `CLAUDE.md`): `next build` avalia todo módulo
 * alcançável, sem as variáveis de execução em mãos.
 */

/**
 * Sentinela de "não há borda em que confiar" — um valor só, em um lugar só.
 *
 * É constante exportada, e não literal repetido, porque ela é o CONTRATO entre
 * este módulo e quem degrada por causa dela (`core/rate-limit/login.ts`,
 * `core/audit/log.ts`, a rota do webhook). Renomear o valor de um lado sem o
 * outro reativaria o balde único sem erro nenhum de tipo.
 */
export const IP_DESCONHECIDO = "desconhecido";

/**
 * O nome do cabeçalho que a borda sobrescreve, ou `null` quando não há borda.
 *
 * `toLowerCase()` porque nome de cabeçalho HTTP é insensível a caixa (RFC 9110
 * §5.1) e `Headers.get` já normaliza o lado dele; `trim()` porque a variável é
 * digitada por uma pessoa num painel de hospedagem, e um espaço colado junto
 * silenciaria o IP inteiro sem deixar rastro — o estado sem IP é, por desenho,
 * um estado válido, então ele não reclamaria.
 */
function nomeDoCabecalhoConfiavel(): string | null {
  const nome = process.env.IP_CABECALHO_CONFIAVEL?.trim().toLowerCase();
  return nome ? nome : null;
}

/**
 * O primeiro item de uma lista `a, b, c` — o cliente, numa cadeia de proxies.
 *
 * Vale mesmo para o cabeçalho confiável: uma borda que sobrescreve pode ainda
 * assim mandar a cadeia inteira que ela observou, e o que interessa como chave
 * é a ponta de origem.
 */
function primeiroDaLista(valor: string | null): string | null {
  const primeiro = valor?.split(",")[0]?.trim();
  return primeiro ? primeiro : null;
}

/**
 * IP de uma `Request` em mãos — route handler, e o `Request` que o @auth/core
 * reconstrói no callback de credenciais.
 *
 * Devolve `IP_DESCONHECIDO` (nunca `undefined`) porque os dois chamadores o
 * usam como CHAVE de rate limit, e chave é `string`. Quem precisa distinguir
 * "sem borda" de um IP de verdade compara com a sentinela — é o que
 * `checarLimiteLogin` e a rota do webhook fazem.
 */
export function obterIpDaRequisicao(request: Request): string {
  const nome = nomeDoCabecalhoConfiavel();
  if (!nome) return IP_DESCONHECIDO;
  return primeiroDaLista(request.headers.get(nome)) ?? IP_DESCONHECIDO;
}

/**
 * O IP da requisição EM CURSO, quando não há um `Request` em mãos.
 *
 * ## Por que isto precisa existir
 *
 * A auditoria de 2026-08-21
 * (`docs/auditorias/2026-08-21-fase1-seguranca-branch-tenancy.md`, item 39)
 * mediu que **`AuditLog.ip` era preenchido em 1 dos 23 pontos** que gravam
 * auditoria — só `app/(painel)/export/leads/route.ts`, que é route handler e
 * portanto tem o `Request` na mão. Os outros 22 nascem em Server Action, e
 * **Server Action não recebe `Request` nenhum**: é essa a razão do buraco, não
 * esquecimento ponto a ponto.
 *
 * `headers()` de `next/headers` é a única porta que o Next oferece para o IP
 * dentro de uma Server Action (`node_modules/next/dist/docs/01-app/03-api-reference/
 * 04-functions/headers.md`). Ou seja: alguém tem que chamá-la. A escolha aqui
 * é chamá-la UMA vez, no funil de auditoria (`core/audit/log.ts`), em vez de
 * 22 vezes espalhadas — o mesmo argumento que fez `obterIpDaRequisicao` virar
 * módulo compartilhado quando ganhou o segundo chamador.
 *
 * ## A regra é a MESMA da função acima
 *
 * Só o cabeçalho nomeado por `IP_CABECALHO_CONFIAVEL`, sem fallback. As duas
 * funções precisam seguir a mesma regra pelo motivo de sempre: senão um dia
 * alguém corrige só uma. A checagem da variável vem ANTES do `import` dinâmico
 * — sem borda não há o que ler, e nem vale pagar a viagem até `headers()`.
 *
 * ## O que isto NÃO é
 *
 * Não é escopo por estado ambiente. `companyId` continua viajando como
 * PARÂMETRO EXPLÍCITO em todo lugar, e nada aqui muda isso — a proibição de
 * `AsyncLocalStorage` neste projeto é sobre QUAL EMPRESA, que é decisão de
 * autorização. `ip` é metadado de observabilidade: se ele vier errado ou
 * vazio, ninguém ganha acesso a nada. A precedência continua sendo do
 * chamador — quem passa `ip` explicitamente (o caminho da exportação, e o do
 * login, que tem o `Request` do @auth/core) nunca cai aqui.
 *
 * ## Por que import dinâmico e por que engolir a falha
 *
 * `headers()` **lança** fora de um escopo de requisição — job de fila, seed,
 * script, e o Vitest. Auditoria que derruba a operação que ela deveria apenas
 * registrar é pior que auditoria sem IP, então os dois casos viram
 * `undefined`. O import é dinâmico pelo motivo já registrado no topo de
 * `core/auth/credenciais.ts`: módulo de `next/*` fora do pipeline de build do
 * Next quebra na IMPORTAÇÃO, o que tornaria intestável todo arquivo que
 * dependesse deste — em cadeia.
 *
 * `undefined` e não `IP_DESCONHECIDO`: a coluna é anulável, e uma string de
 * sentinela gravada 22 vezes ficaria indistinguível de um IP que a borda não
 * mandou. Aqui o valor ausente precisa ser ausente.
 */
export async function ipDaRequisicaoAtual(): Promise<string | undefined> {
  const nome = nomeDoCabecalhoConfiavel();
  if (!nome) return undefined;

  try {
    const { headers } = await import("next/headers");
    const cabecalhos = await headers();
    return primeiroDaLista(cabecalhos.get(nome)) ?? undefined;
  } catch {
    return undefined;
  }
}
