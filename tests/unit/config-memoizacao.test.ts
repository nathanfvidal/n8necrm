import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { prismaFalsoEscopavel } from "./helpers/prisma-falso-escopavel";

vi.mock("server-only", () => ({}));

/**
 * A memoização de `configDaEmpresa`, exercitada de VERDADE — e por que ela
 * precisa de um arquivo separado.
 *
 * ## O `cache` que roda sob Vitest não é o `cache` que roda no painel
 *
 * O pacote `react` publica DUAS implementações de `cache`, escolhidas pela
 * condição de exportação `react-server`. Medido nesta árvore (react 19.2.4):
 *
 * - `node_modules/react/cjs/react.development.js` — a que Vitest resolve —
 *   traz `exports.cache = function (fn) { return function () { return
 *   fn.apply(null, arguments); }; }`. Passa-fio: não memoiza NADA, por
 *   construção. É daí que sai o caso "duas chamadas fora de requisição fazem
 *   DUAS consultas" de `tests/unit/config-leitura.test.ts`, e é por isso que
 *   ele não é um defeito: é a implementação que aquele ambiente carrega.
 * - `node_modules/react/cjs/react.react-server.development.js` — a que o
 *   Next.js carrega num Server Component — lê o dispatcher em
 *   `ReactSharedInternals.A` e, quando ele existe, guarda um nó de cache POR
 *   ARGUMENTO: o corpo percorre `arguments` um a um, descendo num `Map`
 *   (valor primitivo) ou `WeakMap` (objeto) a cada posição. Sem dispatcher,
 *   ele também vira passa-fio (`if (!dispatcher) return fn.apply(...)`).
 *
 * Então: `config-leitura.test.ts` prova que a CORRETUDE não depende do cache, e
 * este arquivo prova que a MEMOIZAÇÃO existe e é chaveada pelo argumento.
 * Provar as duas coisas no mesmo arquivo não dá — `vi.mock` vale para o arquivo
 * inteiro, e as duas implementações de `cache` se excluem.
 *
 * ## Por que trocar o `react` inteiro em vez de simular um render
 *
 * A alternativa seria montar um render de Server Component real (fluxo do
 * `react-server-dom-*`), o que arrasta o pipeline de RSC inteiro para um teste
 * de unidade. O que importa aqui é o contrato de `cache`, e ele está no arquivo
 * citado acima — trocado por este mock, o `leitura.ts` executado é o MESMO, sem
 * nenhuma condicional de teste dentro dele.
 *
 * O que este arquivo NÃO prova, e é preciso dizer: que o Next.js instala esse
 * dispatcher uma vez por requisição. Isso é contrato do framework, não algo
 * medido aqui — medir exigiria o painel no ar. O que está medido é o que
 * `cache` faz DADO um dispatcher, e que trocar de dispatcher (a linha
 * `internos.A = ...` de cada caso) refaz a consulta.
 */
const requerir = createRequire(import.meta.url);
const CAMINHO_DO_REACT_DO_SERVIDOR = fileURLToPath(
  new URL("../../node_modules/react/cjs/react.react-server.development.js", import.meta.url),
);

const { companyFindUniqueOrThrowMock } = vi.hoisted(() => ({
  companyFindUniqueOrThrowMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: prismaFalsoEscopavel({
    company: { findUniqueOrThrow: companyFindUniqueOrThrowMock },
  }),
}));

vi.mock("react", async () => {
  const real = await vi.importActual<typeof import("react")>("react");
  // `createRequire` e não `import`: o caminho está fora do mapa `exports` do
  // pacote `react` (`ERR_PACKAGE_PATH_NOT_EXPORTED`, medido ao tentar), e a
  // única forma de alcançá-lo é pelo arquivo. O `require` do Node cacheia por
  // caminho absoluto, então este módulo é o MESMO objeto que o corpo do teste
  // lê logo abaixo — é isso que faz `internos.A` daqui e de lá serem a mesma
  // coisa.
  const doServidor = requerir(CAMINHO_DO_REACT_DO_SERVIDOR);
  return { ...real, cache: doServidor.cache };
});

const internos = requerir(CAMINHO_DO_REACT_DO_SERVIDOR)
  .__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as { A: unknown };

const { configDaEmpresa } = await import("../../src/core/config/leitura");
const { ConfigDaEmpresaInvalidaError } = await import("../../src/core/config/schema");

const EMPRESA_A = "cmp_a";
const EMPRESA_B = "cmp_b";

/**
 * Um "escopo de requisição": o dispatcher que `cache` procura em
 * `ReactSharedInternals.A`. `getCacheForType(criar)` guarda uma instância por
 * tipo — é o balde que MORRE junto com a requisição, e trocá-lo é o que simula
 * uma requisição nova.
 */
