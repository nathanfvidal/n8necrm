import type { Role } from "@prisma/client";

/**
 * Rótulos dos papéis em português, para as telas.
 *
 * Separado do enum do Prisma de propósito: `Role` são os valores gravados no
 * banco (`ADMIN`, `GESTOR`, `VENDEDOR`) e mudá-los exigiria migração, então
 * eles nunca deveriam aparecer crus para quem usa o sistema. Um só lugar com
 * a tradução evita a tela de criação e a tabela discordarem entre si.
 *
 * A ordem também importa: é a ordem em que os papéis aparecem nos `<select>`,
 * do menos para o mais poderoso, para que ADMIN nunca seja a opção que sobra
 * por descuido de quem só apertou Enter.
 */
export const PAPEIS: ReadonlyArray<{ valor: Role; rotulo: string; descricao: string }> = [
  { valor: "VENDEDOR", rotulo: "Vendedor", descricao: "Cria e move leads" },
  { valor: "GESTOR", rotulo: "Gestor", descricao: "Tudo do vendedor, mais dashboard geral e exportação" },
  { valor: "ADMIN", rotulo: "Administrador", descricao: "Tudo, incluindo gerenciar a equipe" },
];

export function rotuloDoPapel(papel: Role): string {
  return PAPEIS.find((p) => p.valor === papel)?.rotulo ?? papel;
}
