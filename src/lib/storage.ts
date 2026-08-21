import "server-only";

import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * Armazenamento de arquivos.
 *
 * ## ESTADO REAL DO BUCKET, medido em 2026-08-21 — leia antes de confiar
 *
 * Até esta data este arquivo afirmava, em prosa, que o bucket era privado e
 * que havia "limite de tamanho e allowlist de MIME configurados no Supabase,
 * de propósito, em duplicidade" com as checagens daqui. A Fase 1 da auditoria
 * de segurança mediu (`docs/auditorias/2026-08-21-fase1-seguranca-branch-tenancy.md`,
 * achados F26/F27): **o projeto Supabase `uzumzfxjcxrbxaucvfsr` tem ZERO
 * buckets**, e nada no repositório cria `crm-arquivos` — nem migration, nem
 * script, nem código de inicialização.
 *
 * Ou seja: a "segunda camada" nunca existiu. Quem lia este arquivo contava com
 * uma rede que não estava lá, que é o pior defeito possível num arquivo de
 * segurança — pior que não ter a rede, porque desencoraja construí-la.
 *
 * O que É verdade hoje:
 *
 * - **As checagens deste módulo são a ÚNICA camada.** Path, tamanho e magic
 *   bytes rodam aqui, no servidor, antes de qualquer byte sair para o bucket.
 * - **O módulo está dormente**: zero importadores em `src/` (medido na
 *   auditoria e reconferido em 2026-08-21 com
 *   `grep -rn "lib/storage" src/` — os 7 achados são menção em comentário),
 *   e nenhum `type="file"` no projeto. Nada envia arquivo ainda.
 * - **O primeiro upload real vai FALHAR** enquanto o bucket não existir: o
 *   Supabase responde `Bucket not found` e o erro sobe por
 *   `Falha no upload: …`. Falha fechada, não silenciosa — o dado não vai para
 *   lugar nenhum.
 *
 * ## O que precisa ser configurado ANTES do primeiro upload
 *
 * A configuração exigida deixou de ser prosa e virou valor:
 * `CONFIGURACAO_EXIGIDA_DO_BUCKET`, logo abaixo, DERIVADO das mesmas
 * constantes que o código aplica — não pode divergir delas sem
 * `tests/unit/storage.test.ts` ficar vermelho. Criar o bucket é ação do dono
 * do projeto (console do Supabase ou CLI); este repositório não cria bucket
 * nem guarda credencial para isso.
 *
 * ## Por que `upload` devolve o PATH e não uma URL
 *
 * O bucket PRECISA ser privado (`CONFIGURACAO_EXIGIDA_DO_BUCKET.publico ===
 * false`). Num bucket privado não existe URL permanente: o acesso se dá por
 * URL assinada, que expira. Devolver uma URL assinada de `upload` convidaria o
 * chamador a gravá-la no banco, e ela apodreceria em minutos — o campo
 * pareceria certo e o link quebraria depois, longe da causa.
 *
 * Então o contrato é: **guarde o path que `upload` devolveu**, e chame
 * `urlAssinada(path)` na hora de renderizar. O path é estável; a URL é efêmera
 * por construção.
 */
export interface Storage {
  /**
   * Envia o arquivo e devolve o PATH GERADO AQUI DENTRO (não uma URL — ver
   * acima; e não o nome que o chamador quiser — ver `nomeDeObjeto`).
   *
   * O chamador escolhe só a PASTA (`prefixo`, ex.: `"leads/lead-123"`); o nome
   * do objeto é sorteado neste módulo a partir do content-type já validado.
   */
  upload(prefixo: string, file: Buffer, contentType: string): Promise<string>;
  /** URL temporária para leitura. Gere na hora de exibir, nunca persista. */
  urlAssinada(path: string, expiraEmSegundos?: number): Promise<string>;
  delete(path: string): Promise<void>;
}

const BUCKET = "crm-arquivos";

/**
 * Padrão do projeto: 15 minutos. Curto o bastante para que um link vazado
 * (histórico do navegador, print no WhatsApp, log de proxy) não sirva como
 * acesso permanente; longo o bastante para carregar uma página e o usuário
 * abrir o arquivo sem pressa.
 */
export const EXPIRACAO_PADRAO_SEGUNDOS = 15 * 60;

/** 10 MB. Sem teto, um upload autenticado vira custo de armazenamento e banda ilimitado. */
export const TAMANHO_MAXIMO_BYTES = 10 * 1024 * 1024;

/**
 * Allowlist, não blocklist.
 *
 * SVG está FORA de propósito, e essa é a exclusão que mais gera pergunta:
 * SVG é XML, aceita `<script>` dentro, e é servido com um content-type que o
 * navegador executa. Um SVG "inofensivo" enviado por um usuário e aberto em
 * aba própria roda JavaScript na origem que o serve. Se um dia for preciso
 * aceitar SVG, o caminho é sanitizar o XML na entrada, não afrouxar isto.
 */
