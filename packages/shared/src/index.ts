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
  StyleSource,
  CustomStyle,
  CustomStyleInfo,
  PaletteHint,
  CreateStyleApiRequest,
} from "./types.ts";

export type { StylePreset, StyleFragment } from "./styles.ts";
export { STYLE_PRESETS, stylePreset, applyStyle, composeStyle } from "./styles.ts";

export type { BlendMode, BlendModeOption } from "./blend.ts";
export {
  BLEND_MODES,
  DEFAULT_BLEND_MODE,
  compositeOperation,
  oraCompositeOp,
  isBlended,
  isBlendMode,
  blendLabel,
} from "./blend.ts";

export type {
  ProjectLayer,
  ProjectViewport,
  ProjectSession,
  ProjectDoc,
  ProjectSummary,
} from "./project.ts";

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
    styleRef: false,
  };
}
