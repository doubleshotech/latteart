export type {
  ProviderKind,
  ModelCapabilities,
  ModelInfo,
  GenerateRequest,
  EditMode,
  EditRequest,
  GeneratedImage,
  GenResult,
  ProgressEvent,
  ProviderContext,
  ImageProvider,
  LLMProvider,
  ProviderDescriptor,
  GenerateApiRequest,
  GenerateApiResponse,
  EnhanceApiRequest,
  EnhanceApiResponse,
} from "./types.ts";

export type { StylePreset } from "./styles.ts";
export { STYLE_PRESETS, stylePreset, applyStyle } from "./styles.ts";

export type { ProjectLayer, ProjectViewport, ProjectSession, ProjectDoc } from "./project.ts";

/** Helper: build a full capability set with everything off by default. */
export function noCapabilities(): import("./types.ts").ModelCapabilities {
  return {
    txt2img: false,
    img2img: false,
    inpaint: false,
    outpaint: false,
    removeBg: false,
    transparentLayers: false,
    controlnet: false,
    upscale: false,
  };
}