const TIPOS_PERMITIDOS: Record<string, ReadonlyArray<readonly number[]>> = {
  // JPEG começa com FF D8 FF.
  "image/jpeg": [[0xff, 0xd8, 0xff]],
  // PNG: assinatura de 8 bytes.
  "image/png": [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  // GIF87a / GIF89a.
  "image/gif": [
    [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
    [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  ],
  // WEBP é um container RIFF: "RIFF" nos bytes 0-3 e "WEBP" nos 8-11. O
  // segundo trecho é conferido à parte, em `assinaturaConfere`.
  "image/webp": [[0x52, 0x49, 0x46, 0x46]],
  // %PDF-
  "application/pdf": [[0x25, 0x50, 0x44, 0x46, 0x2d]],
};

export const MIME_PERMITIDOS = Object.keys(TIPOS_PERMITIDOS);

/**
 * Extensão gravada no nome do objeto, por tipo permitido.
 *
 * Ela sai do content-type JÁ VALIDADO por `assinaturaConfere` — nunca do nome
 * que o chamador mandou. É a diferença entre "extensão que descreve o
 * conteúdo" e "extensão que alguém digitou": um `.html` chega ao bucket
 * rotulado `image/png` sem esforço nenhum se o nome vier de fora, e é
 * exatamente o achado 21 da auditoria.
 *
 * Precisa ter UMA entrada para cada tipo de `TIPOS_PERMITIDOS`, e nenhuma a
 * mais. Tipo novo na allowlist sem extensão aqui geraria objeto sem extensão
 * (ou `undefined` no nome); extensão aqui sem tipo lá é código morto que
 * finge cobertura. A igualdade exata é travada em `tests/unit/storage.test.ts`
 * ("a allowlist de MIME e o mapa de extensões não podem derivar").
 */
export const EXTENSAO_POR_MIME: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/**
 * A configuração que o bucket `crm-arquivos` PRECISA ter, como valor e não
 * como promessa em comentário.
 *
 * Existe por causa do defeito que este arquivo carregava (ver o bloco no topo):
 * a prosa afirmava uma configuração no Supabase que ninguém tinha feito, e não
 * havia nada que pudesse contradizê-la. Um objeto derivado das MESMAS
 * constantes que o código aplica não tem como envelhecer em silêncio — mudar
 * `TAMANHO_MAXIMO_BYTES` ou a allowlist muda isto junto, e o caso
 * "`CONFIGURACAO_EXIGIDA_DO_BUCKET` é derivada, não uma cópia" em
 * `tests/unit/storage.test.ts` reprova a cópia manual.
 *
 * O que ele NÃO é: uma verificação de que o bucket está assim. Este módulo não
 * consulta o estado do bucket (seria uma viagem de rede por upload, e a
 * `service_role` daqui poderia CRIAR o bucket — provisionamento silencioso a
 * partir do caminho de dados é o oposto do que se quer). Enquanto o dono não
 * criar o bucket com estes valores, a única camada é o código deste arquivo, e
 * o topo do arquivo diz isso com todas as letras.
 */
export const CONFIGURACAO_EXIGIDA_DO_BUCKET = {
  nome: BUCKET,
  /** Privado. Bucket público dispensa URL assinada e torna todo path adivinhável em acesso. */
  publico: false,
  /** O mesmo teto que `upload` aplica — a duplicidade só vale se os números baterem. */
  limiteBytes: TAMANHO_MAXIMO_BYTES,
  /** A mesma allowlist de `upload`. SVG fora, pelo motivo escrito em `TIPOS_PERMITIDOS`. */
  mimesPermitidos: MIME_PERMITIDOS,
} as const;

/**
 * Confere a assinatura binária ("magic bytes") do conteúdo contra o
 * content-type declarado.
 *
 * O content-type vem do cliente e é só uma string — quem envia escolhe o que
 * quiser. Sem esta conferência, um `.html` com script, ou um executável,
 * entra no bucket rotulado como `image/png` e depois é servido como PNG…
 * até alguém abrir direto pelo link, quando o navegador pode reinterpretá-lo
 * (é para isso que existe o `X-Content-Type-Options: nosniff`, mas não se
 * depende de uma camada só).
 */
function assinaturaConfere(file: Buffer, contentType: string): boolean {
  const assinaturas = TIPOS_PERMITIDOS[contentType];
  if (!assinaturas) return false;

  const bate = assinaturas.some(
    (assinatura) =>
      file.length >= assinatura.length &&
      assinatura.every((byte, i) => file[i] === byte)
  );
  if (!bate) return false;

  // RIFF sozinho também casa com WAV/AVI — o que identifica WEBP é o "WEBP"
  // nos bytes 8..11.
  if (contentType === "image/webp") {
    return file.length >= 12 && file.subarray(8, 12).toString("ascii") === "WEBP";
  }

  return true;
}

/**
 * Valida o path do objeto em `urlAssinada` e `delete`.
 *
 * Desde a correção do achado 21, `upload` NÃO usa esta função: lá o path é
 * gerado (`nomeDeObjeto`) e valida o PREFIXO com `prefixoValido`, mais
 * estreito. Esta continua valendo para as duas operações que recebem um path
 * já existente, e que voltam de onde o chamador tiver guardado — hoje seria
 * uma coluna do banco, amanhã pode ser um id vindo do cliente numa Server
 * Action.
 *
 * `..` num path de storage é traversal: lê ou apaga fora do prefixo
 * pretendido. Barra inicial e `\` também são recusados para o path ser sempre
 * relativo e previsível.
 *
 * Todo path que `upload` devolve passa aqui — é o que liga as duas metades, e
 * está travado no caso "o path devolvido por `upload` é aceito por
 * `urlAssinada` e `delete`" (`tests/unit/storage.test.ts`).
 */
function pathValido(path: string): boolean {
  if (path.length === 0 || path.length > 512) return false;
  if (path.startsWith("/") || path.includes("\\")) return false;
  if (path.includes("//")) return false;
  // Segmento exatamente "." ou ".." — recusa `../x`, `a/../b`, `a/..`.
  if (path.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) return false;
  // Byte nulo trunca string em várias camadas C por baixo.
  if (path.includes("\0")) return false;
  return true;
}

/**
 * Valida o PREFIXO (a pasta) que o chamador escolhe.
 *
 * Mais estreito que `pathValido` de propósito: o prefixo é o único pedaço do
 * path que ainda vem de fora, então ele passa por allowlist de caracteres, e
 * não por lista de coisas proibidas. `..`, `\`, `/` inicial, `//`, byte nulo,
 * espaço, `%` e `?` não são recusados um a um — eles simplesmente não estão no
 * conjunto aceito, que é `A-Z a-z 0-9 _ -` por segmento.
 *
 * Lista de recusa é a forma que este projeto já viu falhar (a allowlist de
 * MIME acima existe pelo mesmo motivo): ela protege do que quem escreveu
 * lembrou, e a codificação seguinte passa.
 *
 * Formato: 1 a 8 segmentos, cada um de 1 a 64 caracteres — `"leads"`,
 * `"leads/lead-123"`, `"conexoes/conn_9/anexos"`. Cabe `cuid()` (que é
 * `[a-z0-9]`) e `uuid` (que tem `-`), que são os ids deste schema.
 */
const SEGMENTO_DE_PREFIXO = /^[A-Za-z0-9_-]{1,64}$/;

function prefixoValido(prefixo: string): boolean {
  if (prefixo.length === 0 || prefixo.length > 200) return false;
  const segmentos = prefixo.split("/");
  if (segmentos.length > 8) return false;
  return segmentos.every((seg) => SEGMENTO_DE_PREFIXO.test(seg));
}

/**
 * O nome do objeto, gerado AQUI — achado 21 da auditoria de segurança.
 *
 * ## O que estava errado
 *
 * `upload(path, ...)` recebia o path inteiro do chamador. As três checagens
 * (magic bytes, tamanho, traversal) estavam de pé, mas o NOME era de quem
 * chamasse — e nome de arquivo, em toda base que aceita upload, chega do
 * navegador: `file.name`. Isso deixava três coisas em aberto, e nenhuma delas
 * a validação de traversal alcança:
 *
 * 1. **Sobrescrita.** Dois chamadores com o mesmo nome batem no mesmo objeto.
 *    Com o `upsert: true` que este arquivo usava, o segundo apagava o primeiro
 *    em silêncio — inclusive o anexo de OUTRO registro, se o nome viesse do
 *    usuário. Hoje o nome é sorteado e `upsert` é `false`: colisão vira erro,
 *    não perda.
 * 2. **Extensão descolada do conteúdo.** `relatorio.html` com bytes de PNG
 *    passava (a assinatura confere o CONTEÚDO, não o nome) e ficava no bucket
 *    com nome que convida o navegador a tratar como HTML.
 * 3. **O nome original é dado do usuário.** Ele podia carregar o nome de um
 *    cliente, um CPF, um caminho de rede interno — e o path vaza na URL
 *    assinada, no log do proxy e no histórico do navegador.
 *
 * ## O contrato novo
 *
 * O chamador escolhe a PASTA; o módulo escolhe o NOME: `randomUUID()` mais a
 * extensão do content-type já validado. Se a interface precisar mostrar
 * "orcamento-2026.pdf", esse nome vai para uma COLUNA do banco, ao lado do
 * path — texto exibido, não identificador de objeto.
 */
function nomeDeObjeto(prefixo: string, contentType: string): string {
  return `${prefixo}/${randomUUID()}.${EXTENSAO_POR_MIME[contentType]}`;
}

// Validação isolada neste módulo (não em src/lib/env.ts): apenas quem
// realmente importa storage.ts precisa dessas variáveis. Se elas fossem
// exigidas no schema central, qualquer teste ou build que importe algo que
// dependa de env.ts (ex.: auth.ts, prisma.ts) passaria a exigir credenciais
// do Supabase mesmo sem usar armazenamento.
const storageEnvSchema = z.object({
  SUPABASE_URL: z.string().url({
    message: "SUPABASE_URL ausente ou inválida — defina no .env",
  }),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, {
    message: "SUPABASE_SERVICE_ROLE_KEY ausente — defina no .env",
  }),
});

function getStorageEnv() {
  const resultado = storageEnvSchema.safeParse({
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });

  if (!resultado.success) {
    const detalhes = resultado.error.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Configuração de storage inválida: ${detalhes}`);
  }

  return resultado.data;
}

class SupabaseStorage implements Storage {
  private client: ReturnType<typeof createClient>;

  constructor() {
    const env = getStorageEnv();
    this.client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  }

  async upload(prefixo: string, file: Buffer, contentType: string): Promise<string> {
    // As três checagens abaixo rodam no SERVIDOR, antes de qualquer byte
    // chegar ao bucket, e HOJE SÃO A ÚNICA CAMADA — o bucket não existe (ver
    // o bloco no topo do arquivo, achados F26/F27 da auditoria de 2026-08-21).
    // Quando ele for criado com `CONFIGURACAO_EXIGIDA_DO_BUCKET`, passam a ser
    // duas: este código usa a `service_role`, que ignora RLS, então o limite
    // no bucket é a rede de baixo para o dia em que outro caminho de código
    // enviar arquivo sem passar por aqui.
    if (!prefixoValido(prefixo)) {
      throw new Error("Falha no upload: caminho de arquivo inválido");
    }
    if (file.length > TAMANHO_MAXIMO_BYTES) {
      throw new Error(
        `Falha no upload: arquivo acima do limite de ${Math.floor(TAMANHO_MAXIMO_BYTES / 1024 / 1024)} MB`
      );
    }
    if (!assinaturaConfere(file, contentType)) {
      // Mensagem deliberadamente igual para "tipo não permitido" e "conteúdo
      // não corresponde ao tipo declarado": quem está sondando o que passa
      // não ganha um oráculo que diferencie os dois casos.
      throw new Error(
        `Falha no upload: tipo de arquivo não permitido (aceitos: ${MIME_PERMITIDOS.join(", ")})`
      );
    }

    // O nome sai daqui, do content-type JÁ validado logo acima — nunca do
    // chamador (ver `nomeDeObjeto`). A ordem importa: gerar antes da validação
    // usaria `EXTENSAO_POR_MIME[contentType]` de um tipo que pode nem estar na
    // allowlist, e o nome sairia com `undefined` na ponta.
    const path = nomeDeObjeto(prefixo, contentType);

    // `upsert: false`, e não `true` como era antes: com nome sorteado, um
    // upsert só poderia significar colisão de UUID ou reenvio do mesmo path —
    // nos dois casos, sobrescrever é perder arquivo em silêncio. Erro é a
    // resposta honesta.
    const { error } = await this.client.storage.from(BUCKET).upload(path, file, {
      contentType,
      upsert: false,
    });
    if (error) throw new Error(`Falha no upload: ${error.message}`);

    // Devolve o PATH GERADO, não uma URL — ver o comentário na interface
    // `Storage`. Quem chama TEM que guardar este retorno: o chamador não sabe
    // mais o nome do objeto, e sem ele o arquivo fica órfão no bucket.
    return path;
  }

  async urlAssinada(
    path: string,
    expiraEmSegundos: number = EXPIRACAO_PADRAO_SEGUNDOS
  ): Promise<string> {
    if (!pathValido(path)) {
      throw new Error("Falha ao gerar URL: caminho de arquivo inválido");
    }

    const { data, error } = await this.client.storage
      .from(BUCKET)
      .createSignedUrl(path, expiraEmSegundos);
    if (error) throw new Error(`Falha ao gerar URL: ${error.message}`);
    if (!data?.signedUrl) throw new Error("Falha ao gerar URL: resposta sem signedUrl");

    return data.signedUrl;
  }

  async delete(path: string): Promise<void> {
    if (!pathValido(path)) {
      throw new Error("Falha ao remover: caminho de arquivo inválido");
    }

    const { error } = await this.client.storage.from(BUCKET).remove([path]);
    if (error) throw new Error(`Falha ao remover: ${error.message}`);
  }
}

export const storage: Storage = new SupabaseStorage();
