/**
 * IP de origem de uma requisição, para usar como CHAVE de rate limit.
 *
 * Extraído de `src/app/api/whatsapp/evolution/[token]/route.ts`, onde nasceu
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
