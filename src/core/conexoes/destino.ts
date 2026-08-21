/**
 * O destino de uma conexão de WhatsApp precisa ser um host PÚBLICO, por HTTPS.
 *
 * ## O achado
 *
 * Auditoria de 2026-08-21
 * (`docs/auditorias/2026-08-21-fase1-seguranca-branch-tenancy.md`, seção "Fora
 * da checklist"): `WhatsappConnection.dominio` era validado por
 * `/^https?:\/\/[^\s/]+/`. Aquilo aceita `http://localhost:8080` e
 * `http://169.254.169.254` — o endereço de metadados das nuvens, que numa
 * instância mal configurada devolve credencial de máquina.
 *
 * Exige ADMIN, então não é qualquer um. Mas ADMIN é o papel de quem administra
 * o CRM da PRÓPRIA empresa, não de quem opera a infraestrutura: num sistema
 * multiempresa, ele é um cliente. O que a regex permitia era esse cliente
 * apontar a conexão para dentro da rede do servidor e usar o CRM como proxy —
 * a requisição sai do backend, com o IP do backend, atravessando qualquer
 * firewall que confie na origem.
 *
 * É defeito do desenho do cofre (Ciclo 2a) e não estava previsto.
 *
 * ## Por que `new URL()` e não uma regex maior
 *
 * Porque a regex perde para a codificação, e não por pouco. Medido com o
 * parser do Node em 2026-08-21:
 *
 *     http://2130706433/   → hostname "127.0.0.1"
 *     http://0177.0.0.1/   → hostname "127.0.0.1"
 *     http://127.1/        → hostname "127.0.0.1"
 *     http://010.0.0.1/    → hostname "8.0.0.1"
 *     http://0/            → hostname "0.0.0.0"
 *     https://LOCALHOST./  → hostname "localhost."
 *
 * As quatro primeiras passariam por qualquer lista negra escrita sobre o TEXTO
 * da URL: não há a string "127.0.0.1" em lugar nenhum delas. O parser do
 * WHATWG normaliza decimal, octal e forma abreviada para o quádruplo pontilhado
 * ANTES de a checagem rodar — então a checagem é feita sobre `url.hostname`, e
 * é por isso que ela consegue ser curta.
 *
 * ## O QUE ISTO NÃO FECHA
 *
 * Escrito com precisão porque uma trava que mente é pior que trava nenhuma:
 *
 * - **Nome público que RESOLVE para endereço interno.** `evil.exemplo.com` com
 *   um registro `A 169.254.169.254` passa por tudo aqui: o host é público, tem
 *   ponto, não é literal de IP. Resolver o DNS na hora de salvar não fecha —
 *   fecha a janela de um segundo e deixa o *rebinding* aberto (o dono do
 *   domínio troca o registro DEPOIS de a validação passar, e a requisição de
 *   verdade vai para o novo endereço). Quem fecha isso de verdade é controle de
 *   SAÍDA na rede do servidor, ou um cliente HTTP que resolva o nome, confira
 *   o endereço e conecte NAQUELE endereço. Nenhum dos dois cabia nesta
 *   correção, e nenhum dos dois é substituído por uma checagem aqui.
 * - **Porta.** Qualquer porta é aceita. Restringir a 443 quebraria uma
 *   Evolution auto-hospedada em `:8443`, que é instalação comum e legítima — e
 *   não protege nada que a recusa de endereço interno já não proteja.
 * - **O que o servidor da Evolution faz com a requisição.** Isto valida o
 *   destino, não o comportamento dele.
 *
 * O redirecionamento — a fuga clássica, em que o host público responde `302`
 * para `169.254.169.254` — é fechado FORA daqui, no único `fetch` do adapter
 * (`modules/whatsapp/gateway/evolution.ts`), com `redirect: "error"`. Está
 * anotado lá e citado aqui porque a defesa só existe com as duas metades.
 */

/**
 * Sufixos de nome reservados para uso local. `localhost` é RFC 6761;
 * `.local` é mDNS (RFC 6762) e resolve na LAN; `.internal` e `.home.arpa` são
 * os nomes que nuvens e roteadores domésticos usam para a rede de dentro.
 *
 * O ponto na frente é o que faz `naolocal.com` não casar com `.local`.
 */
