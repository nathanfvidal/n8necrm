// @vitest-environment jsdom
//
// O layout do painel é um Server Component assíncrono: chamado direto como
// função, sem framework de rota, o retorno é um elemento React que dá para
// `render()` no jsdom. Mesmo padrão de `fluxos-pages-gate.test.tsx` e
// `login-page-guard.test.tsx`.
//
// O que este arquivo trava é a COMPOSIÇÃO da marca por empresa, que é onde ela
// falha em silêncio:
//
// 1. O segundo `<style>` precisa carregar a cor da EMPRESA. Se alguém trocar
//    `configDaEmpresa` por `client.marca` de novo, a tela continua bonita e o
//    white-label some.
// 2. O elemento de conteúdo precisa das DUAS classes de fonte. A `.variable`
//    redefine `--font-marca` naquele elemento; sem `font-sans`, o
//    `font-family` computado herdado do `<html>` (globals.css:126-128)
//    continua valendo e a redefinição não tem efeito NENHUM. Nada na tela
//    denuncia isso: a fonte do arquivo simplesmente continua.
// 3. E a metade oposta, que é a que deixa "não aplicar marca nenhuma" passar
//    por correção: a empresa SEM sobreposição precisa continuar vendo
//    EXATAMENTE o padrão do arquivo. Um layout que ignorasse `config` e
//    emitisse sempre `client.marca` passaria em (1) só se a comparação fosse
//    unilateral; um layout que não emitisse nada passaria em (3) se ela não
//    existisse. As duas juntas é que fecham.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("server-only", () => ({}));

const { usuarioAtualMock, configDaEmpresaMock, listarNotificacoesMock } = vi.hoisted(() => ({
  usuarioAtualMock: vi.fn(),
  configDaEmpresaMock: vi.fn(),
  listarNotificacoesMock: vi.fn(async () => []),
}));

vi.mock("@/core/auth/session", () => ({ usuarioAtual: () => usuarioAtualMock() }));
vi.mock("@/core/config/leitura", () => ({ configDaEmpresa: (id: string) => configDaEmpresaMock(id) }));
vi.mock("@/core/notifications/dispatch", () => ({
  listarNotificacoesNaoLidas: () => listarNotificacoesMock(),
}));
vi.mock("next/headers", () => ({ headers: async () => new Map() }));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
  usePathname: () => "/",
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/core/notifications/actions", () => ({ marcarNotificacaoComoLidaAction: vi.fn() }));
vi.mock("@/core/auth/actions", () => ({ sairAction: vi.fn() }));
// `next/font/google` NÃO funciona sob Vitest: `Geist({...})` lança
// `TypeError: Geist is not a function`, porque as funções de fonte são
// substituídas por um plugin do bundler do Next e, fora dele, o módulo não
// exporta função nenhuma. Medido em 2026-08-20 com um teste-sonda descartável,
// não deduzido.
//
// Consequência honesta: este arquivo prova a COMPOSIÇÃO — qual classe vai em
// qual elemento, junto de qual outra classe — e NÃO o mapeamento nome→fonte.
// O mapeamento real só é observável num navegador, e por isso o caso da fonte
// em `tests/e2e/marca-por-empresa.spec.ts` é load-bearing, não decoração.
vi.mock("@/lib/tema/fontes", () => ({
  fonteDaMarca: (nome: string) => ({ variable: `fonte-${nome.replace(/\s+/g, "-")}` }),
}));
// `next-themes` monta um provider que depende de `window.matchMedia`; o
// componente real não acrescenta nada ao que este arquivo mede.
//
// `useTheme` entra no mesmo mock e NÃO é excesso de zelo: `vi.mock` substitui o
// módulo INTEIRO, e `PainelNav` renderiza `ThemeToggle`, que faz
// `useTheme()` (src/components/theme-toggle.tsx:34). Sem esta linha os cinco
// casos de render morrem com `useTheme is not a function` — medido na execução
// RED desta task, não previsto. `painel-nav.test.tsx` não tropeça nisso porque
// não mocka `next-themes` de forma alguma; aqui o mock existe pelo
// `matchMedia` do PROVIDER, e leva o hook junto por consequência.
vi.mock("next-themes", () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useTheme: () => ({ resolvedTheme: "dark", setTheme: vi.fn() }),
}));

