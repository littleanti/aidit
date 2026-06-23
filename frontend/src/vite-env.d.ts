/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_ORIGIN?: string;
  readonly VITE_AUTH_SIGNUP_REQUIRED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
