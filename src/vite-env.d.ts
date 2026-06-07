declare module '*.css' {
  const content: Record<string, string>;
  export default content;
}

interface ImportMetaEnv {
  readonly VITE_WDIO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
