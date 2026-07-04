import { create } from "zustand";
import { client, type Provider } from "../api/client";

interface ProvidersState {
  providers: Provider[];
  loaded: boolean;
  refresh: () => Promise<void>;
  setKey: (id: string, value: string) => Promise<void>;
  removeKey: (id: string) => Promise<void>;
}

export const useProviders = create<ProvidersState>((set, get) => ({
  providers: [],
  loaded: false,

  refresh: async () => {
    const res = await client.api.providers.$get();
    const data = await res.json();
    set({ providers: data, loaded: true });
  },

  setKey: async (id, value) => {
    await fetch(`/api/keys/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value }),
    });
    await get().refresh();
  },

  removeKey: async (id) => {
    await fetch(`/api/keys/${encodeURIComponent(id)}`, { method: "DELETE" });
    await get().refresh();
  },
}));
