import { useEffect } from "react";
import { CanvasStage } from "./canvas/CanvasStage";
import { ConnectionOverlay } from "./components/ConnectionOverlay";
import { ErrorToast } from "./components/ErrorToast";
import { LayerMaskEditor } from "./components/LayerMaskEditor";
import { LayerPanel } from "./components/LayerPanel";
import { MaskEditor } from "./components/MaskEditor";
import { PromptBar } from "./components/PromptBar";
import { SettingsDialog } from "./components/SettingsDialog";
import { Topbar } from "./components/Topbar";
import { UndoRedo } from "./components/UndoRedo";
import { ZoomControl } from "./components/ZoomControl";
import { useLLM } from "./stores/llmStore";
import { initProjectSync, useProject } from "./stores/projectStore";
import { useProviders } from "./stores/providersStore";
import { useStyles } from "./stores/stylesStore";

export default function App() {
  const refresh = useProviders((s) => s.refresh);
  const refreshLLM = useLLM((s) => s.refresh);
  const refreshStyles = useStyles((s) => s.refresh);
  const connection = useProject((s) => s.connection);

  useEffect(() => {
    void initProjectSync();
  }, []);

  // The catalogs come from the same backend as the projects and, unlike the
  // project loader, they don't retry. Fetching on mount keeps a healthy boot
  // parallel; fetching again once the connection is up is what makes a boot
  // against a down backend recover into a usable studio — otherwise it comes
  // back with an empty provider picker and no styles until a manual reload.
  useEffect(() => {
    if (connection === "offline") return;
    void refresh();
    void refreshLLM();
    void refreshStyles();
  }, [connection, refresh, refreshLLM, refreshStyles]);

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
          <LayerMaskEditor />
        </div>
        <LayerPanel />
      </div>
      <SettingsDialog />
      <ErrorToast />
      <ConnectionOverlay />
    </div>
  );
}
