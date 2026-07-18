export type {
  ProviderKind,
  ModelCapabilities,
  ModelInfo,
  GenerateRequest,
  EditMode,
  EditRequest,
  UpscaleRequest,
  GeneratedImage,
  GenResult,
  ProgressEvent,
  ProviderContext,
  ImageProvider,
  LLMContext,
  LLMProvider,
  LLMProviderDescriptor,
  ProviderDescriptor,
  GenerateApiRequest,
  GenerateApiResponse,
  EnhanceApiRequest,
  EnhanceApiResponse,
  InpaintPromptApiRequest,
  InpaintPromptApiResponse,
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
