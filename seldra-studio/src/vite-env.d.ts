/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NETWORK?: string;
  readonly VITE_FACTORY_ADDRESS_ARC_TESTNET?: string;
  readonly VITE_FACTORY_DEPLOY_BLOCK_ARC_TESTNET?: string;
  readonly VITE_FACTORY_ADDRESS_ARC_MAINNET?: string;
  readonly VITE_FACTORY_DEPLOY_BLOCK_ARC_MAINNET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
