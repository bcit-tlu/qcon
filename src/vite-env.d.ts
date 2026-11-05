// SPDX-License-Identifier: MPL-2.0
// Vite handles .css imports; this silences TS side-effect-import errors.
declare module "*.css";

// injected by vite.config.ts at build time
declare const __APP_VERSION__: string;
