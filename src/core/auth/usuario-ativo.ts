import type { Role } from "@prisma/client";

/**
 * Quem está agindo, e em qual empresa.
 *
 * NÃO é o modelo `User` do Prisma, e isso é deliberado por dois motivos.
 *
 * **O campo `papel` sobrevive de propósito.** Vinte e seis lugares chamam
 * `hasPermission` como `usuario.papel, acao`. Se o retorno de `usuarioAtual()`
 * trocasse a forma, os 26 precisariam ser editados — e cada edição manual num
 * `hasPermission` é uma chance de trocar a ação, inverter a condição ou
 * esquecer o `!`, produzindo falha de autorização que nenhum compilador pega.
 * Preservando o campo, a refatoração vira invisível para eles, e "nenhum
 * consumidor mudou" passa a ser o critério que PROVA que ela não vazou.
 *
 * **Deixar de ser o modelo do Prisma é ganho, não perda.** Quem dependia de
 * campo que não está aqui — `senhaHash`, por exemplo — para de compilar. Nada
 * fora de `core/auth` tem por que ler hash de senha.
 */
export interface UsuarioAtivo {
  id: string;
  nome: string;
  email: string;
  ativo: boolean;
  /** Empresa ativa desta requisição. Todo escopo de query sai daqui. */
  companyId: string;
  /** Papel do usuário NESTA empresa — vem de `Membership`, não de `User`. */
  papel: Role;
}

/**
 * Lançado quando a conta tem mais de um vínculo.
 *
 * Separado de "Não autenticado" porque não é sessão inválida: a sessão é
 * legítima, a aplicação é que ainda não sabe qual empresa servir. Tratar as
 * duas como a mesma coisa mandaria a pessoa para o login num loop, sem nunca
 * dizer o que está errado.
 */
export class EmpresaAmbiguaError extends Error {
  constructor(readonly quantidade: number) {
    super(
      `Sua conta está vinculada a ${quantidade} empresas e o seletor de empresa ainda não existe. ` +
        `Fale com quem administra o sistema.`
    );
    this.name = "EmpresaAmbiguaError";
  }
}
