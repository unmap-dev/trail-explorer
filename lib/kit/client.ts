import { Unmap } from "@unmap/sdk";
import { API_KEY, GATEWAY } from "./config";

let instance: Unmap | null = null;

/**
 * The one SDK instance a demo talks to the gateway through. Demo code never calls `fetch` against
 * the API itself, so what the browser sends is exactly what a customer's code would send.
 * Null when no key is configured; the demo shows `<MissingKey>` instead of calling anything.
 */
export function getUnmap(): Unmap | null {
  if (!API_KEY) return null;
  instance ??= new Unmap({ key: API_KEY, gateway: GATEWAY });
  return instance;
}
