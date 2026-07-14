import { create } from "zustand";
import { client, type LLMEngine } from "../api/client";

/**
 * The LLM enhancement engines and their live availability, for the Settings
 * picker. Mirrors {@link import("./providersStore").useProviders} but for the
 * secondary (assist-only) axis. Ollama's URL is saved through the same
 * `/api/keys/:id` endpoint the image providers use.
 */
interface LLMState {
  engines: LLMEngine[];
  loaded: boolean;
  refresh: () => Promise<void>;
  setUrl: (id: string, value: string) => Promise<void>;
  clearUrl: (id: string) => Promise<void>;
}

export const useLLM = create<LLMState>((set, get) => ({
  engines: [],
  loaded: false,

  refresh: async () => {
    const res = await client.api.llm.$get();
    const data = await res.json();
    set({ engines: data, loaded: true });
  },

  setUrl: async (id, value) => {
    await fetch(`/api/keys/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value }),
    });
    await get().refresh();
  },

  clearUrl: async (id) => {
    await fetch(`/api/keys/${encodeURIComponent(id)}`, { method: "DELETE" });
    await get().refresh();
  },
}));
