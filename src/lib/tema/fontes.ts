import { Geist, Inter, Manrope, IBM_Plex_Sans } from "next/font/google";

import { FONTES } from "../../../config/client.schema";

/**
 * Lista FECHADA porque o CSP tem `font-src 'self'`: a fonte precisa estar
 * empacotada no build, e `next/font` só empacota o que é importado
 * estaticamente. Fonte digitada livremente no config não teria como chegar
 * ao navegador.
 *
 * As quatro entram no bundle e só a escolhida recebe a variável — custo
 * irrelevante para quatro fontes, e evita um passo de geração de código.
 *
 * `FONTES` vem do schema e não é redigitada aqui: o `Record` abaixo é tipado
 * por ela, então acrescentar uma fonte na lista sem carregá-la aqui **não
 * compila**. Duas listas soltas divergiriam em silêncio.
 *
 * As quatro chamadas moram em consts próprias, de nível de módulo, e não
 * dentro do literal do `Record` abaixo: o plugin do `next/font` exige isso —
 * "Font loaders must be called and assigned to a const in the module scope"
 * — e recusa o build se a chamada estiver aninhada em outra expressão (achado
 * rodando `npm run build`, não deduzido).
 */
type NomeDeFonte = (typeof FONTES)[number];

const geist = Geist({ variable: "--font-marca", subsets: ["latin"] });
const inter = Inter({ variable: "--font-marca", subsets: ["latin"] });
const manrope = Manrope({ variable: "--font-marca", subsets: ["latin"] });
const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-marca",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const POR_NOME: Record<NomeDeFonte, { variable: string }> = {
  Geist: geist,
  Inter: inter,
  Manrope: manrope,
  "IBM Plex Sans": ibmPlexSans,
};

export function fonteDaMarca(nome: NomeDeFonte) {
  return POR_NOME[nome];
}