const SUFIXOS_LOCAIS = [".localhost", ".local", ".internal", ".home.arpa", ".lan"];

/** `192.168.0.1` → `[192,168,0,1]`, ou `null` se não for um quádruplo. */
function comoIpv4(host: string): number[] | null {
  const partes = host.split(".");
  if (partes.length !== 4) return null;

  const numeros = partes.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  if (numeros.some((n) => Number.isNaN(n) || n > 255)) return null;
  return numeros;
}

/**
 * `[::ffff:7f00:1]` → os 8 grupos de 16 bits, ou `null` se não for IPv6.
 *
 * O `hostname` de um IPv6 vem entre colchetes e já normalizado pelo parser —
 * minúsculo, comprimido com `::` e sem zeros à esquerda. Só o `::` precisa ser
 * expandido aqui.
 */
function comoIpv6(host: string): number[] | null {
  if (!host.startsWith("[") || !host.endsWith("]")) return null;
  const corpo = host.slice(1, -1);

  const [esquerda, direita, demais] = corpo.split("::");
  if (demais !== undefined) return null; // dois `::` é endereço inválido

  const parse = (t: string) => (t === "" ? [] : t.split(":").map((g) => parseInt(g, 16)));
  const inicio = parse(esquerda ?? "");
  const fim = direita === undefined ? [] : parse(direita);

  const grupos =
    direita === undefined
      ? inicio
      : [...inicio, ...Array(8 - inicio.length - fim.length).fill(0), ...fim];

  if (grupos.length !== 8 || grupos.some((g) => Number.isNaN(g) || g > 0xffff)) return null;
  return grupos;
}

/** Um quádruplo IPv4 que não deve ser alcançado a partir do servidor. */
function ipv4Interno([a, b]: number[]): boolean {
  const primeiro = a!;
  const segundo = b!;
  return (
    primeiro === 0 || // 0.0.0.0/8 — "este host"; `http://0/` chega aqui
    primeiro === 10 || // 10/8 privado
    primeiro === 127 || // 127/8 loopback
    (primeiro === 100 && segundo >= 64 && segundo <= 127) || // 100.64/10 CGNAT
    (primeiro === 169 && segundo === 254) || // 169.254/16 — inclui 169.254.169.254
    (primeiro === 172 && segundo >= 16 && segundo <= 31) || // 172.16/12 privado
    (primeiro === 192 && segundo === 168) || // 192.168/16 privado
    primeiro >= 224 // 224/4 multicast e 240/4 reservado, 255.255.255.255 junto
  );
}

/**
 * `true` quando o hostname JÁ NORMALIZADO aponta para a própria máquina ou
 * para a rede privada do servidor.
 *
 * Exportada porque é ela que os casos de teste exercitam família por família —
 * uma função interna testada só pela borda deixaria a lista de faixas sem
 * cobertura direta.
 */
export function ehEnderecoInterno(hostname: string): boolean {
  const ipv4 = comoIpv4(hostname);
  if (ipv4) return ipv4Interno(ipv4);

  const ipv6 = comoIpv6(hostname);
  if (ipv6) {
    // IPv4 mapeado (`::ffff:a.b.c.d`, que o parser comprime para
    // `::ffff:7f00:1`): é o caminho por onde 127.0.0.1 volta disfarçado de
    // IPv6. Os 80 primeiros bits zerados mais `ffff` são a assinatura.
    const mapeado = ipv6.slice(0, 5).every((g) => g === 0) && ipv6[5] === 0xffff;
    if (mapeado) {
      const alto = ipv6[6]!;
      const baixo = ipv6[7]!;
      return ipv4Interno([alto >> 8, alto & 0xff, baixo >> 8, baixo & 0xff]);
    }

    const todosZero = ipv6.every((g) => g === 0);
    const loopback = ipv6.slice(0, 7).every((g) => g === 0) && ipv6[7] === 1;
    const ula = (ipv6[0]! & 0xfe00) === 0xfc00; // fc00::/7
    const linkLocal = (ipv6[0]! & 0xffc0) === 0xfe80; // fe80::/10
    return todosZero || loopback || ula || linkLocal;
  }

  return false;
}

