/// <reference types="vite/client" />

import type { NetworkRepairApi } from "../../shared/contracts";

declare global {
  interface Window {
    networkRepair: NetworkRepairApi;
  }
}

export {};
