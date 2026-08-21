// SSRF em `WhatsappConnection.dominio` — a recusa, e a metade que impede a
// recusa de virar um "não passa nada".
//
// ## O achado
//
// Auditoria de 2026-08-21, seção "Fora da checklist": o domínio era validado
// por `/^https?:\/\/[^\s/]+/`, que aceita `http://localhost` e
// `http://169.254.169.254` (metadados de nuvem). Exige ADMIN — e ADMIN, num
// sistema multiempresa, é um CLIENTE, não quem opera a infraestrutura. O que a
// regex permitia era esse cliente apontar a conexão para dentro da rede do
// servidor e usar o CRM como proxy.
//
// ## Por que a segunda metade tem o mesmo peso que a primeira
//
// "Recusar tudo" também faz todos os casos de recusa passarem, e passaria como
// correção. Cada família recusada aqui tem um vizinho legítimo que precisa
// continuar entrando — `https://evolution.nateksoft.com` é a instância REAL
// deste projeto (`CLAUDE.md`, verificada em 2026-08-19), e uma correção que a
// recusasse derrubaria o WhatsApp de todo mundo.
import { describe, it, expect } from "vitest";

import { conferirDestino, ehEnderecoInterno } from "../../src/core/conexoes/destino";

/** Atalho: o motivo da recusa, ou `null` quando passou. */
function motivo(url: string): string | null {
  const resultado = conferirDestino(url);
  return resultado.ok ? null : resultado.motivo;
}

describe("conferirDestino — o que é RECUSADO", () => {
  it("localhost, em todas as formas que o parser aceita", () => {
    for (const url of [
      "https://localhost",
      "https://localhost:8080/",
      "https://LOCALHOST./", // ponto final de FQDN absoluto: mesmo host
      "https://sub.localhost/",
      "https://127.0.0.1/",
      "https://127.0.0.53/", // 127/8 inteiro, não só o .1
    ]) {
      expect(motivo(url), url).not.toBeNull();
    }
  });

  it("169.254.169.254 — o endereço de metadados que o achado nomeia", () => {
    // Numa instância mal configurada este endereço devolve credencial de
    // máquina. É o alvo mais valioso de um SSRF em nuvem, e o que a regex
    // antiga aceitava sem piscar.
    expect(motivo("https://169.254.169.254/latest/meta-data/")).toContain("rede interna");
    // E a faixa inteira, não só aquele endereço.
    expect(motivo("https://169.254.1.1/")).not.toBeNull();
  });

  it("as três faixas privadas da RFC 1918, nas bordas", () => {
    for (const url of [
      "https://10.0.0.1/",
      "https://10.255.255.255/",
      "https://172.16.0.1/",
      "https://172.31.255.254/",
      "https://192.168.0.1/",
      "https://192.168.255.254/",
    ]) {
      expect(motivo(url), url).not.toBeNull();
    }
  });

  it("0.0.0.0 e a forma abreviada `0`", () => {
    expect(motivo("https://0.0.0.0/")).not.toBeNull();
    // `https://0/` → o parser normaliza para `0.0.0.0`. Nenhuma lista negra
    // escrita sobre o TEXTO da URL pegaria isto.
    expect(motivo("https://0/")).not.toBeNull();
  });

  it("IPv6: ::1, :: , ULA e link-local", () => {
    for (const url of [
      "https://[::1]/",
      "https://[::]/",
      "https://[fd00::1]/", // fc00::/7 — endereço local único
      "https://[fc00::1]/",
      "https://[fe80::1]/", // link-local
    ]) {
      expect(motivo(url), url).not.toBeNull();
    }
  });

  it("IPv4 mapeado em IPv6 — o loopback voltando disfarçado", () => {
    // O parser comprime `::ffff:127.0.0.1` para `::ffff:7f00:1`. Sem o
    // tratamento do prefixo mapeado, esta forma passa por uma checagem de IPv4
    // (não é quádruplo) E por uma de IPv6 (não é `::1`).
    expect(motivo("https://[::ffff:127.0.0.1]/")).not.toBeNull();
    expect(motivo("https://[::ffff:169.254.169.254]/")).not.toBeNull();
    expect(motivo("https://[::ffff:10.0.0.1]/")).not.toBeNull();
  });

  it("IPv4 codificado: decimal, octal e forma curta", () => {
    // Medido com o parser do Node em 2026-08-21. As três normalizam para
    // 127.0.0.1, e em nenhuma delas a string "127.0.0.1" aparece na URL — é o
    // motivo de a checagem rodar sobre `url.hostname` e não sobre o texto.
    expect(motivo("https://2130706433/")).not.toBeNull();
    expect(motivo("https://0177.0.0.1/")).not.toBeNull();
    expect(motivo("https://127.1/")).not.toBeNull();
  });

  it("nome de rede local por sufixo, e nome sem ponto nenhum", () => {
    for (const url of [
      "https://evolution.local/",
      "https://api.internal/",
      "https://roteador.home.arpa/",
      "https://servidor.lan/",
      // Sem ponto: o resolvedor do SERVIDOR completa com o domínio de busca
      // dele, o que aponta para dentro da rede dele por definição.
      "https://evolution/",
      "https://metadata/",
    ]) {
      expect(motivo(url), url).not.toBeNull();
    }
  });

  it("http:// é recusado — a apikey viaja em toda requisição", () => {
    // O precedente era mais frouxo: `EVOLUTION_DOMAIN`, que morreu no Ciclo 2a,
    // usava `z.string().url()` e aceitava `http://` (ver `3e385dc`).
    // Endurecer é decisão, e o argumento é que o único destino com desculpa
    // para `http://` — uma Evolution na rede interna, sem certificado — acaba
    // de ser recusado pelas regras acima.
    expect(motivo("http://evolution.nateksoft.com/")).toContain("https://");
    expect(motivo("ftp://evolution.nateksoft.com/")).not.toBeNull();
    // `javascript:` e `file:` não têm host: caem na mesma recusa de protocolo,
    // e não numa exceção de parser.
    expect(motivo("file:///etc/passwd")).not.toBeNull();
  });

  it("credencial embutida na URL é recusada", () => {
    // A coluna `dominio` NÃO é o campo cifrado do cofre: uma senha ali ficaria
    // em claro no banco e apareceria na tela de conexões.
    expect(motivo("https://usuario:senha@evolution.nateksoft.com/")).toContain("usuário e senha");
  });

  it("o que não é URL nenhuma é recusado sem lançar", () => {
    for (const entrada of ["", "   ", "evolution.nateksoft.com", "não é url", "//exemplo.com"]) {
      expect(() => conferirDestino(entrada)).not.toThrow();
      expect(motivo(entrada), JSON.stringify(entrada)).not.toBeNull();
    }
  });
});

