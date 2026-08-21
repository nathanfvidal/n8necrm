/**
 * A porta única do cofre. Quem consome importa daqui e nunca dos arquivos
 * internos — assim trocar o carregador de chave por um KMS, ou o formato por
 * um `v2`, não obriga a mexer em nenhum chamador.
 */
export {
  CofreError,
  CofreSemChaveError,
  CofreChaveInvalidaError,
  CofreChaveDesconhecidaError,
  type ChaveMestra,
} from "./chave";

export {
  cifrar,
  decifrar,
  PROPOSITO_APIKEY_CONEXAO,
  CofreFormatoInvalidoError,
  CofreDecifragemError,
  type ContextoDoSegredo,
} from "./segredo";
