"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

const semInscricao = () => () => {};

/**
 * Dois estados, sem "sistema" — `enableSystem={false}` no provider.
 *
 * `montado` evita erro de hidratação: no servidor não há como saber o tema
 * guardado, então o primeiro render precisa ser igual dos dois lados. Sem
 * isso, o React reclama de o ícone divergir.
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

  const escuro = resolvedTheme === "dark";

  return (
    <button
      type="button"
      aria-label={escuro ? "Usar tema claro" : "Usar tema escuro"}
      data-tema={montado ? resolvedTheme : undefined}
      onClick={() => setTheme(escuro ? "light" : "dark")}
      className="rounded-md p-2 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
    >
      {montado && escuro ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
