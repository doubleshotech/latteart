import { useEffect } from "react";
import { CanvasStage } from "./canvas/CanvasStage";
import { ErrorToast } from "./components/ErrorToast";
import { LayerPanel } from "./components/LayerPanel";
import { MaskEditor } from "./components/MaskEditor";
import { PromptBar } from "./components/PromptBar";
import { SettingsDialog } from "./components/SettingsDialog";
import { Topbar } from "./components/Topbar";
import { UndoRedo } from "./components/UndoRedo";
import { ZoomControl } from "./components/ZoomControl";
import { useLLM } from "./stores/llmStore";
import { initProjectSync } from "./stores/projectStore";
import { useProviders } from "./stores/providersStore";

export default function App() {
  const refresh = useProviders((s) => s.refresh);
  const refreshLLM = useLLM((s) => s.refresh);

  useEffect(() => {
    void refresh();
    void refreshLLM();
    void initProjectSync();
  }, [refresh, refreshLLM]);

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
        minWidth: 1024,
      }}
    >
      <Topbar />
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <CanvasStage />
          <UndoRedo />
          <ZoomControl />
          <PromptBar />
          <MaskEditor />
        </div>
        <LayerPanel />
      </div>
      <SettingsDialog />
      <ErrorToast />
    </div>
  );
}
