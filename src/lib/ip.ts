/**
 * IP de origem de uma requisição, para usar como CHAVE de rate limit.
 *
 * Extraído de `src/app/api/whatsapp/evolution/[companyId]/[token]/route.ts`,
 * onde nasceu
 * (fix round 1/5, achado MENOR do revisor da Fatia 1). Virou módulo
 * compartilhado ao ganhar o segundo chamador (o rate limit de login) — a
 * ordem de precedência abaixo é uma decisão de segurança, e mantê-la em dois
 * lugares garantiria que um dia alguém corrigisse só uma das cópias.
 *
 * `x-forwarded-for` é um header fornecido pelo CLIENTE (qualquer requisição
 * pode mandar o seu próprio), então confiar nele para a chave do rate limit
 * deixa quem manda a requisição escolher sua própria chave — na prática, um
 * jeito trivial de contornar o limite (mandar um `x-forwarded-for` diferente
 * a cada requisição). `x-vercel-forwarded-for` é o header que a PRÓPRIA
 * Vercel define na borda com o IP real do cliente — não pode ser forjado por
 * quem faz a requisição (a plataforma sobrescreve, não concatena, o que vier
 * de fora com esse nome). `x-real-ip` como fallback (outros proxies reversos
 * usam esse nome) e `x-forwarded-for` só como último recurso — nesse último
 * caso a chave ainda pode ser manipulada, mas é estritamente melhor que
 * assumir sempre o header não confiável primeiro.
 *
 * Em desenvolvimento local nenhum dos três costuma existir; o retorno é
 * `"desconhecido"` e todas as requisições compartilham a mesma chave. É o
 * comportamento certo: sem borda na frente, não há IP em que confiar.
 */
export function obterIpDaRequisicao(request: Request): string {
  const vercelIp = request.headers.get("x-vercel-forwarded-for");
  if (vercelIp) return vercelIp.split(",")[0]!.trim();

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  const encaminhado = request.headers.get("x-forwarded-for");
  return encaminhado?.split(",")[0]?.trim() ?? "desconhecido";
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
 * `undefined` e não `"desconhecido"`: a coluna é anulável, e uma string de
 * sentinela gravada 22 vezes ficaria indistinguível de um IP que a borda não
 * mandou. Aqui o valor ausente precisa ser ausente.
 */
export async function ipDaRequisicaoAtual(): Promise<string | undefined> {
  try {
    const { headers } = await import("next/headers");
    const cabecalhos = await headers();

    // Mesma ordem de precedência de `obterIpDaRequisicao`, e pelo mesmo
    // motivo: `x-forwarded-for` é escolhido pelo cliente. Manter as duas
    // ordens iguais é o que impede que um dia alguém corrija só uma.
    const vercelIp = cabecalhos.get("x-vercel-forwarded-for");
    if (vercelIp) return vercelIp.split(",")[0]!.trim();

    const realIp = cabecalhos.get("x-real-ip");
    if (realIp) return realIp.trim();

    const encaminhado = cabecalhos.get("x-forwarded-for");
    return encaminhado?.split(",")[0]?.trim() || undefined;
  } catch {
    return undefined;
  }
}
