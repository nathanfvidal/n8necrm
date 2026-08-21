import { z } from "zod";

import { client } from "../../../config/client";
import { clientConfigSchema, marcaSchema, type ClientConfig } from "../../../config/client.schema";

/**
 * A forma da configuração POR EMPRESA — a metade de `config/client.ts` que não
 * pode ser a mesma para duas empresas no mesmo banco.
 *
 * ## Derivado, nunca redigitado
 *
 * `marcaDaEmpresaSchema` é `marcaSchema.omit({ nome: true })`, e `modulos` é
 * `clientConfigSchema.shape.modulos`. Com isso, o piso de croma
 * (`CROMA_MINIMO`), o enum fechado de `FONTES` e o regex de `caminhoDeAsset` —
 * os três com o porquê escrito em `config/client.schema.ts` — valem para o
 * valor que vem do BANCO exatamente como valem para o do arquivo. Duas cópias
 * do mesmo schema divergiriam em silêncio, e o sintoma seria o que aquele
 * arquivo descreve: "o white-label para de funcionar em silêncio". Os três têm
 * caso próprio em `tests/unit/config-schema.test.ts` ("herda o piso de croma",
 * "herda o enum fechado de fontes", "herda o regex de caminho de asset"),
 * justamente para que a herança seja medida e não presumida.
 *
 * `nome` sai da marca porque o nome exibido é `Company.nome` (Ciclo 1a).
 * `marca.nome` do arquivo tem ZERO leituras em `src/` — medido em 2026-08-20,
 * `grep -rn "client.marca" src/` — e criar uma coluna para ele seria uma
 * segunda fonte de verdade sobre o nome da empresa.
 *
 * ## Este arquivo NÃO toca o banco
 *
 * `mesclarConfig` é pura. A decisão "banco sobrepõe arquivo, campo a campo" é a
 * regra mais fácil de errar deste ciclo, e ela fica exercitável sem Postgres,
 * sem Prisma e sem mock — ver `tests/unit/config-schema.test.ts`. Quem alcança
 * o banco é `src/core/config/leitura.ts`, da Task 3 deste ciclo, que ainda não
 * existe quando este arquivo é escrito.
 */

/** Os nomes de módulo, derivados do enum do Zod — nunca uma segunda lista. */
export type ModuloNome = ClientConfig["modulos"][number];

/**
 * A marca de uma empresa. `nome` não entra: quem carrega o nome é
 * `Company.nome`.
 */
export const marcaDaEmpresaSchema = marcaSchema.omit({ nome: true });
export type MarcaDaEmpresa = z.infer<typeof marcaDaEmpresaSchema>;

export const configDaEmpresaSchema = z.object({
  /** `Company.nome`. `min(1)` porque é o texto que a barra lateral mostra. */
  nome: z.string().min(1),
  marca: marcaDaEmpresaSchema,
  modulos: clientConfigSchema.shape.modulos,
});
export type ConfigDaEmpresa = z.infer<typeof configDaEmpresaSchema>;

/**
 * A linha de `CompanyConfig`, como o Prisma a devolve.
 *
 * Escrita à mão e não `Prisma.CompanyConfigGetPayload<...>` de propósito: assim
 * `mesclarConfig` não importa nada de `@prisma/client`, e o teste dela não
 * precisa do client gerado. Se o schema mudar, o `select` de
 * `src/core/config/leitura.ts` deixa de casar com este tipo e o `tsc` acusa —
 * a checagem continua existindo, um arquivo adiante.
 *
 * `modulos: string[]` e não `string[] | null` porque é assim que o Prisma tipa
 * lista escalar: `node_modules/.prisma/client/index.d.ts`, tipo
 * `CompanyConfig` (linha 18406 nesta árvore, medido na Task 1) — `modulos:
 * string[]`. É desse fato que sai a assimetria documentada em `mesclarConfig`.
 */
export type LinhaDeConfig = {
  corPrimaria: string | null;
  fonte: string | null;
  logoClaro: string | null;
  logoEscuro: string | null;
  modulos: string[];
};

/**
 * Configuração inválida recusa a leitura inteira, em vez de cair no padrão.
 *
 * Cair no padrão em silêncio é o defeito que `CROMA_MINIMO` existe para
 * impedir: o painel abriria neutro e ninguém saberia por quê. A mensagem
 * carrega o `companyId` pelo mesmo motivo que `EscopoDeEmpresaError` carrega —
 * sem ele, o erro não diz de qual empresa é a linha ruim. Os sete casos
 * parametrizados de "linha inválida RECUSA, não degrada", em
 * `tests/unit/config-schema.test.ts`, afirmam o tipo do erro E a presença do
 * companyId na mensagem.
 */
