// The running app exposes its Tessera instance as window.tessera (for the console and tests).
declare global {
  interface Window { tessera: any }
}
export {};
