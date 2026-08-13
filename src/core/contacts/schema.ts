import { z } from "zod";

/**
 * Validação declarativa dos campos CADASTRAIS de contato.
 *
 * ## Por que só os cadastrais
 *
 * `nome`, `telefone` e `email` já têm validadores imperativos em `service.ts`,
 * e o de telefone delega a `normalizarTelefone` (`core/leads/dedupe.ts`), que
 * carrega regra com história: código do país, 9º dígito do celular, e a recusa
 * de número incompleto — porque dois contatos sem telefone colidiriam na
 * constraint UNIQUE e fundiriam o histórico de duas pessoas, o que é
 * irreversível. Reescrever aquilo em Zod aqui seria mexer em código que
 * funciona e está coberto, para ganhar consistência de estilo e nada mais.
 *
 * ## Por que o `throw` NÃO mora aqui
 *
 * `tasks/schema.ts` exporta uma função que lança. Aqui não: o erro de domínio
 * é `ContatoInvalidoError`, declarado em `service.ts`, e `service.ts` importa
 * este arquivo. Importar de volta fecharia um ciclo de módulos — que às vezes
 * funciona em ESM e às vezes entrega `undefined` na hora do `new`, dependendo
 * da ordem de avaliação. Este arquivo exporta o schema; quem lança é quem tem
 * o erro. A assimetria com tarefas é deliberada e é isto.
 *
 * ## String vazia vira `null`, sempre
 *
 * Um `<input>` não preenchido manda `""`, não `undefined`. Gravar `""` daria à
 * coluna dois jeitos de dizer "não tem", e toda consulta futura precisaria
 * lembrar dos dois — o mesmo raciocínio que `validarEmail` (`service.ts`) já
 * aplica. A normalização acontece ANTES da validação, no `preprocess`, para
 * que um campo em branco nem chegue às regras de comprimento.
 */

/**
 * As 27 unidades federativas. Lista fechada porque UF é dado de duas letras
 * com conjunto conhecido e estável — aceitar texto livre aqui produziria "sp",
 * "SP ", "São Paulo" e "S.P." na mesma coluna, e o dia em que alguém quiser
 * agrupar leads por estado seria o dia de limpar tudo à mão.
 */
export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

export const LIMITE_EMPRESA = 120;
export const LIMITE_CARGO = 80;
export const LIMITE_ENDERECO = 200;
export const LIMITE_CIDADE = 80;
/**
 * `observacoes` é o campo onde cabe o relato de uma reunião inteira, então o
 * teto é generoso. Não é limite de banco — a coluna é `text` e aceita mais. É
 * limite de produto, e existe porque este texto entra em `AuditLog` (só o
 * comprimento, ver `service.ts`) e viaja na página de detalhe do contato.
 */
export const LIMITE_OBSERVACOES = 4000;

/** Vazio ou só espaços vira `null` antes de qualquer regra. */
function textoOuNulo(valor: unknown): unknown {
  if (typeof valor !== "string") return valor;
  const limpo = valor.trim();
  return limpo.length === 0 ? null : limpo;
}

function textoOpcional(max: number, mensagem: string) {
  return z.preprocess(textoOuNulo, z.string().max(max, mensagem).nullable().optional());
}

export const camposCadastraisSchema = z.object({
  empresa: textoOpcional(
    LIMITE_EMPRESA,
    `Empresa: o limite é ${LIMITE_EMPRESA} caracteres.`
  ),
  cargo: textoOpcional(LIMITE_CARGO, `Cargo: o limite é ${LIMITE_CARGO} caracteres.`),

  /**
   * Guarda só os dígitos, e valida SÓ O COMPRIMENTO — 11 (CPF) ou 14 (CNPJ).
   *
   * Deliberadamente não confere dígito verificador. Um CRM que recusa um
   * documento válido-mas-incomum é pior que um que guarda um erro de digitação:
   * o primeiro impede o cadastro e a pessoa vai embora, o segundo é corrigido
   * em dez segundos na tela de edição. O dia em que a nota fiscal depender
   * disto, a validação forte entra na camada que emite a nota, não aqui.
   */
  documento: z.preprocess(
    (valor) => {
      if (typeof valor !== "string") return valor;
      const digitos = valor.replace(/\D/g, "");
      return digitos.length === 0 ? null : digitos;
    },
    z
      .string()
      .refine(
        (digitos) => digitos.length === 11 || digitos.length === 14,
        "Documento inválido: informe 11 dígitos (CPF) ou 14 (CNPJ)."
      )
      .nullable()
      .optional()
  ),

  endereco: textoOpcional(
    LIMITE_ENDERECO,
    `Endereço: o limite é ${LIMITE_ENDERECO} caracteres.`
  ),
  cidade: textoOpcional(LIMITE_CIDADE, `Cidade: o limite é ${LIMITE_CIDADE} caracteres.`),

  /** Normaliza para maiúsculas antes de conferir: "sp" digitado é SP. */
  uf: z.preprocess(
    (valor) => {
      const texto = textoOuNulo(valor);
      return typeof texto === "string" ? texto.toUpperCase() : texto;
    },
    z
      .string()
      .refine(
        (sigla): sigla is (typeof UFS)[number] => (UFS as readonly string[]).includes(sigla),
        "UF inválida: use a sigla de duas letras, como SP."
      )
      .nullable()
      .optional()
  ),

  observacoes: textoOpcional(
    LIMITE_OBSERVACOES,
    `Observações: o limite é ${LIMITE_OBSERVACOES} caracteres.`
  ),
});

export type CamposCadastrais = z.infer<typeof camposCadastraisSchema>;
