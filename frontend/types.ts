declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface ProcessEnv {
      CONFIG: Record<string, string>;
    }
  }
}

export {};