export type DestinoConferido = { ok: true; url: string } | { ok: false; motivo: string };

/**
 * Confere e normaliza o domínio de uma conexão.
 *
 * Devolve resultado em vez de lançar para não importar `ConexaoInvalidaError`
 * de `./service`, que importaria este arquivo de volta. Quem traduz para o
 * erro do domínio é `validarCampos`, lá.
 *
 * A barra final é aparada aqui, e não só no adapter: aparar na GRAVAÇÃO evita
 * que a tela mostre uma coisa e o gateway use outra — a razão já estava
 * escrita em `validarCampos` e continua valendo.
 */
export function conferirDestino(bruto: string): DestinoConferido {
  const texto = bruto.trim();

  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return {
      ok: false,
      motivo:
        `O domínio precisa ser uma URL completa, começando com https:// ` +
        `(recebido: ${JSON.stringify(texto)}).`,
    };
  }

  // ## Por que HTTPS é EXIGIDO, e não só recomendado
  //
  // O que viaja nessa conexão é a apikey da Evolution, num header, em toda
  // requisição. Por HTTP ela vai em texto claro por toda a rota.
  //
  // O precedente era mais frouxo e vale registrar: `EVOLUTION_DOMAIN`, que
  // morreu no Ciclo 2a, usava `z.string().url()` — aceitava `http://` sem
  // reclamar (ver `3e385dc`). Endurecer é decisão, não continuidade.
  //
  // O argumento que fecha: o único destino com desculpa para `http://` é uma
  // Evolution na rede interna, sem certificado. Esse destino ACABA DE SER
  // RECUSADO pelas regras abaixo. Sobram só hosts públicos — e mandar uma
  // credencial para um host público em texto claro não tem defesa.
  if (url.protocol !== "https:") {
    return {
      ok: false,
      motivo:
        `O domínio precisa usar https:// — a apikey da Evolution viaja em toda ` +
        `requisição e por http:// ela vai em texto claro (recebido: ${url.protocol}//).`,
    };
  }

  // `https://usuario:senha@host/` embute credencial na URL. Ela seria gravada
  // em claro na coluna `dominio` (que NÃO é o campo cifrado do cofre) e
  // apareceria na tela de conexões. Recusar é mais honesto que apagar em
  // silêncio um pedaço do que a pessoa digitou.
  if (url.username !== "" || url.password !== "") {
    return {
      ok: false,
      motivo: "O domínio não pode carregar usuário e senha embutidos na URL.",
    };
  }

  // Ponto final é sintaxe de FQDN absoluto e não muda o destino: `localhost.`
  // e `localhost` são o mesmo host. Sem esta linha, o ponto vira um contorno
  // de uma letra.
  const host = url.hostname.replace(/\.$/, "");

  if (ehEnderecoInterno(host)) {
    return {
      ok: false,
      motivo:
        `O domínio aponta para a rede interna do servidor (${host}). ` +
        `O CRM não pode ser usado para alcançar o que está atrás do firewall dele.`,
    };
  }

  // Nome sem ponto nenhum não é um domínio público: é `localhost`, ou um nome
  // curto que o servidor completa com o domínio de busca DELE — o que aponta,
  // por definição, para dentro da rede do servidor.
  //
  // Literal de IPv6 fica de FORA desta regra, e o caso que obrigou a escrever
  // isto: `https://[2001:4860:4860::8888]` (DNS público do Google) não tem
  // ponto nenhum no hostname e era recusado como "nome de rede local". Um
  // endereço já foi julgado por `ehEnderecoInterno` logo acima — se chegou
  // aqui, é público, e a regra de NOME não tem o que dizer sobre ele. IPv4
  // literal não precisa da ressalva porque tem pontos.
  const ehLiteralIpv6 = host.startsWith("[");
  if ((!host.includes(".") && !ehLiteralIpv6) || SUFIXOS_LOCAIS.some((s) => host.endsWith(s))) {
    return {
      ok: false,
      motivo:
        `"${host}" é um nome de rede local, não um domínio público. ` +
        `O CRM não pode ser usado para alcançar o que está atrás do firewall dele.`,
    };
  }

  return { ok: true, url: texto.replace(/\/$/, "") };
}
