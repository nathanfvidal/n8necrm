import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * O nginx é testado como TEXTO. Nada aqui roda nginx.
 *
 * Estes casos não substituem `nginx -t` — substituem a MEMÓRIA. Cada um é uma
 * decisão que parece detalhe de encanamento e é de segurança ou de correção, e
 * que uma edição futura apagaria sem que nada quebrasse na hora.
 */
const conf = readFileSync("deploy/nginx/crm.nateksoft.com.conf", "utf8");
const fase1 = readFileSync("deploy/nginx/crm.nateksoft.com.fase1.conf", "utf8");

describe("nginx do CRM", () => {
  it("sobrescreve X-Real-IP com $remote_addr", () => {
    // `IP_CABECALHO_CONFIAVEL="x-real-ip"` só é seguro porque ESTA linha
    // existe: ela DESCARTA o que o cliente mandou. Sem ela o cabeçalho chega
    // intacto do cliente e o AuditLog passa a guardar IP forjado -- pior que
    // nulo, porque aponta para a pessoa errada (o raciocínio está escrito no
    // bloco daquela variável em `.env.example`).
    expect(conf).toContain("proxy_set_header X-Real-IP $remote_addr;");
  });

  it("NUNCA sobrescreve X-Forwarded-For com $remote_addr", () => {
    // A convenção de X-Forwarded-For é ACUMULAR, e `$proxy_add_x_forwarded_for`
    // é o que faz isso; trocá-lo por `$remote_addr` apagaria a cadeia inteira.
    // O par correto é: X-Real-IP sobrescreve, X-Forwarded-For acumula -- e é
    // por acumular que ele NÃO serve a `IP_CABECALHO_CONFIAVEL`, já que
    // `src/lib/ip.ts:100` lê o PRIMEIRO item da lista, que é o do cliente.
    expect(conf).toContain("proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;");
    expect(conf).not.toMatch(/X-Forwarded-For\s+\$remote_addr/);
  });

  it("recusa /api/queues/whatsapp-turn na borda, com 404 e não 403", () => {
    // O gatilho escolhido é o worker EM PROCESSO: nada legítimo chama esta
    // rota de fora. Na Vercel havia air-gap de rede; fora dela não há, e
    // WHATSAPP_QUEUE_SECRET seria a única defesa. Isto devolve a segunda
    // camada.
    //
    // 404 e não 403 porque a própria rota responde 404 a segredo errado
    // (`src/app/api/queues/whatsapp-turn/route.ts:73`). Se a borda respondesse
    // 403, uma sonda externa distinguiria "bloqueado na borda" de "segredo
    // errado" -- e essa diferença confirma que o path existe, que é
    // exatamente o que o 404 recusa dizer.
    //
    // Sem a flag `s`: `tsconfig.json` deste projeto tem "target": "ES2017", e
    // `tsc --noEmit` recusa a flag dotAll com TS1501 -- a mesma armadilha que
    // `tests/unit/supabase-jwt-chave.test.ts` já registra. Ela também é
    // desnecessária: `[^}]*` casa quebra de linha em qualquer target.
    expect(conf).toMatch(/location\s*=\s*\/api\/queues\/whatsapp-turn\s*\{[^}]*return\s+404;/);
  });

  it("não manda NENHUM header de segurança — o Next já manda", () => {
    // `next.config.ts` já envia nosniff (linha 21), X-Frame-Options (29),
    // Referrer-Policy (37), Permissions-Policy (44) e HSTS (61); `src/proxy.ts`
    // envia o CSP com nonce POR REQUISIÇÃO. Um `add_header
    // Content-Security-Policy` aqui faria o navegador receber DOIS CSPs e
    // aplicar a INTERSEÇÃO das duas políticas -- mais restritiva que qualquer
    // uma isolada, quebrando de um jeito difícil de diagnosticar. O comentário
    // no topo de `next.config.ts` já registra esse modo de falha; este caso
    // impede que ele seja reintroduzido pela outra ponta.
    expect(conf).not.toMatch(/add_header\s+Content-Security-Policy/i);
    expect(conf).not.toMatch(/add_header\s+Strict-Transport-Security/i);
    expect(conf).not.toMatch(/add_header\s+X-Frame-Options/i);
  });

  it("a fase 1 não referencia certificado nenhum", () => {
    // O motivo de existirem DOIS arquivos: `nginx -t` falha apontando para um
    // `ssl_certificate` que ainda não foi emitido, e o certificado não pode ser
    // emitido enquanto o nginx não responder ao desafio ACME neste nome.
    expect(fase1).not.toContain("ssl_certificate");
    expect(fase1).not.toContain("listen 443");
    expect(fase1).toContain("/.well-known/acme-challenge/");
  });

  it("o definitivo continua servindo o desafio ACME depois da emissão", () => {
    // `certbot renew` usa o MESMO caminho a cada 60 dias. Apagar este bloco
    // depois de emitido não quebra nada na hora -- o certificado só expira
    // três meses depois, em silêncio, e aí o CRM inteiro fica inacessível por
    // erro de certificado.
    expect(conf).toContain("/.well-known/acme-challenge/");
  });

  it("os dois arquivos usam server_name EXATO", () => {
    // A precedência do nginx é: nome exato ganha de curinga, independentemente
    // da ordem dos arquivos. É o que permite o CRM assumir crm.nateksoft.com
    // SEM tocar em nateksoft.conf, que hoje casa o curinga nas portas 80 e 443
    // e é o arquivo que mantém n8n e Evolution de pé.
    //
    // A terceira asserção é varredura de texto cru, então o curinga não é
    // soletrado em comentário NENHUM deste arquivo nem do .conf -- casaria com
    // quem só o menciona. Mesma armadilha registrada em `.env.example` para o
    // prefixo público do JWK.
    expect(conf).toContain("server_name crm.nateksoft.com;");
    expect(fase1).toContain("server_name crm.nateksoft.com;");
    expect(conf).not.toContain("*.nateksoft.com");
  });
});
