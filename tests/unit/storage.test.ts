import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Storage } from "../../src/lib/storage";

// Bytes iniciais reais de cada formato — o mesmo que o navegador e o `file(1)`
// olham. Usar bytes de verdade (e não `Buffer.from("png")`) é o ponto: o
// teste tem que falhar se a conferência de assinatura for afrouxada.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0x1a, 0, 0, 0]),
  Buffer.from("WEBP", "ascii"),
  Buffer.from([0, 0, 0, 0]),
]);
const WAV_QUE_FINGE_SER_WEBP = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0x1a, 0, 0, 0]),
  Buffer.from("WAVE", "ascii"),
  Buffer.from([0, 0, 0, 0]),
]);
const PDF = Buffer.concat([Buffer.from("%PDF-", "ascii"), Buffer.from("1.7\n", "ascii")]);
const HTML_COM_SCRIPT = Buffer.from("<html><script>alert(1)</script></html>", "utf8");

class FakeStorage implements Storage {
  private arquivos = new Map<string, { file: Buffer; contentType: string }>();
  private contador = 0;

  // Mesmo contrato da implementação real desde a correção do achado 21: o
  // chamador manda a PASTA, o storage devolve o path COM o nome que ele
  // mesmo gerou. O fake não sorteia UUID (teste determinístico), só garante
  // que o nome não é do chamador.
  async upload(prefixo: string, file: Buffer, contentType: string): Promise<string> {
    const path = `${prefixo}/objeto-${++this.contador}`;
    this.arquivos.set(path, { file, contentType });
    return path;
  }

  async urlAssinada(path: string): Promise<string> {
    return `https://fake-storage.local/${path}?token=fake`;
  }

  async delete(path: string): Promise<void> {
    this.arquivos.delete(path);
  }

  has(path: string): boolean {
    return this.arquivos.has(path);
  }
}

