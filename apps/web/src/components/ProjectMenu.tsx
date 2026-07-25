import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { useGeneration } from "../stores/generationStore";
import {
  createProject,
  deleteProject,
  duplicateProject,
  fetchProjects,
  renameProject,
  switchProject,
  useProject,
} from "../stores/projectStore";

/**
 * The project switcher: the open project's name in the topbar, opening to the
 * list of projects on disk plus New / Rename / Duplicate / Delete.
 *
 * Switching is blocked while a generation runs — a job in flight drops its
 * result onto whatever layers exist when it lands, which would be the wrong
 * project's. Same reason `busy` gates undo/redo.
 */

/** "2m ago" / "yesterday" / "Jul 21" — coarse on purpose; this is a whisper. */
function relativeTime(ms: number): string {
  const secs = Math.round((Date.now() - ms) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const btnBase: React.CSSProperties = {
  height: 30,
  padding: "0 13px",
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 500,
  fontFamily: "inherit",
  cursor: "pointer",
};
const ghostBtn: React.CSSProperties = {
  ...btnBase,
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  color: "var(--text)",
};
const accentBtn: React.CSSProperties = {
  ...btnBase,
  background: "var(--accent)",
  border: "1px solid var(--accent)",
  color: "var(--accent-fg)",
};
const dangerBtn: React.CSSProperties = {
  ...btnBase,
  background: "#f0616d",
  border: "1px solid #f0616d",
  color: "#1a0507",
};
/** The shared dialog chrome sizes for the big Settings modal; these are small. */
const smallDialog: React.CSSProperties = { width: 380, padding: 18 };

function Thumb({ src }: { src: string | null }) {
  return (
    <span
      style={{
        width: 34,
        height: 26,
        flex: "none",
        borderRadius: 4,
        border: "1px solid var(--border)",
        background: "var(--surface-canvas)",
        backgroundImage: src ? `url(${src})` : undefined,
        backgroundSize: "contain",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "center",
      }}
    />
  );
}

export function ProjectMenu() {
  const id = useProject((s) => s.id);
  const name = useProject((s) => s.name);
  const projects = useProject((s) => s.projects);
  const switching = useProject((s) => s.switching);
  const busy = useGeneration((s) => s.busy);
  const setError = useGeneration((s) => s.setError);

  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Refresh on open so timestamps and thumbnails reflect the latest save.
  const onOpenChange = (open: boolean) => {
    if (open) void fetchProjects();
  };

  // Keep the rename draft in step with the project actually open.
  useEffect(() => {
    setDraftName(name);
  }, [name]);

  const guard = async (label: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (err) {
      setError((err as Error).message || `Couldn't ${label} the project.`);
    }
  };

  const blocked = busy || switching;
  const blockedNote = busy
    ? "Wait for the current generation to finish"
    : switching
      ? "Switching…"
      : undefined;

  return (
    <>
      <DropdownMenu.Root onOpenChange={onOpenChange}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            title="Project — switch, rename, duplicate or delete"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 26,
              maxWidth: 220,
              padding: "0 8px",
              borderRadius: 7,
              background: "transparent",
              border: "1px solid transparent",
              color: "var(--text)",
              fontSize: 12.5,
              fontWeight: 500,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {name}
            </span>
            <ChevronDown size={13} strokeWidth={1.9} color="var(--text-faint)" />
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="dd-content"
            sideOffset={8}
            align="start"
            style={{ minWidth: 260, maxWidth: 320 }}
          >
            <div
              style={{
                fontSize: 10.5,
                textTransform: "uppercase",
                letterSpacing: ".06em",
                color: "var(--text-faint)",
                padding: "4px 9px 6px",
              }}
            >
              Projects
            </div>

            <div style={{ maxHeight: 268, overflowY: "auto" }}>
              {projects.map((p) => (
                <DropdownMenu.Item
                  key={p.id}
                  className="dd-item"
                  disabled={blocked && p.id !== id}
                  title={p.id !== id ? blockedNote : undefined}
                  onSelect={() => void guard("open", () => switchProject(p.id))}
                  style={{
                    alignItems: "flex-start",
                    opacity: blocked && p.id !== id ? 0.5 : 1,
                  }}
                >
                  <Thumb src={p.thumbnail} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: "block",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.name}
                    </span>
                    <span style={{ fontSize: 10.5, color: "var(--text-faint)" }}>
                      {p.layerCount === 0 ? "empty" : `${p.layerCount} layers`} ·{" "}
                      {relativeTime(p.updatedAt)}
                    </span>
                  </span>
                  {p.id === id && (
                    <span
                      aria-label="current"
                      style={{
                        width: 6,
                        height: 6,
                        marginTop: 5,
                        borderRadius: 9,
                        flex: "none",
                        background: "var(--accent)",
                      }}
                    />
                  )}
                </DropdownMenu.Item>
              ))}
            </div>

            <DropdownMenu.Separator
              style={{ height: 1, background: "var(--border)", margin: "5px 3px" }}
            />

            <DropdownMenu.Item
              className="dd-item"
              disabled={blocked}
              title={blockedNote}
              onSelect={() => void guard("create", () => createProject("Untitled"))}
              style={{ opacity: blocked ? 0.5 : 1 }}
            >
              <Plus size={14} strokeWidth={1.8} />
              New project
            </DropdownMenu.Item>

            <DropdownMenu.Item
              className="dd-item"
              // Let the menu close (no preventDefault — that would leave it
              // stranded behind the dialog), then open on the next tick so its
              // focus trap doesn't race the menu restoring focus to the trigger.
              onSelect={() => {
                setDraftName(name);
                setTimeout(() => setRenaming(true), 0);
              }}
            >
              <Pencil size={14} strokeWidth={1.8} />
              Rename…
            </DropdownMenu.Item>

            <DropdownMenu.Item
              className="dd-item"
              disabled={blocked}
              title={blockedNote}
              onSelect={() => void guard("duplicate", () => duplicateProject(id))}
              style={{ opacity: blocked ? 0.5 : 1 }}
            >
              <Copy size={14} strokeWidth={1.8} />
              Duplicate
            </DropdownMenu.Item>

            <DropdownMenu.Item
              className="dd-item"
              disabled={blocked}
              title={blockedNote}
              onSelect={() => setTimeout(() => setConfirmDelete(true), 0)}
              style={{ color: "#f0616d", opacity: blocked ? 0.5 : 1 }}
            >
              <Trash2 size={14} strokeWidth={1.8} />
              Delete…
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <Dialog.Root open={renaming} onOpenChange={setRenaming}>
        <Dialog.Portal>
          <Dialog.Overlay className="dlg-overlay" />
          <Dialog.Content className="dlg-content" aria-describedby={undefined} style={smallDialog}>
            <Dialog.Title style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
              Rename project
            </Dialog.Title>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setRenaming(false);
                void guard("rename", () => renameProject(id, draftName));
              }}
            >
              <input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="Project name"
                style={{
                  width: "100%",
                  height: 34,
                  padding: "0 10px",
                  borderRadius: 8,
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                  fontSize: 13,
                  fontFamily: "inherit",
                  outline: "none",
                }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
                <Dialog.Close asChild>
                  <button type="button" style={ghostBtn}>
                    Cancel
                  </button>
                </Dialog.Close>
                <button
                  type="submit"
                  style={{ ...accentBtn, opacity: draftName.trim() ? 1 : 0.5 }}
                  disabled={!draftName.trim()}
                >
                  Rename
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={confirmDelete} onOpenChange={setConfirmDelete}>
        <Dialog.Portal>
          <Dialog.Overlay className="dlg-overlay" />
          <Dialog.Content className="dlg-content" aria-describedby={undefined} style={smallDialog}>
            <Dialog.Title style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
              Delete “{name}”?
            </Dialog.Title>
            <p style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
              This permanently removes the project and its images from disk. This can’t be undone.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <Dialog.Close asChild>
                <button type="button" style={ghostBtn}>
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="button"
                style={dangerBtn}
                onClick={() => {
                  setConfirmDelete(false);
                  void guard("delete", () => deleteProject(id));
                }}
              >
                Delete
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
