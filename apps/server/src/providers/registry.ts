import type { ImageProvider } from "@latteart/shared";
import { mockProvider } from "./mock.ts";

/**
 * Runtime registry of providers the backend can actually generate against.
 * Adding Fal / OpenAI / ComfyUI later is just another `registerProvider(...)`.
 */
const registry = new Map<string, ImageProvider>();

export function registerProvider(p: ImageProvider): void {
  registry.set(p.id, p);
}

export function getProvider(id: string): ImageProvider | undefined {
  return registry.get(id);
}

export function listProviders(): ImageProvider[] {
  return [...registry.values()];
}

// Built-in providers available with zero configuration.
registerProvider(mockProvider);