describe("Storage (contrato)", () => {
  it("upload devolve o PATH, não uma URL — URL de bucket privado expira e não pode ser persistida", async () => {
    const fake = new FakeStorage();
    const retorno = await fake.upload("itens", WEBP, "image/webp");
    expect(retorno).toMatch(/^itens\//);
    expect(retorno).not.toContain("http");
  });

  it("urlAssinada devolve uma URL temporária para o path", async () => {
    const fake = new FakeStorage();
    const url = await fake.urlAssinada("itens/foto.webp");
    expect(url).toContain("itens/foto.webp");
  });

  it("delete remove o arquivo previamente enviado", async () => {
    const fake = new FakeStorage();
    const path = await fake.upload("itens", WEBP, "image/webp");
    await fake.delete(path);
    expect(fake.has(path)).toBe(false);
  });
});

// A suíte acima só exercita a lógica trivial do FakeStorage (nunca falha por
// construção). Esta suíte exercita a SupabaseStorage real, com o cliente
// @supabase/supabase-js mockado via vi.mock — sem rede, sem credenciais, sem
// bucket real — para garantir que uma regressão na implementação (bucket
// errado, contentType perdido, validação removida, erro engolido) derrube o
// teste.
const { createClientMock, fromMock, uploadMock, createSignedUrlMock, removeMock } = vi.hoisted(
  () => {
    const uploadMock = vi.fn();
    const createSignedUrlMock = vi.fn();
    const removeMock = vi.fn();
    const fromMock = vi.fn(() => ({
      upload: uploadMock,
      createSignedUrl: createSignedUrlMock,
      remove: removeMock,
    }));
    const createClientMock = vi.fn(() => ({ storage: { from: fromMock } }));
    return { createClientMock, fromMock, uploadMock, createSignedUrlMock, removeMock };
  }
);

// "server-only" só resolve para um no-op sob a condição de resolução
// "react-server", que o Next.js aplica no build de Server Components. Fora
// desse pipeline (aqui, sob Vitest) ele sempre lança, independente de quem
// importa — por isso é mockado apenas neste arquivo de teste. Isso não
// enfraquece a guarda em produção: o import real em src/lib/storage.ts
// continua intacto e só é substituído dentro deste processo de teste.
vi.mock("server-only", () => ({}));

vi.mock("@supabase/supabase-js", () => ({ createClient: createClientMock }));

const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;
const ORIGINAL_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function carregarModulo() {
  vi.resetModules();
  process.env.SUPABASE_URL = "https://exemplo.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-service-role-de-teste";
  return import("../../src/lib/storage");
}

async function criarSupabaseStorage(): Promise<Storage> {
  return (await carregarModulo()).storage;
}

describe("SupabaseStorage (implementação real, cliente Supabase mockado)", () => {
  beforeEach(() => {
    createClientMock.mockClear();
    fromMock.mockClear();
    uploadMock.mockReset();
    createSignedUrlMock.mockReset();
    removeMock.mockReset();
  });

  afterEach(() => {
    process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SUPABASE_SERVICE_ROLE_KEY;
  });

  it("upload usa o bucket crm-arquivos, repassa o contentType e devolve o path gerado", async () => {
    uploadMock.mockResolvedValue({ error: null });

    const storage = await criarSupabaseStorage();
    const retorno = await storage.upload("itens", PNG, "image/png");

    expect(fromMock).toHaveBeenCalledWith("crm-arquivos");
    // O path enviado ao Supabase é EXATAMENTE o devolvido: se divergissem,
    // quem guardasse o retorno apontaria para um objeto que não existe.
    expect(uploadMock).toHaveBeenCalledWith(
      retorno,
      expect.any(Buffer),
      // `objectContaining` com `upsert` ESCRITO: o Vitest ignora chave de
      // valor `undefined` mesmo em comparação exata, então afirmar
      // `{ contentType }` sozinho ficaria verde com `upsert` de volta em
      // `true`. É a armadilha medida nesta branch.
      expect.objectContaining({ contentType: "image/png", upsert: false })
    );
  });

  it("upload lança erro claro quando o cliente Supabase retorna erro", async () => {
    uploadMock.mockResolvedValue({ error: { message: "bucket indisponível" } });

    const storage = await criarSupabaseStorage();

    await expect(storage.upload("itens", PNG, "image/png")).rejects.toThrow(
      /Falha no upload.*bucket indisponível/
    );
  });

  // O estado real medido pela auditoria (F26/F27): ZERO buckets no projeto.
  // Este é o caso que descreve o que acontece HOJE se alguém ligar um
  // formulário de upload sem o dono ter criado `crm-arquivos` — falha
  // FECHADA, com a mensagem do Supabase visível, e nenhum byte em lugar
  // nenhum. O comentário no topo de `storage.ts` afirma isso; aqui está o
  // caso que o exercita.
  it("bucket inexistente falha fechado, com a mensagem do Supabase", async () => {
    uploadMock.mockResolvedValue({ error: { message: "Bucket not found" } });

    const storage = await criarSupabaseStorage();

    await expect(storage.upload("itens", PNG, "image/png")).rejects.toThrow(
      /Falha no upload.*Bucket not found/
    );
  });

  describe("validação de conteúdo — o content-type vem do cliente e não vale nada sozinho", () => {
    it("recusa arquivo cujo conteúdo não bate com o tipo declarado, sem chamar o Supabase", async () => {
      uploadMock.mockResolvedValue({ error: null });
      const storage = await criarSupabaseStorage();

      // O caso que importa: HTML com <script> rotulado como imagem. Se
      // entrasse no bucket, bastaria abrir o link para executar script.
      await expect(
        storage.upload("itens", HTML_COM_SCRIPT, "image/png")
      ).rejects.toThrow(/tipo de arquivo não permitido/);

      expect(uploadMock).not.toHaveBeenCalled();
    });

    it("recusa SVG mesmo sendo imagem — SVG é XML e executa script no navegador", async () => {
      const storage = await criarSupabaseStorage();
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

      await expect(storage.upload("itens", svg, "image/svg+xml")).rejects.toThrow(
        /tipo de arquivo não permitido/
      );
    });

    it("não confunde WAV com WEBP — os dois começam com RIFF", async () => {
      const storage = await criarSupabaseStorage();

      await expect(
        storage.upload("itens", WAV_QUE_FINGE_SER_WEBP, "image/webp")
      ).rejects.toThrow(/tipo de arquivo não permitido/);

      // E o WEBP de verdade passa.
      uploadMock.mockResolvedValue({ error: null });
      await expect(storage.upload("itens", WEBP, "image/webp")).resolves.toMatch(
        /^itens\/[0-9a-f-]{36}\.webp$/
      );
    });

    it("aceita os formatos da allowlist com assinatura correta", async () => {
      uploadMock.mockResolvedValue({ error: null });
      const storage = await criarSupabaseStorage();

      await expect(storage.upload("a", PNG, "image/png")).resolves.toMatch(/^a\/.+\.png$/);
      await expect(storage.upload("a", JPEG, "image/jpeg")).resolves.toMatch(/^a\/.+\.jpg$/);
    });

    it("recusa arquivo acima do limite de tamanho, sem chamar o Supabase", async () => {
      const { storage, TAMANHO_MAXIMO_BYTES } = await carregarModulo();
      const gigante = Buffer.concat([PNG, Buffer.alloc(TAMANHO_MAXIMO_BYTES)]);

      await expect(storage.upload("itens", gigante, "image/png")).rejects.toThrow(
        /acima do limite/
      );
      expect(uploadMock).not.toHaveBeenCalled();
    });
  });

  // Achado 21 da auditoria: `upload` recebia o path inteiro do chamador. Nome
  // de arquivo, na prática, é `file.name` do navegador — dado do usuário. Esta
  // suíte prova que o nome deixou de ser dele.
  describe("o nome do objeto é gerado aqui, não vem do chamador (achado 21)", () => {
    it("o chamador escolhe a PASTA; o nome é sorteado e traz a extensão do tipo validado", async () => {
      uploadMock.mockResolvedValue({ error: null });
      const storage = await criarSupabaseStorage();

      const path = await storage.upload("leads/lead-123", PNG, "image/png");

      expect(path).toMatch(/^leads\/lead-123\/[0-9a-f-]{36}\.png$/);
    });

    it("dois envios na mesma pasta NÃO colidem — nome sorteado, e upsert desligado", async () => {
      uploadMock.mockResolvedValue({ error: null });
      const storage = await criarSupabaseStorage();

      const primeiro = await storage.upload("leads/lead-123", PNG, "image/png");
      const segundo = await storage.upload("leads/lead-123", PNG, "image/png");

      expect(primeiro).not.toBe(segundo);
      // A metade que o nome sorteado sozinho não garante: com `upsert: true`,
      // um path repetido (colisão de UUID, ou reenvio do mesmo path por um
      // caminho futuro) apagaria o arquivo anterior em silêncio.
      for (const chamada of uploadMock.mock.calls) {
        expect(chamada[2]).toMatchObject({ upsert: false });
      }
    });

    it("a extensão descreve o CONTEÚDO validado, não o que o chamador quiser", async () => {
      uploadMock.mockResolvedValue({ error: null });
      const storage = await criarSupabaseStorage();

      // A pasta se chama `relatorio.html`? Não: `.` não está na allowlist de
      // caracteres do prefixo. E o arquivo, sendo PDF de verdade, sai `.pdf`.
      await expect(storage.upload("relatorio.html", PDF, "application/pdf")).rejects.toThrow(
        /caminho de arquivo inválido/
      );

      const path = await storage.upload("relatorios", PDF, "application/pdf");
      expect(path).toMatch(/\.pdf$/);
      expect(path).not.toContain("html");
    });

    it("a allowlist de MIME e o mapa de extensões não podem derivar", async () => {
      const { MIME_PERMITIDOS, EXTENSAO_POR_MIME } = await carregarModulo();

      // Sem esta linha, um módulo que exportasse conjunto vazio deixaria a
      // comparação verde por vacuidade — mesmo cuidado da trava de
      // `MODELOS_DE_TENANT` em `escopo-empresa.test.ts`.
      expect(MIME_PERMITIDOS.length).toBeGreaterThan(0);
      expect(Object.keys(EXTENSAO_POR_MIME).sort()).toEqual([...MIME_PERMITIDOS].sort());
      // Extensão vazia geraria objeto terminado em ponto.
      for (const ext of Object.values(EXTENSAO_POR_MIME)) {
        expect(ext).toMatch(/^[a-z0-9]{1,5}$/);
      }
    });

    it("o path devolvido por upload é aceito por urlAssinada e delete", async () => {
      uploadMock.mockResolvedValue({ error: null });
      createSignedUrlMock.mockResolvedValue({
        data: { signedUrl: "https://exemplo.supabase.co/sign?token=abc" },
        error: null,
      });
      removeMock.mockResolvedValue({ error: null });
      const storage = await criarSupabaseStorage();

      // A segunda metade da correção: o caminho legítimo inteiro continua
      // funcionando ponta a ponta. Se `nomeDeObjeto` gerasse algo que
      // `pathValido` recusa, o arquivo entraria no bucket e nunca mais
      // poderia ser lido nem apagado por este módulo.
      const path = await storage.upload("leads/lead-123", WEBP, "image/webp");

      await expect(storage.urlAssinada(path)).resolves.toContain("https://");
      await expect(storage.delete(path)).resolves.toBeUndefined();
      expect(removeMock).toHaveBeenCalledWith([path]);
    });
  });

  describe("a configuração exigida do bucket é valor, não promessa em comentário", () => {
    // O defeito que a auditoria pegou (F26/F27): a prosa afirmava limite e
    // allowlist configurados no Supabase, e não havia bucket nenhum. Nada
    // podia contradizer a prosa. Agora pode.
    it("é DERIVADA das mesmas constantes que o código aplica", async () => {
      const { CONFIGURACAO_EXIGIDA_DO_BUCKET, TAMANHO_MAXIMO_BYTES, MIME_PERMITIDOS } =
        await carregarModulo();

      expect(CONFIGURACAO_EXIGIDA_DO_BUCKET.limiteBytes).toBe(TAMANHO_MAXIMO_BYTES);
      expect(CONFIGURACAO_EXIGIDA_DO_BUCKET.mimesPermitidos).toEqual(MIME_PERMITIDOS);
      expect(CONFIGURACAO_EXIGIDA_DO_BUCKET.nome).toBe("crm-arquivos");
    });

    it("exige bucket PRIVADO — público dispensaria a URL assinada que este módulo gera", async () => {
      const { CONFIGURACAO_EXIGIDA_DO_BUCKET } = await carregarModulo();
      expect(CONFIGURACAO_EXIGIDA_DO_BUCKET.publico).toBe(false);
    });
  });

  describe("validação do prefixo — allowlist de caracteres, não lista de proibidos", () => {
    const prefixosRuins = [
      "../fora/do/bucket",
      "itens/../../etc",
      "/absoluto",
      "itens\\windows",
      "itens//vazio",
      "itens/./aqui",
      "",
      // Não eram recusados um a um pela versão anterior: entram na allowlist
      // por ausência, que é o ponto do desenho.
      "itens/foto.png",
      "itens/%2e%2e",
      "itens/a b",
      "itens/x?y",
      "itens/\0nulo",
    ];

    it.each(prefixosRuins)("recusa upload na pasta %j", async (ruim) => {
      const storage = await criarSupabaseStorage();
      await expect(storage.upload(ruim, PNG, "image/png")).rejects.toThrow(/caminho de arquivo inválido/);
      expect(uploadMock).not.toHaveBeenCalled();
    });

    it("aceita as pastas legítimas que os ids deste schema produzem", async () => {
      uploadMock.mockResolvedValue({ error: null });
      const storage = await criarSupabaseStorage();

      // `cuid()` (`[a-z0-9]`) e `uuid` (com `-`) são os dois formatos de id
      // que este projeto usa; recusar um deles quebraria o caso legítimo.
      for (const bom of ["leads", "leads/clz1abc23def", "conexoes/conn_9/anexos"]) {
        await expect(storage.upload(bom, PNG, "image/png")).resolves.toMatch(
          new RegExp(`^${bom}/`)
        );
      }
    });

    it("recusa também em urlAssinada e delete, não só no upload", async () => {
      const storage = await criarSupabaseStorage();

      await expect(storage.urlAssinada("../fora.png")).rejects.toThrow(/caminho de arquivo inválido/);
      await expect(storage.delete("../fora.png")).rejects.toThrow(/caminho de arquivo inválido/);

      expect(createSignedUrlMock).not.toHaveBeenCalled();
      expect(removeMock).not.toHaveBeenCalled();
    });
  });

  describe("urlAssinada", () => {
    it("pede uma URL assinada com a expiração padrão e devolve exatamente a do cliente", async () => {
      const { storage, EXPIRACAO_PADRAO_SEGUNDOS } = await carregarModulo();
      createSignedUrlMock.mockResolvedValue({
        data: { signedUrl: "https://exemplo.supabase.co/storage/v1/object/sign/crm-arquivos/x.png?token=abc" },
        error: null,
      });

      const url = await storage.urlAssinada("x.png");

      expect(fromMock).toHaveBeenCalledWith("crm-arquivos");
      expect(createSignedUrlMock).toHaveBeenCalledWith("x.png", EXPIRACAO_PADRAO_SEGUNDOS);
      expect(url).toBe(
        "https://exemplo.supabase.co/storage/v1/object/sign/crm-arquivos/x.png?token=abc"
      );
    });

    it("a expiração padrão é curta — link vazado não vira acesso permanente", async () => {
      const { EXPIRACAO_PADRAO_SEGUNDOS } = await carregarModulo();
      expect(EXPIRACAO_PADRAO_SEGUNDOS).toBeLessThanOrEqual(60 * 60);
    });

    it("lança erro claro quando o cliente falha", async () => {
      createSignedUrlMock.mockResolvedValue({ data: null, error: { message: "objeto não encontrado" } });
      const storage = await criarSupabaseStorage();

      await expect(storage.urlAssinada("x.png")).rejects.toThrow(/Falha ao gerar URL.*objeto não encontrado/);
    });
  });

  it("delete usa o bucket crm-arquivos e remove exatamente o path informado", async () => {
    removeMock.mockResolvedValue({ error: null });

    const storage = await criarSupabaseStorage();
    await storage.delete("itens/foto.png");

    expect(fromMock).toHaveBeenCalledWith("crm-arquivos");
    expect(removeMock).toHaveBeenCalledWith(["itens/foto.png"]);
  });

  it("delete lança erro claro quando o cliente Supabase retorna erro", async () => {
    removeMock.mockResolvedValue({ error: { message: "objeto não encontrado" } });

    const storage = await criarSupabaseStorage();

    await expect(storage.delete("itens/foto.png")).rejects.toThrow(/Falha ao remover.*objeto não encontrado/);
  });
});
