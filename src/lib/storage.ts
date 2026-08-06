import "server-only";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * Armazenamento de arquivos.
 *
 * ## Por que `upload` devolve o PATH e não uma URL
 *
 * O bucket é PRIVADO (ver a auditoria de segurança abaixo). Num bucket
 * privado não existe URL permanente: o acesso se dá por URL assinada, que
 * expira. Devolver uma URL assinada de `upload` convidaria o chamador a
 * gravá-la no banco, e ela apodreceria em minutos — o campo pareceria certo
 * e o link quebraria depois, longe da causa.
 *
 * Então o contrato é: **guarde o path**, e chame `urlAssinada(path)` na hora
 * de renderizar. O path é estável; a URL é efêmera por construção.
 */
export interface Storage {
  /** Envia o arquivo e devolve o PATH salvo (não uma URL — ver acima). */
  upload(path: string, file: Buffer, contentType: string): Promise<string>;
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
 * Valida o path do objeto.
 *
 * O path costuma ser montado com algo vindo do usuário (nome de arquivo, id).
 * `..` num path de storage é traversal: escreve fora do prefixo pretendido e
 * pode sobrescrever objeto de outro registro. Barra inicial e `\` também são
 * recusados para o path ser sempre relativo e previsível.
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

  async upload(path: string, file: Buffer, contentType: string): Promise<string> {
    // As três checagens abaixo rodam no SERVIDOR, antes de qualquer byte
    // chegar ao bucket. O bucket também tem limite de tamanho e allowlist de
    // MIME configurados no Supabase — de propósito, em duplicidade: este
    // código usa a service_role, que ignora RLS, então a checagem no bucket
    // é a rede de baixo caso um dia outro caminho de código envie arquivo
    // sem passar por aqui.
    if (!pathValido(path)) {
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

    const { error } = await this.client.storage.from(BUCKET).upload(path, file, {
      contentType,
      upsert: true,
    });
    if (error) throw new Error(`Falha no upload: ${error.message}`);

    // Devolve o PATH, não uma URL — ver o comentário na interface `Storage`.
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
