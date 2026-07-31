import { describe, it, expect } from "vitest";
import type { Storage } from "../../src/lib/storage";

class FakeStorage implements Storage {
  private arquivos = new Map<string, { file: Buffer; contentType: string }>();

  async upload(path: string, file: Buffer, contentType: string): Promise<string> {
    this.arquivos.set(path, { file, contentType });
    return `https://fake-storage.local/${path}`;
  }

  async delete(path: string): Promise<void> {
    this.arquivos.delete(path);
  }

  has(path: string): boolean {
    return this.arquivos.has(path);
  }
}

describe("Storage (contrato)", () => {
  it("upload retorna uma URL contendo o path", async () => {
    const fake = new FakeStorage();
    const url = await fake.upload("itens/foto.webp", Buffer.from("dados"), "image/webp");
    expect(url).toContain("itens/foto.webp");
  });

  it("delete remove o arquivo previamente enviado", async () => {
    const fake = new FakeStorage();
    await fake.upload("itens/foto.webp", Buffer.from("dados"), "image/webp");
    await fake.delete("itens/foto.webp");
    expect(fake.has("itens/foto.webp")).toBe(false);
  });
});
