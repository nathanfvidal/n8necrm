import { z } from "zod";

import { hexParaOklch } from "../src/lib/tema/cor";
import { CROMA_MINIMO } from "../src/lib/tema/paleta";

export const campoSchema = z.object({
  nome: z.string(),
  tipo: z.enum(["texto", "numero", "opcao", "booleano"]),
  obrigatorio: z.boolean().default(false),
  filtravel: z.boolean().default(false),
  opcoes: z.array(z.string()).optional(),
});

/** Lista FECHADA por causa do CSP: `font-src 'self'` obriga a empacotar no build. */
export const FONTES = ["Geist", "Inter", "Manrope", "IBM Plex Sans"] as const;

export const marcaSchema = z.object({
  nome: z.string().min(1),
  corPrimaria: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Cor da marca precisa ser #RRGGBB")
    .refine(
      // `.regex()` e `.refine()` são checks independentes: o Zod não para no
      // primeiro que falha, então um hex malformado (ex.: "0F62FE", sem `#`)
      // chega aqui mesmo tendo reprovado o regex acima. `hexParaOklch` LANÇA
      // para qualquer coisa fora de `#RRGGBB` — sem o try/catch essa exceção
      // escapa de `safeParse` como erro não tratado, em vez de virar
      // `success: false`. Descoberto rodando o teste "recusa hex malformado",
      // não deduzido.
      (hex) => {
        try {
          return hexParaOklch(hex).C >= CROMA_MINIMO;
        } catch {
          return false;
        }
      },
      `Cor da marca tem croma abaixo de ${CROMA_MINIMO}: é cinza na prática. ` +
        `Abaixo desse piso as superfícies derivadas ficam indistinguíveis de ` +
        `neutro e o white-label para de funcionar em silêncio.`,
    ),
  fonte: z.enum(FONTES),
  /** Opcional: fork sem arquivo de logo mostra o nome do cliente em texto. */
  logo: z.string().startsWith("/").optional(),
});

export const clientConfigSchema = z.object({
  nome: z.string(),
  vertical: z.string(),
  marca: marcaSchema,
  modulos: z.array(z.enum(["catalog", "analytics", "automation", "campaigns", "finance", "whatsapp"])),
  entidade: z.object({
    singular: z.string(),
    plural: z.string(),
    campos: z.array(campoSchema),
  }),
  funil: z.array(z.string()).min(1),
  whatsapp: z.object({
    numero: z.string(),
    mensagem: z.string(),
  }),
});

export type ClientConfig = z.infer<typeof clientConfigSchema>;