const PainelLayout = (await import("../../src/app/(painel)/layout")).default;
const { generateMetadata } = await import("../../src/app/(painel)/layout");
const { client } = await import("../../config/client");

const EMPRESA = "cmp_a";

// A forma de `UsuarioAtivo` (`src/core/auth/usuario-ativo.ts`), NÃO a de `User`
// do Prisma. `User` não tem `companyId`, e um mock com a forma dele deixaria
// este arquivo verde repassando `companyId: undefined` para `configDaEmpresa` —
// exatamente o defeito que as Tasks anteriores deste ciclo acharam três vezes.
const USUARIO = {
  id: "u1",
  nome: "Rodrigo",
  email: "r@x.test",
  ativo: true,
  companyId: EMPRESA,
  papel: "ADMIN",
};

function configComCor(corPrimaria: string, fonte: "Geist" | "Inter" | "Manrope" | "IBM Plex Sans") {
  return { nome: "Empresa da Sessao", marca: { corPrimaria, fonte }, modulos: ["whatsapp"] };
}

beforeEach(() => {
  usuarioAtualMock.mockReset();
  configDaEmpresaMock.mockReset();
  usuarioAtualMock.mockResolvedValue(USUARIO);
});

afterEach(() => cleanup());

describe("(painel)/layout — a marca da empresa", () => {
  it("emite um `<style>` com a cor da EMPRESA, e não a do arquivo", async () => {
    // `#0F62FE` é azul; o arquivo é `#6D4AFF`, roxo. Os dois passam no piso de
    // croma, então o que separa um do outro na saída é só a origem do valor.
    configDaEmpresaMock.mockResolvedValue(configComCor("#0F62FE", "Geist"));

    const { container } = render(await PainelLayout({ children: <div /> }));
    const estilo = container.querySelector("style");

    expect(estilo, "o painel não emitiu nenhum <style>").toBeTruthy();
    const css = estilo!.innerHTML;

    expect(css).toContain(":root:root{");
    expect(css).toContain(":root:root.dark{");

    // A comparação é contra o CSS que `derivarTema` produz para CADA cor, e
    // não contra uma string literal: literal envelheceria junto com a paleta.
    const { derivarTema } = await import("../../src/lib/tema");
    expect(css).toBe(derivarTema({ corPrimaria: "#0F62FE" }));
    expect(css).not.toBe(derivarTema({ corPrimaria: client.marca.corPrimaria }));
  });

  it("a empresa SEM sobreposição continua vendo exatamente o padrão do arquivo", async () => {
    // A metade oposta do caso acima, e a que decide se "correção" é aplicar a
    // marca ou deixar de aplicar marca nenhuma. `configDaEmpresa` devolve o
    // padrão de `config/client.ts` já mesclado quando a empresa não tem linha
    // de `CompanyConfig` (`mesclarConfig`, `core/config/schema.ts`) — aqui esse
    // retorno é encenado, porque a mescla já tem prova própria em
    // `config-schema.test.ts`. O que ESTE caso trava é o elo seguinte: o layout
    // não pode "melhorar" nem substituir o que recebeu.
    //
    // Sem ele, um layout que emitisse `<style>` vazio, ou nenhum, passaria no
    // caso anterior desde que a string só não fosse a do arquivo.
    configDaEmpresaMock.mockResolvedValue({
      nome: "Empresa Sem Linha",
      marca: { corPrimaria: client.marca.corPrimaria, fonte: client.marca.fonte },
      modulos: client.modulos,
    });

    const { container } = render(await PainelLayout({ children: <div /> }));

    const { derivarTema } = await import("../../src/lib/tema");
    expect(container.querySelector("style")!.innerHTML).toBe(derivarTema(client.marca));
    expect(container.querySelector(`.fonte-${client.marca.fonte}`)).toBeTruthy();
  });

  it("o texto do `<style>` não contém `<` — nenhum texto do config chega ali", async () => {
    // O layout raiz apoiava a segurança do `dangerouslySetInnerHTML` no fato de
    // `tema` ser constante de build de arquivo versionado. Aqui o valor vem do
    // BANCO, e o que fecha não é a origem: `derivarTema` só emite números
    // (`hexParaOklch` lança fora de #RRGGBB, `formatarOklch` produz numerais), e
    // o valor ainda atravessa `marcaSchema` na leitura. Este caso é a segunda
    // trava, executável.
    configDaEmpresaMock.mockResolvedValue(configComCor("#0F62FE", "Geist"));

    const { container } = render(await PainelLayout({ children: <div /> }));
    expect(container.querySelector("style")!.innerHTML).not.toContain("<");
  });

  it("o elemento de conteúdo tem AS DUAS classes de fonte", async () => {
    configDaEmpresaMock.mockResolvedValue(configComCor("#0F62FE", "Manrope"));

    const { container } = render(await PainelLayout({ children: <div /> }));

    // `fonte-Manrope` é o que o mock de `fonteDaMarca` devolve (topo do
    // arquivo). A classe REAL do `next/font` é opaca (`__variable_xxxxx`) e não
    // existe fora do bundler do Next.
    const alvo = container.querySelector(".fonte-Manrope");
    expect(alvo, "nenhum elemento recebeu a classe da fonte da empresa").toBeTruthy();

    // `font-sans` é a metade que ninguém lembra: sem ela, `--font-marca` é
    // redefinida naquele elemento e o `font-family` computado, herdado do
    // `<html>`, continua o do arquivo. A fonte da empresa não aparece, e nada
    // na tela diz por quê.
    expect(alvo!.className.split(/\s+/)).toContain("font-sans");
  });

  it("a fonte muda quando a empresa muda", async () => {
    configDaEmpresaMock.mockResolvedValue(configComCor("#0F62FE", "Inter"));
    const { container } = render(await PainelLayout({ children: <div /> }));

    expect(container.querySelector(".fonte-Inter")).toBeTruthy();
    expect(container.querySelector(".fonte-Manrope")).toBeNull();
  });
});

