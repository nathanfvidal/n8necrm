"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

const semInscricao = () => () => {};

/**
 * Dois estados, sem "sistema" — `enableSystem={false}` no provider.
 *
 * `montado` mantém a hidratação limpa: no servidor não há como saber o tema
 * guardado, então o primeiro render precisa ser igual dos dois lados. Em dev
 * a divergência vira aviso; em produção não vira nada — o React segue calado
 * e o atributo fica errado para sempre (o porquê está em `escuro`, abaixo).
 *
 * `useSyncExternalStore` em vez de `useEffect` + `setState`: o snapshot do
 * servidor é sempre `false`, o do cliente sempre `true`, sem inscrição
 * nenhuma — mesmo resultado do padrão "efeito que só liga uma flag no mount",
 * mas sem cair no `react-hooks/set-state-in-effect`, que este projeto trata
 * como erro de lint (ver o mesmo raciocínio em `notification-bell.tsx` e
 * `lead-note-form.tsx`: preferir uma forma que não precise de `setState`
 * dentro de um Effect a suprimir a regra).
 */
function useMontado() {
  return useSyncExternalStore(
    semInscricao,
    () => true,
    () => false,
  );
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const montado = useMontado();

  // `montado &&` não é enfeite: TUDO que depende do tema precisa passar por
  // aqui, senão o atributo congela com o valor do servidor e nunca mais muda.
  //
  // O `next-themes` devolve `resolvedTheme === undefined` no servidor — o
  // `getTheme` dele começa com `if (typeof window === "undefined") return`,
  // ignorando o `defaultTheme`. No cliente, o inicializador do `useState` lê
  // o localStorage já no PRIMEIRO render, então a hidratação renderiza
  // `"dark"`. Os dois lados divergem.
  //
  // O React não confere atributo nenhum durante a hidratação (só em dev, como
  // aviso). Ele adota o DOM do servidor e passa a acreditar que o vdom da
  // hidratação — o valor do cliente — é o que está lá. Como todo render
  // seguinte produz esse mesmo valor, o diff nunca acusa diferença e o
  // atributo NUNCA é corrigido. Não é atraso; é permanente.
  //
  // Com a guarda, os dois lados rendem o mesmo (`montado === false`) e a
  // troca acontece no re-render de depois do mount, que o React aplica. Foi
  // um e2e que pegou isto: o botão anunciava "Usar tema escuro" estando no
  // escuro, mentindo para quem usa leitor de tela.
  //
  // Sutileza medida na sabotagem, não deduzida: o congelamento só acontece
  // porque os FILHOS do botão hidratam sem divergir. Descasamento de filho é
  // estrutural, e o React 19 responde a ele re-renderizando a subárvore no
  // cliente — o que consertaria o `aria-label` de carona. Tirar a guarda do
  // ícone junto com a do rótulo faz o teste PASSAR, mascarando o defeito.
  // Por isso o ícone continua atrás de `montado`: ele não é só cosmético, é
  // o que mantém a hidratação limpa e o defeito visível se alguém reincidir.
  const escuro = montado && resolvedTheme === "dark";

  return (
    <button
      type="button"
      aria-label={escuro ? "Usar tema claro" : "Usar tema escuro"}
      onClick={() => setTheme(escuro ? "light" : "dark")}
      className="rounded-md p-2 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
    >
      {/* O `montado &&` é redundante com `escuro` hoje, e é de propósito:
          mantém a guarda do ícone independente da do rótulo. Simplificar para
          `escuro ?` faz a sabotagem do rótulo passar despercebida — ver o
          comentário acima. */}
      {montado && escuro ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
