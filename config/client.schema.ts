import { z } from "zod";

export const campoSchema = z.object({
  nome: z.string(),
  tipo: z.enum(["texto", "numero", "opcao", "booleano"]),
  obrigatorio: z.boolean().default(false),
  filtravel: z.boolean().default(false),
  opcoes: z.array(z.string()).optional(),
});

export const clientConfigSchema = z.object({
  nome: z.string(),
  vertical: z.string(),
  marca: z.object({
    logo: z.string(),
    corPrimaria: z.string(),
    fonte: z.string(),
  }),
  modulos: z.array(z.enum(["catalog", "analytics", "automation", "campaigns", "finance"])),
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