describe("(painel)/layout — generateMetadata", () => {
  it("usa o nome da EMPRESA quando há sessão", async () => {
    configDaEmpresaMock.mockResolvedValue(configComCor("#0F62FE", "Geist"));
    await expect(generateMetadata()).resolves.toEqual({
      title: "Empresa da Sessao",
      description: "Painel de gestão — Empresa da Sessao",
    });
  });

  it("config inválida derruba o render, mesmo com a metadata degradando", async () => {
    // O `catch` de `generateMetadata` envolve as DUAS chamadas, então uma
    // config inválida também degrada o TÍTULO para o nome do produto. Isso
    // poderia ser lido como "config inválida deixou de recusar" — e não é: quem
    // recusa é o componente, que chama `configDaEmpresa` sem guarda. Este caso
    // afirma as duas metades na mesma corrida, porque só a de cima passaria
    // sozinha num layout que engolisse o erro em qualquer um dos dois lugares.
    const invalida = new Error("Config da empresa cmp_a é inválida");
    configDaEmpresaMock.mockRejectedValue(invalida);

    await expect(PainelLayout({ children: <div /> })).rejects.toThrow(invalida);
    await expect(generateMetadata()).resolves.toEqual({
      title: client.nome,
      description: `Painel de gestão — ${client.nome}`,
    });
  });

  it("cai no nome do PRODUTO quando não há sessão — e não lança", async () => {
    // `generateMetadata` roda em paralelo ao render. Uma sessão que morre no
    // meio faria `usuarioAtual()` rejeitar aqui, e uma rejeição não tratada em
    // metadata vira tela de erro genérica com digest em vez de ida para o
    // login. Mesmo raciocínio do `try/catch` de `usuarioAtualOuLogin`.
    usuarioAtualMock.mockRejectedValue(new Error("Não autenticado"));
    await expect(generateMetadata()).resolves.toEqual({
      title: client.nome,
      description: `Painel de gestão — ${client.nome}`,
    });
    expect(configDaEmpresaMock).not.toHaveBeenCalled();
  });
});