export class ConfigDaEmpresaInvalidaError extends Error {
  constructor(companyId: string, causa: z.ZodError | string) {
    const detalhe =
      typeof causa === "string"
        ? causa
        : causa.issues.map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`).join(" · ");

    super(
      `A configuração da empresa ${JSON.stringify(companyId)} é inválida, e a leitura RECUSA em ` +
        `vez de cair no padrão de config/client.ts (cair no padrão deixaria o white-label quebrado ` +
        `em silêncio — ver CROMA_MINIMO em config/client.schema.ts): ${detalhe}`,
    );
    this.name = "ConfigDaEmpresaInvalidaError";
  }
}

/**
 * O padrão que vem do arquivo versionado.
 *
 * Função e não constante de módulo: uma constante seria um objeto único
 * compartilhado por todas as requisições do processo, e um chamador que
 * mutasse a lista de módulos envenenaria as requisições seguintes — o caso
 * "não devolve a MESMA referência de `client.modulos`" é o que trava isso. O
 * `parse` também descarta `marca.nome` sem que este arquivo precise saber que
 * ele existe.
 */
export function padraoDoArquivo(): { marca: MarcaDaEmpresa; modulos: ModuloNome[] } {
  return {
    marca: marcaDaEmpresaSchema.parse(client.marca),
    modulos: [...client.modulos],
  };
}

/**
 * Mescla a linha do banco sobre o padrão do arquivo e VALIDA o resultado.
 *
 * Regras, e cada uma tem caso em `tests/unit/config-schema.test.ts`:
 *
 * - `linha === null` → o padrão do arquivo, inteiro ("SEM linha, devolve
 *   exatamente o padrão do arquivo").
 * - coluna NULA → o padrão daquele campo ("campo nulo cai no padrão").
 * - coluna preenchida → o banco vence ("a fonte do banco vence a do arquivo").
 * - `modulos` NÃO tem estado "nulo" (lista escalar no Prisma nunca é nula —
 *   ver a citação em `LinhaDeConfig`): **se a linha existe, `modulos` dela
 *   manda, inclusive vazia.** Empresa que não decidiu módulos é empresa SEM
 *   LINHA. Caso: "linha com `modulos: []` desliga TODOS os módulos".
 * - os dois logos ou nenhum ("logo só claro" e "logo só escuro").
 *
 * A assimetria entre as duas últimas regras é deliberada e NÃO é uma
 * inconsistência a corrigir: `corPrimaria`, `fonte` e os dois `logo*` são
 * colunas nulas e têm como dizer "não decidi"; `modulos` não tem. Uniformizar
 * as duas exigiria inventar um estado que a coluna não sabe representar.
 */
export function mesclarConfig(
  companyId: string,
  nome: string,
  linha: LinhaDeConfig | null,
): ConfigDaEmpresa {
  const padrao = padraoDoArquivo();

  if (linha === null) {
    return validar(companyId, { nome, marca: padrao.marca, modulos: padrao.modulos });
  }

  // A dupla de logos é cobrada AQUI, e não pelo Postgres: o Prisma não modela
  // `CHECK`, e o efeito de `prisma migrate dev` sobre um `CHECK` escrito à mão
  // não foi medido neste ambiente (NV2 do spec). Até esta função existir, o
  // banco aceitava meia dupla — ver o bloco de `CompanyConfig` em
  // `prisma/schema.prisma`, que já registra que a regra vive na leitura.
  const temClaro = linha.logoClaro !== null;
  const temEscuro = linha.logoEscuro !== null;
  if (temClaro !== temEscuro) {
    throw new ConfigDaEmpresaInvalidaError(
      companyId,
      `logoClaro e logoEscuro são os dois ou nenhum, e esta linha tem só ` +
        `${temClaro ? "logoClaro" : "logoEscuro"}. Logo monocromático some no fundo da mesma cor, ` +
        `e o painel abre no escuro por padrão — ver o comentário de \`logo\` em ` +
        `config/client.schema.ts.`,
    );
  }

  // Os dois `!== null` repetidos, em vez de reusar `temClaro`/`temEscuro`: o
  // TypeScript estreita a propriedade pela comparação, não por um booleano
  // guardado numa variável. Sem esta repetição, montar o par exigiria uma
  // asserção `as string` — justamente a construção que apagaria a checagem.
  const logo =
    linha.logoClaro !== null && linha.logoEscuro !== null
      ? { claro: linha.logoClaro, escuro: linha.logoEscuro }
      : padrao.marca.logo;

  return validar(companyId, {
    nome,
    marca: {
      corPrimaria: linha.corPrimaria ?? padrao.marca.corPrimaria,
      fonte: linha.fonte ?? padrao.marca.fonte,
      // Espalhado condicionalmente: `logo: undefined` explícito faria o Zod
      // ver a chave presente com valor indefinido, o que é o mesmo que ausente
      // para `.optional()` — mas deixaria a chave no objeto de saída, e o caso
      // que compara conjuntos de chaves ficaria mentindo.
      ...(logo ? { logo } : {}),
    },
    modulos: linha.modulos,
  });
}

function validar(companyId: string, bruto: unknown): ConfigDaEmpresa {
  const resultado = configDaEmpresaSchema.safeParse(bruto);
  if (!resultado.success) {
    throw new ConfigDaEmpresaInvalidaError(companyId, resultado.error);
  }
  return resultado.data;
}