function requisicaoNova() {
  const porTipo = new Map<unknown, unknown>();
  return {
    getCacheForType<T>(criar: () => T): T {
      if (!porTipo.has(criar)) porTipo.set(criar, criar());
      return porTipo.get(criar) as T;
    },
    cacheSignal: () => null,
  };
}

beforeEach(() => {
  companyFindUniqueOrThrowMock.mockReset();
  internos.A = requisicaoNova();
});

afterEach(() => {
  // Devolvido a `null` de propósito: um dispatcher pendurado aqui vazaria para
  // qualquer outro código que rodasse depois neste worker, que é a forma de
  // estado global que este ciclo inteiro existe para não ter.
  internos.A = null;
});

describe("configDaEmpresa — memoização por requisição", () => {
  it("duas chamadas com o MESMO companyId na mesma requisição fazem UMA consulta", async () => {
    companyFindUniqueOrThrowMock.mockResolvedValue({ nome: "Empresa A", config: null });

    const primeira = await configDaEmpresa(EMPRESA_A);
    const segunda = await configDaEmpresa(EMPRESA_A);

    expect(companyFindUniqueOrThrowMock).toHaveBeenCalledTimes(1);
    // `toBe` e não `toEqual`: `cache` guarda a Promise devolvida, então as duas
    // chamadas resolvem para o MESMO objeto. Igualdade estrutural aqui passaria
    // até se a segunda chamada tivesse consultado de novo.
    expect(segunda).toBe(primeira);
  });

  it("companyId DIFERENTE é chave diferente — duas consultas, duas respostas", async () => {
    // A segunda metade, e a que separa `cache()` bem usado de vazamento entre
    // empresas: se a chave fosse um balde só por requisição, a empresa B
    // receberia a config da A e este caso ficaria vermelho na linha do `nome`.
    companyFindUniqueOrThrowMock
      .mockResolvedValueOnce({
        nome: "Empresa A",
        config: {
          corPrimaria: "#0F62FE",
          fonte: null,
          logoClaro: null,
          logoEscuro: null,
          modulos: ["whatsapp"],
        },
      })
      .mockResolvedValueOnce({
        nome: "Empresa B",
        config: {
          corPrimaria: "#E11D48",
          fonte: null,
          logoClaro: null,
          logoEscuro: null,
          modulos: [],
        },
      });

    const a = await configDaEmpresa(EMPRESA_A);
    const b = await configDaEmpresa(EMPRESA_B);

    expect(companyFindUniqueOrThrowMock).toHaveBeenCalledTimes(2);
    expect(a.nome).toBe("Empresa A");
    expect(b.nome).toBe("Empresa B");
    expect(a.marca.corPrimaria).toBe("#0F62FE");
    expect(b.marca.corPrimaria).toBe("#E11D48");
    expect(a.modulos).toEqual(["whatsapp"]);
    expect(b.modulos).toEqual([]);
  });

  it("a memoização NÃO atravessa requisições — dispatcher novo, consulta nova", async () => {
    companyFindUniqueOrThrowMock.mockResolvedValue({ nome: "Empresa A", config: null });
    await configDaEmpresa(EMPRESA_A);
    expect(companyFindUniqueOrThrowMock).toHaveBeenCalledTimes(1);

    // A empresa trocou de nome entre uma requisição e a seguinte. Se o cache
    // sobrevivesse à requisição, a segunda leitura devolveria o nome velho — e
    // num processo de longa duração (a Vercel reaproveita a instância) isso é
    // exatamente como dado de uma requisição aparece na de outra pessoa.
    companyFindUniqueOrThrowMock.mockResolvedValue({ nome: "Empresa A II", config: null });
    internos.A = requisicaoNova();

    const depois = await configDaEmpresa(EMPRESA_A);
    expect(companyFindUniqueOrThrowMock).toHaveBeenCalledTimes(2);
    expect(depois.nome).toBe("Empresa A II");
  });

  it("config quebrada RECUSA — e a recusa é memoizada junto, sem reconsultar", async () => {
    // A decisão está documentada em `leitura.ts` ("Config quebrada RECUSA"): o
    // erro nasce em `mesclarConfig` (Task 2) e sobe daqui sem tratamento. Este
    // caso fixa as duas metades: que ele sobe, e que dentro de UMA requisição a
    // leitura não vira uma consulta por chamador só para falhar de novo.
    companyFindUniqueOrThrowMock.mockResolvedValue({
      nome: "Empresa A",
      config: {
        corPrimaria: "#808080",
        fonte: null,
        logoClaro: null,
        logoEscuro: null,
        modulos: [],
      },
    });

    await expect(configDaEmpresa(EMPRESA_A)).rejects.toThrow(ConfigDaEmpresaInvalidaError);
    await expect(configDaEmpresa(EMPRESA_A)).rejects.toThrow(ConfigDaEmpresaInvalidaError);

    expect(companyFindUniqueOrThrowMock).toHaveBeenCalledTimes(1);
  });
});