describe("conferirDestino — a SEGUNDA METADE: domínio legítimo continua entrando", () => {
  it("aceita a instância real deste projeto", () => {
    // `https://evolution.nateksoft.com`, v2.3.7, verificada em 2026-08-19
    // (`CLAUDE.md`). Sem este caso, "recusar tudo" passaria como correção — e
    // derrubaria o WhatsApp de todas as empresas.
    expect(conferirDestino("https://evolution.nateksoft.com")).toEqual({
      ok: true,
      url: "https://evolution.nateksoft.com",
    });
  });

  it("aceita porta não padrão — auto-hospedar em :8443 é instalação comum", () => {
    // Restringir a porta não protegeria nada que a recusa de endereço interno
    // já não proteja, e quebraria instalação legítima. Decisão registrada em
    // `destino.ts`, "O QUE ISTO NÃO FECHA".
    expect(conferirDestino("https://evolution.exemplo.com.br:8443")).toEqual({
      ok: true,
      url: "https://evolution.exemplo.com.br:8443",
    });
  });

  it("aceita caminho, subdomínio e IP público literal", () => {
    for (const url of [
      "https://api.evolution.exemplo.com/v2",
      "https://evo-1.exemplo.io",
      "https://8.8.8.8", // IP público literal: não é interno, então passa
      "https://[2001:4860:4860::8888]", // IPv6 público
    ]) {
      expect(conferirDestino(url).ok, url).toBe(true);
    }
  });

  it("vizinhos textuais das faixas privadas NÃO são confundidos", () => {
    // A metade que impede a lista de faixas de virar uma varredura por
    // prefixo de texto. `172.32` e `172.15` estão FORA de 172.16/12; `10.x`
    // como segundo octeto não é `10/8`; `169.253` não é `169.254/16`.
    for (const url of [
      "https://172.32.0.1",
      "https://172.15.0.1",
      "https://11.0.0.1",
      "https://169.253.0.1",
      "https://100.63.0.1", // logo abaixo do CGNAT 100.64/10
      "https://100.128.0.1", // logo acima
      "https://223.255.255.255", // logo abaixo do multicast 224/4
    ]) {
      expect(conferirDestino(url).ok, url).toBe(true);
    }
  });

  it("nome que só CONTÉM um sufixo local não é recusado por isso", () => {
    // `naolocal.com` termina com "local" mas não com ".local"; `localhost` é
    // recusado, `localhost.exemplo.com` não é um nome de rede local — é um
    // subdomínio público com nome infeliz. O ponto na frente do sufixo é o que
    // separa os dois.
    expect(conferirDestino("https://naolocal.com").ok).toBe(true);
    expect(conferirDestino("https://minhalan.com.br").ok).toBe(true);
    expect(conferirDestino("https://localhost.exemplo.com").ok).toBe(true);
  });

  it("apara a barra final, e só ela", () => {
    // Barra no fim produziria `//message/sendText` no envio. Aparar na
    // GRAVAÇÃO evita que a tela mostre uma coisa e o gateway use outra.
    expect(conferirDestino("https://evolution.nateksoft.com/")).toEqual({
      ok: true,
      url: "https://evolution.nateksoft.com",
    });
    expect(conferirDestino("  https://evolution.nateksoft.com/v2/  ")).toEqual({
      ok: true,
      url: "https://evolution.nateksoft.com/v2",
    });
  });
});

describe("ehEnderecoInterno", () => {
  it("não confunde hostname comum com endereço", () => {
    // A função é a peça que decide "isto é IP e é interno"; um nome qualquer
    // precisa sair dela com `false`, senão a recusa por nome local (que vem
    // depois) nunca seria alcançada e a mensagem de erro apontaria a causa
    // errada.
    expect(ehEnderecoInterno("evolution.nateksoft.com")).toBe(false);
    expect(ehEnderecoInterno("localhost")).toBe(false);
    expect(ehEnderecoInterno("1.2.3")).toBe(false);
    expect(ehEnderecoInterno("999.1.1.1")).toBe(false);
  });
});
