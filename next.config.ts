import type { NextConfig } from "next";
import path from "path";

/**
 * Headers de segurança que valem para TODA resposta, inclusive rotas de API.
 *
 * O `Content-Security-Policy` NÃO está aqui de propósito: ele carrega um
 * nonce diferente por requisição e por isso mora em `src/proxy.ts`. Definir
 * um CSP fixo aqui também faria o navegador receber DOIS headers CSP nas
 * páginas, e nesse caso ele aplica a interseção das duas políticas — o
 * resultado fica mais restritivo que qualquer uma das duas isoladamente, e
 * quebra de um jeito difícil de diagnosticar.
 */
const headersDeSeguranca = [
  {
    // Impede o navegador de "adivinhar" o tipo de um arquivo pelo conteúdo
    // quando o Content-Type declarado não bate. Sem isto, um arquivo enviado
    // por usuário e servido como `text/plain` pode ser reinterpretado como
    // HTML e executar script na nossa origem.
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    // Clickjacking: impede que o CRM seja carregado dentro de um iframe em
    // outro site, onde um atacante sobrepõe uma tela falsa e captura os
    // cliques de quem está logado. O `frame-ancestors 'none'` do CSP faz o
    // mesmo e é o mecanismo moderno; este header continua aqui para
    // navegadores e scanners que ainda olham para ele.
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    // Sem isto, ao clicar num link externo o navegador manda a URL COMPLETA
    // da página atual no Referer — e URLs do CRM carregam id de lead, de
    // conversa, etc. Com `strict-origin-when-cross-origin` sai só a origem
    // para destinos externos, e nada quando cai de HTTPS para HTTP.
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    // Desliga APIs de hardware e pagamento que este CRM não usa. Se um dia
    // algo for injetado numa página, não consegue ligar câmera/microfone nem
    // pedir localização.
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=()",
  },
  {
    // HSTS: depois da primeira visita, o navegador se recusa a falar HTTP
    // com este domínio — mata o ataque de downgrade em rede hostil (wi-fi de
    // aeroporto) antes do primeiro redirect acontecer.
    //
    // DECISÃO: sem `includeSubDomains` e sem `preload`, de propósito.
    // `includeSubDomains` obrigaria HTTPS em TODO subdomínio do domínio
    // final — inclusive algum que ainda não tenha certificado (a Fase 2
    // prevê um site institucional). É a postura mais forte e vale ativar,
    // mas só depois de conferir que todo subdomínio serve HTTPS: ativar
    // antes derruba o subdomínio esquecido, e o navegador LEMBRA dessa
    // instrução por dois anos. `preload` é ainda mais difícil de desfazer
    // (depende de sair de uma lista embutida nos navegadores).
    key: "Strict-Transport-Security",
    value: "max-age=63072000",
  },
];

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },

  /**
   * Voltar para uma aba visitada há pouco não paga viagem nenhuma.
   *
   * O padrão do `dynamic` é 0 desde o Next 15 (antes era 30), ou seja: hoje
   * TODA volta para uma aba já vista refaz a página inteira no servidor. Como
   * o painel é `force-dynamic` e o Postgres está em `sa-east-1`, cada uma
   * dessas voltas custa a rodada de consultas medida na Tarefa 0 — 85 ms de
   * mediana por consulta, 6 consultas em `/leads`.
   *
   * ## O que fica velho, e o que não fica
   *
   * As próprias ações de quem está usando NUNCA ficam velhas: toda action
   * chama `revalidatePath` e os formulários chamam `router.refresh()`, e as
   * duas coisas limpam este cache. A janela de 30 s só alcança mudança feita
   * por OUTRA pessoa — numa revenda pequena, alguém cadastrar um lead e o
   * colega demorar meio minuto para vê-lo é troca que o dono aceitou
   * explicitamente ao aprovar o plano.
   *
   * `static` fica no padrão de propósito: não há rota estática sob sessão
   * neste app, e mexer nele mudaria o comportamento de `/login` sem motivo.
   *
   * ## A trava que isto exige
   *
   * Cache de cliente é exatamente o tipo de mecanismo que pode ressuscitar,
   * por outro caminho, o defeito de logout que este projeto já teve (ver
   * AGENTS.md). Por isso `tests/e2e/sessao-e-cache.spec.ts` prova que depois
   * de "Sair" o botão voltar do navegador não mostra dado real do painel.
   * Se aquele arquivo for apagado, esta linha aqui deixa de ter guarda.
   */
  experimental: {
    staleTimes: { dynamic: 30 },
  },

  // Remove o `X-Powered-By: Next.js`. Não é vulnerabilidade por si — dá para
  // descobrir o framework de outros jeitos — mas anunciar a stack é entregar
  // de graça a lista de CVEs que vale a pena tentar.
  poweredByHeader: false,

  async headers() {
    return [{ source: "/:path*", headers: headersDeSeguranca }];
  },
};

export default nextConfig;
