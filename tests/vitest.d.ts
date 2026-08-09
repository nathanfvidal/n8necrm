declare module "vitest" {
  interface Assertion {
    toBeInTheDocument(): void;
  }
  interface AsymmetricMatchersContaining {
    toBeInTheDocument(): void;
  }
}

declare module "vitest" {
  interface Assertion {
    toHaveAttribute(attr: string, value?: string): void;
  }
  interface AsymmetricMatchersContaining {
    toHaveAttribute(attr: string, value?: string): void;
  }
}
