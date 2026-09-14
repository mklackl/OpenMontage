import React from "react";
import {
  AbsoluteFill,
  Audio,
  CalculateMetadataFunction,
  OffthreadVideo,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/** The two editorial reads supported by the reusable short-form template. */
export type MoodShortMood = "funny" | "hype" | "neutral";
export type MoodShortCaptionOwnership =
  | {
      sourceHasBurnedCaptions: true;
      captions?: never;
    }
  | {
      sourceHasBurnedCaptions: false;
      captions: [MoodShortCaption, ...MoodShortCaption[]];
    }
  | {
      sourceHasBurnedCaptions: "unverified";
      captions?: MoodShortCaption[];
    };

export const MOOD_SHORT_FPS = 30;
export const MOOD_SHORT_WIDTH = 1080;
export const MOOD_SHORT_HEIGHT = 1920;
export const MOOD_SHORT_DEFAULT_DURATION_FRAMES = 415;
export const MOOD_SHORT_DEFAULT_HOOK_SECONDS = 1.5;

/**
 * A normalized source crop. x/y are the top-left corner in source space;
 * width/height describe the visible source rectangle. Keeping this data in
 * props lets the same template reframe a facecam, browser window, or gameplay
 * feed without baking one creator's crop into the composition.
 */
export interface MoodShortCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type MoodShortPanelRole = "upper" | "lower";

/** A time range in which a panel receives a restrained punch-in. */
export interface MoodShortEmphasisWindow {
  startSeconds?: number;
  endSeconds?: number;
  /** Short aliases make hand-authored JSON pages convenient as well. */
  start?: number;
  end?: number;
  scale?: number;
  panel?: MoodShortPanelRole | "both" | string;
}

/** Layout and crop for one of the two source-led editorial panels. */
export interface MoodShortPanel {
  id?: string;
  /** Normalized composition coordinates (0..1). */
  top?: number;
  left?: number;
  width?: number;
  height?: number;
  crop?: MoodShortCrop;
  /** Optional panel label, e.g. "FACE CAM" or "COMMENT THREAD". */
  label?: string;
  borderRadius?: number;
  emphasisWindows?: MoodShortEmphasisWindow[];
}

/** Visual-only hook card. It never changes composition duration. */
export interface MoodShortHook {
  text: string;
  sourceLabel?: string;
  startSeconds?: number;
  endSeconds?: number;
  start?: number;
  end?: number;
}

type MoodShortCaptionTiming =
  | {
      startSeconds: number;
      endSeconds: number;
      start?: number;
      end?: number;
    }
  | {
      start: number;
      end: number;
      startSeconds?: number;
      endSeconds?: number;
    };

/** Calm timed page captions, intentionally separate from word-level karaoke data. */
export type MoodShortCaption = {
  text: string;
  /** The one payoff page can opt into a brief accent and punch-in. */
  highlight?: boolean;
  emphasis?: boolean;
  /** Optional phrase emphasized inside the sentence without karaoke styling. */
  accentText?: string;
} & MoodShortCaptionTiming;

/** Props shared by every caption-ownership state. */
interface MoodShortBaseProps {
  [key: string]: unknown;
  /** Existing OpenMontage compositions use videoSrc; aliases ease JSON use. */
  videoSrc?: string;
  sourceSrc?: string;
  sourceVideoSrc?: string;
  source?: string;
  durationSeconds?: number;
  mood?: MoodShortMood;
  /** Source pixel aspect ratio, used to preserve crop geometry. Defaults to 16:9. */
  sourceAspectRatio?: number;

  /** Either provide upper/lower panels or a two-item panels array. */
  upperPanel?: MoodShortPanel;
  lowerPanel?: MoodShortPanel;
  panels?: MoodShortPanel[];
  /** Convenience crop aliases for callers that only need to change framing. */
  facecamCrop?: MoodShortCrop;
  contextCrop?: MoodShortCrop;
  emphasisWindows?: MoodShortEmphasisWindow[];
  punchIns?: MoodShortEmphasisWindow[];

  hook?: MoodShortHook;
  hookText?: string;
  sourceLabel?: string;

  musicSrc?: string;
  musicStartSeconds?: number;
  /** Capped to preserve source-audio dominance. */
  musicVolume?: number;

  backgroundBlurPx?: number;
  backgroundBrightness?: number;
  backgroundOpacity?: number;
  panelGapPx?: number;
  captionBottomPx?: number;
  captionFontSize?: number;
  captionHighlightColor?: string;
}

/** Props for the reusable 9:16 source-led mood short. */
export type MoodShortProps = MoodShortBaseProps & MoodShortCaptionOwnership;

export interface ResolvedMoodShortPanel {
  id: string;
  role: MoodShortPanelRole;
  top: number;
  left: number;
  width: number;
  height: number;
  crop: MoodShortCrop;
  label?: string;
  borderRadius: number;
  emphasisWindows: MoodShortEmphasisWindow[];
}

const FULL_FRAME_CROP: MoodShortCrop = {
  x: 0,
  y: 0,
  width: 1,
  height: 1,
};

const DEFAULT_PANEL_LAYOUT: Record<
  MoodShortPanelRole,
  Omit<ResolvedMoodShortPanel, "role" | "crop" | "emphasisWindows">
> = {
  upper: {
    id: "upper",
    top: 0.075,
    left: 0.07,
    width: 0.86,
    height: 0.3,
    borderRadius: 28,
  },
  lower: {
    id: "lower",
    top: 0.405,
    left: 0.04,
    width: 0.92,
    height: 0.47,
    borderRadius: 28,
  },
};

const MOOD_PALETTES: Record<
  MoodShortMood,
  {
    accent: string;
    panelBorder: string;
    captionHighlight: string;
    hookBackground: string;
  }
> = {
  funny: {
    accent: "#FFD166",
    panelBorder: "rgba(255, 209, 102, 0.62)",
    captionHighlight: "#FFD166",
    hookBackground: "rgba(57, 38, 8, 0.9)",
  },
  hype: {
    accent: "#76E4F7",
    panelBorder: "rgba(118, 228, 247, 0.58)",
    captionHighlight: "#76E4F7",
    hookBackground: "rgba(6, 43, 53, 0.9)",
  },
  neutral: {
    accent: "#D7DBE3",
    panelBorder: "rgba(215, 219, 227, 0.42)",
    captionHighlight: "#F7F4ED",
    hookBackground: "rgba(20, 22, 27, 0.9)",
  },
};

const DEFAULT_MUSIC_VOLUME: Record<MoodShortMood, number> = {
  funny: 0.55,
  hype: 0.12,
  neutral: 0,
};

// Comedy needs more headroom than a hype bed to remain perceptible beneath
// streamer dialogue. Final loudness and peak checks remain mandatory per clip.
const MAX_MUSIC_VOLUME: Record<MoodShortMood, number> = {
  funny: 0.7,
  hype: 0.28,
  neutral: 0,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function isMoodShortRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalMoodShortString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function optionalMoodShortNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function coerceMoodShortCrop(value: unknown): MoodShortCrop | undefined {
  if (!isMoodShortRecord(value)) return undefined;
  return {
    x: optionalMoodShortNumber(value.x) ?? 0,
    y: optionalMoodShortNumber(value.y) ?? 0,
    width: optionalMoodShortNumber(value.width) ?? 1,
    height: optionalMoodShortNumber(value.height) ?? 1,
  };
}

export function normalizeMoodShortEmphasisWindows(
  value: unknown,
): MoodShortEmphasisWindow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!isMoodShortRecord(candidate)) return [];
    return [
      {
        startSeconds: optionalMoodShortNumber(candidate.startSeconds),
        endSeconds: optionalMoodShortNumber(candidate.endSeconds),
        start: optionalMoodShortNumber(candidate.start),
        end: optionalMoodShortNumber(candidate.end),
        scale: optionalMoodShortNumber(candidate.scale),
        panel: optionalMoodShortString(candidate.panel),
      },
    ];
  });
}

export function normalizeMoodShortCaptions(value: unknown): MoodShortCaption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!isMoodShortRecord(candidate)) return [];
    const text = optionalMoodShortString(candidate.text);
    if (!text) return [];
    const startSeconds = optionalMoodShortNumber(candidate.startSeconds);
    const endSeconds = optionalMoodShortNumber(candidate.endSeconds);
    const start = optionalMoodShortNumber(candidate.start);
    const end = optionalMoodShortNumber(candidate.end);
    const timing =
      startSeconds !== undefined && endSeconds !== undefined
        ? { startSeconds, endSeconds, start, end }
        : start !== undefined && end !== undefined
          ? { start, end }
          : undefined;
    if (!timing) return [];
    return [
      {
        text,
        ...timing,
        highlight: candidate.highlight === true,
        emphasis: candidate.emphasis === true,
        accentText: optionalMoodShortString(candidate.accentText),
      },
    ];
  });
}

export function resolveMoodShortCaptionTrack(
  value: unknown,
  sourceHasBurnedCaptions: unknown,
  durationInFrames = MOOD_SHORT_DEFAULT_DURATION_FRAMES,
  fps = MOOD_SHORT_FPS,
): MoodShortCaption[] {
  if (sourceHasBurnedCaptions === true) return [];
  if (sourceHasBurnedCaptions === false) {
    const captions = normalizeMoodShortCaptions(value);
    const safeFps = Number.isFinite(fps) && fps > 0 ? fps : MOOD_SHORT_FPS;
    const safeDurationInFrames =
      Number.isFinite(durationInFrames) && durationInFrames > 0
        ? Math.max(1, Math.floor(durationInFrames))
        : MOOD_SHORT_DEFAULT_DURATION_FRAMES;
    const visibleCaptions = captions.filter((caption) => {
      const startFrame = secondsToFrames(
        caption.startSeconds ?? caption.start,
        safeFps,
      );
      const endFrame = secondsToFrames(
        caption.endSeconds ?? caption.end,
        safeFps,
      );
      return endFrame > startFrame && startFrame < safeDurationInFrames;
    });
    if (visibleCaptions.length === 0) {
      throw new Error(
        "captions must contain at least one timed cue inside the composition when sourceHasBurnedCaptions is false.",
      );
    }
    return visibleCaptions;
  }
  throw new Error(
    "sourceHasBurnedCaptions must be explicitly true or false after visually checking the source captions.",
  );
}

function normalizeMoodShortHook(
  hookValue: unknown,
  hookTextValue: unknown,
  sourceLabelValue: unknown,
): MoodShortHook | undefined {
  const sourceLabel = optionalMoodShortString(sourceLabelValue);
  if (isMoodShortRecord(hookValue)) {
    const text = optionalMoodShortString(hookValue.text);
    if (text) {
      return {
        text,
        sourceLabel: optionalMoodShortString(hookValue.sourceLabel) || sourceLabel,
        startSeconds: optionalMoodShortNumber(hookValue.startSeconds),
        endSeconds: optionalMoodShortNumber(hookValue.endSeconds),
        start: optionalMoodShortNumber(hookValue.start),
        end: optionalMoodShortNumber(hookValue.end),
      };
    }
  }
  const hookText = optionalMoodShortString(hookTextValue);
  return hookText ? { text: hookText, sourceLabel } : undefined;
}

/** Convert seconds to integer frames without allowing negative offsets. */
export function durationSecondsToFrames(
  durationSeconds: number | undefined,
  fps = MOOD_SHORT_FPS,
): number {
  if (
    durationSeconds === undefined ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    return MOOD_SHORT_DEFAULT_DURATION_FRAMES;
  }
  return Math.max(1, Math.round(durationSeconds * fps));
}

export function secondsToFrames(
  seconds: number | undefined,
  fps = MOOD_SHORT_FPS,
): number {
  return Math.max(0, Math.round(finiteOr(seconds, 0) * fps));
}

/**
 * Remotion's staticFile() is for public/relative assets. Absolute paths and
 * already-resolved URLs are left usable by the renderer.
 */
export function resolveMoodShortAsset(src: unknown): string {
  if (typeof src !== "string" || !src) return "";
  if (
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("data:") ||
    src.startsWith("file://")
  ) {
    return src;
  }

  const clean = src.replace(/^file:\/\//, "");
  if (clean.startsWith("/") || /^[A-Za-z]:[\\/]/.test(clean)) {
    const posix = clean.replace(/\\/g, "/");
    return posix.startsWith("/") ? `file://${posix}` : `file:///${posix}`;
  }
  return staticFile(clean);
}

/** Keep a crop valid even when hand-authored JSON is slightly out of range. */
export function normalizeMoodShortCrop(
  crop: MoodShortCrop | undefined,
): MoodShortCrop {
  const width = clamp(finiteOr(crop?.width, 1), 0.05, 1);
  const height = clamp(finiteOr(crop?.height, 1), 0.05, 1);
  return {
    x: clamp(finiteOr(crop?.x, 0), 0, 1 - width),
    y: clamp(finiteOr(crop?.y, 0), 0, 1 - height),
    width,
    height,
  };
}

function normalizePanel(
  role: MoodShortPanelRole,
  input: MoodShortPanel | undefined,
  cropOverride: MoodShortCrop | undefined,
): ResolvedMoodShortPanel {
  const defaults = DEFAULT_PANEL_LAYOUT[role];
  const safeInput = isMoodShortRecord(input) ? input : undefined;
  const top = clamp(
    finiteOr(optionalMoodShortNumber(safeInput?.top), defaults.top),
    0,
    0.95,
  );
  const left = clamp(
    finiteOr(optionalMoodShortNumber(safeInput?.left), defaults.left),
    0,
    0.95,
  );
  const width = clamp(
    finiteOr(optionalMoodShortNumber(safeInput?.width), defaults.width),
    0.05,
    1 - left,
  );
  const height = clamp(
    finiteOr(optionalMoodShortNumber(safeInput?.height), defaults.height),
    0.05,
    1 - top,
  );

  return {
    id: optionalMoodShortString(safeInput?.id) || defaults.id,
    role,
    top,
    left,
    width,
    height,
    crop: normalizeMoodShortCrop(
      coerceMoodShortCrop(safeInput?.crop) ||
        coerceMoodShortCrop(cropOverride) ||
        FULL_FRAME_CROP,
    ),
    label: optionalMoodShortString(safeInput?.label),
    borderRadius: clamp(
      finiteOr(
        optionalMoodShortNumber(safeInput?.borderRadius),
        defaults.borderRadius,
      ),
      0,
      96,
    ),
    emphasisWindows: normalizeMoodShortEmphasisWindows(
      safeInput?.emphasisWindows,
    ),
  };
}

/** Resolve panel aliases and apply only generic layout defaults. */
export function resolveMoodShortPanels(
  props: Pick<
    MoodShortProps,
    "upperPanel" | "lowerPanel" | "panels" | "facecamCrop" | "contextCrop"
  >,
): [ResolvedMoodShortPanel, ResolvedMoodShortPanel] {
  const panels = Array.isArray(props.panels) ? props.panels : [];
  const upperInput = isMoodShortRecord(props.upperPanel)
    ? (props.upperPanel as MoodShortPanel)
    : isMoodShortRecord(panels[0])
      ? (panels[0] as MoodShortPanel)
      : undefined;
  const lowerInput = isMoodShortRecord(props.lowerPanel)
    ? (props.lowerPanel as MoodShortPanel)
    : isMoodShortRecord(panels[1])
      ? (panels[1] as MoodShortPanel)
      : undefined;
  return [
    normalizePanel("upper", upperInput, props.facecamCrop),
    normalizePanel("lower", lowerInput, props.contextCrop),
  ];
}

function panelWindowMatches(
  window: MoodShortEmphasisWindow,
  role: MoodShortPanelRole,
  id?: string,
): boolean {
  return (
    !window.panel ||
    window.panel === "both" ||
    window.panel === role ||
    window.panel === id
  );
}

function singlePunchInScale(
  frame: number,
  fps: number,
  window: MoodShortEmphasisWindow,
): number {
  const startFrame = secondsToFrames(
    window.startSeconds ?? window.start,
    fps,
  );
  const endFrame = Math.max(
    startFrame + 1,
    secondsToFrames(window.endSeconds ?? window.end, fps),
  );
  const target = clamp(finiteOr(window.scale, 1.04), 1, 1.12);
  const duration = endFrame - startFrame;

  // A one- or two-frame window cannot contain a ramp without a non-monotonic
  // interpolate range; hold the target for that tiny explicit window instead.
  if (duration <= 2) {
    return frame >= startFrame && frame < endFrame ? target : 1;
  }

  const ramp = Math.max(
    1,
    Math.min(Math.round(fps * 0.12), Math.floor((duration - 1) / 2)),
  );
  return interpolate(
    frame,
    [startFrame, startFrame + ramp, endFrame - ramp, endFrame],
    [1, target, target, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
}

/** Return the largest active prop-defined punch-in for a panel. */
export function getMoodShortPunchInScale(
  frame: number,
  fps: number,
  windows: MoodShortEmphasisWindow[] = [],
  role?: MoodShortPanelRole,
  id?: string,
): number {
  return normalizeMoodShortEmphasisWindows(windows)
    .filter((window) => !role || panelWindowMatches(window, role, id))
    .reduce(
      (scale, window) => Math.max(scale, singlePunchInScale(frame, fps, window)),
      1,
    );
}

/**
 * An opacity envelope used by captions and the hook. It is frame-based and
 * clamped, with no CSS transition or animation involved.
 */
export function getMoodShortWindowOpacity(
  frame: number,
  startFrame: number,
  endFrame: number,
  fps: number,
): number {
  const safeEnd = Math.max(startFrame + 1, endFrame);
  const duration = safeEnd - startFrame;
  if (frame < startFrame || frame >= safeEnd) return 0;
  if (duration <= 2) return 1;

  const fade = Math.max(
    1,
    Math.min(Math.round(fps * 0.12), Math.floor((duration - 1) / 2)),
  );
  return interpolate(
    frame,
    [startFrame, startFrame + fade, safeEnd - fade, safeEnd],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
}

/**
 * Music is intentionally capped below the source track. Funny beds crescendo
 * across the short; hype beds stay restrained and simply fade at the edges.
 */
export function getMoodMusicVolume(
  frame: number,
  fps: number,
  durationInFrames: number,
  mood: MoodShortMood = "funny",
  requestedVolume?: number,
): number {
  const safeMood: MoodShortMood =
    mood === "hype" || mood === "neutral" ? mood : "funny";
  const target = clamp(
    finiteOr(requestedVolume, DEFAULT_MUSIC_VOLUME[safeMood]),
    0,
    MAX_MUSIC_VOLUME[safeMood],
  );
  if (safeMood === "neutral") return 0;
  if (durationInFrames <= 1) return target;

  const lastFrame = Math.max(1, durationInFrames - 1);
  if (safeMood === "funny") {
    const progress = interpolate(
      frame,
      [0, lastFrame],
      [0, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );
    const escalation = interpolate(
      progress,
      [0, 0.35, 0.75, 1],
      [0.7, 0.82, 0.94, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );
    const fadeOutFrames = Math.max(
      1,
      Math.min(Math.round(fps * 0.18), lastFrame),
    );
    const fadeOut = interpolate(
      frame,
      [lastFrame - fadeOutFrames, lastFrame],
      [1, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );
    return target * escalation * fadeOut;
  }

  if (lastFrame <= 1) return target;
  const edgeFrames = Math.max(1, Math.round(fps * 0.25));
  const safeEdgeFrames = Math.min(edgeFrames, Math.floor(lastFrame / 2));
  const fadeIn = interpolate(
    frame,
    [0, safeEdgeFrames],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const fadeOutStart = lastFrame - safeEdgeFrames;
  const fadeOut = interpolate(
    frame,
    [fadeOutStart, lastFrame],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return target * fadeIn * fadeOut;
}

/** Return the single page that should be visible at this frame. */
export function getActiveMoodShortCaption(
  captions: MoodShortCaption[],
  frame: number,
  fps: number,
): MoodShortCaption | undefined {
  const active = normalizeMoodShortCaptions(captions).filter((caption) => {
    const startFrame = secondsToFrames(
      caption.startSeconds ?? caption.start,
      fps,
    );
    const endFrame = Math.max(
      startFrame + 1,
      secondsToFrames(caption.endSeconds ?? caption.end, fps),
    );
    return frame >= startFrame && frame < endFrame;
  });

  // Last-in-list wins when authored pages overlap, keeping the layer calm and
  // predictable instead of stacking multiple captions on top of each other.
  return active.length > 0 ? active[active.length - 1] : undefined;
}

export interface MoodShortCaptionRun {
  text: string;
  accent: boolean;
}

/** Split a sentence into at most three runs around one case-insensitive accent. */
export function getMoodShortCaptionRuns(
  text: string,
  accentText?: string,
): MoodShortCaptionRun[] {
  const accent = accentText?.trim();
  if (!accent) return [{ text, accent: false }];
  const index = text.toLocaleLowerCase().indexOf(accent.toLocaleLowerCase());
  if (index < 0) return [{ text, accent: false }];

  return [
    { text: text.slice(0, index), accent: false },
    { text: text.slice(index, index + accent.length), accent: true },
    { text: text.slice(index + accent.length), accent: false },
  ].filter((run) => run.text.length > 0);
}

export interface MoodShortCropGeometry {
  leftPercent: number;
  topPercent: number;
  widthPercent: number;
  heightPercent: number;
}

/**
 * Expand a requested crop around its center until its physical aspect matches
 * the destination panel. This keeps the requested content visible without
 * stretching faces or UI.
 */
export function fitMoodShortCropToPanel(
  requestedCrop: MoodShortCrop,
  panelAspectRatio: number,
  sourceAspectRatio = 16 / 9,
): MoodShortCrop {
  const crop = normalizeMoodShortCrop(requestedCrop);
  const safePanelAspect = finiteOr(panelAspectRatio, 9 / 16);
  const safeSourceAspect = finiteOr(sourceAspectRatio, 16 / 9);
  const desiredNormalizedRatio = safePanelAspect / safeSourceAspect;
  if (desiredNormalizedRatio <= 0) return crop;

  const centerX = crop.x + crop.width / 2;
  const centerY = crop.y + crop.height / 2;
  let width = crop.width;
  let height = crop.height;

  if (width / height < desiredNormalizedRatio) {
    width = Math.min(1, height * desiredNormalizedRatio);
    if (width / height < desiredNormalizedRatio) {
      height = width / desiredNormalizedRatio;
    }
  } else {
    height = Math.min(1, width / desiredNormalizedRatio);
    if (width / height > desiredNormalizedRatio) {
      width = height * desiredNormalizedRatio;
    }
  }

  return normalizeMoodShortCrop({
    x: clamp(centerX - width / 2, 0, 1 - width),
    y: clamp(centerY - height / 2, 0, 1 - height),
    width,
    height,
  });
}

/** Map the requested normalized source rectangle exactly onto its panel. */
export function getMoodShortCropGeometry(
  requestedCrop: MoodShortCrop,
): MoodShortCropGeometry {
  const crop = normalizeMoodShortCrop(requestedCrop);
  return {
    leftPercent: (-crop.x / crop.width) * 100,
    topPercent: (-crop.y / crop.height) * 100,
    widthPercent: 100 / crop.width,
    heightPercent: 100 / crop.height,
  };
}

export const PanelMedia: React.FC<{
  source: string;
  crop: MoodShortCrop;
}> = ({ source, crop }) => {
  const geometry = getMoodShortCropGeometry(crop);

  return source ? (
    <OffthreadVideo
      src={source}
      muted
      data-mood-short-panel-video="true"
      style={{
        position: "absolute",
        left: `${geometry.leftPercent}%`,
        top: `${geometry.topPercent}%`,
        width: `${geometry.widthPercent}%`,
        height: `${geometry.heightPercent}%`,
        objectFit: "fill",
        // The panel is muted because the full-frame layer owns the source
        // audio. This avoids tripling the creator's voice when reframing.
      }}
    />
  ) : (
    <div
      style={{ position: "absolute", inset: 0, backgroundColor: "#17181d" }}
      data-mood-short-panel-placeholder="true"
    />
  );
};

const MoodShortPanelRenderer: React.FC<{
  panel: ResolvedMoodShortPanel;
  source: string;
  mood: MoodShortMood;
  globalWindows: MoodShortEmphasisWindow[];
  panelGapPx: number;
  sourceAspectRatio: number;
}> = ({ panel, source, mood, globalWindows, panelGapPx, sourceAspectRatio }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const windows = [...globalWindows, ...panel.emphasisWindows];
  const punchInScale = getMoodShortPunchInScale(
    frame,
    fps,
    windows,
    panel.role,
    panel.id,
  );
  const palette = MOOD_PALETTES[mood];
  const panelAspectRatio = (panel.width * width) / (panel.height * height);
  const fittedCrop = fitMoodShortCropToPanel(
    panel.crop,
    panelAspectRatio,
    sourceAspectRatio,
  );

  return (
    <div
      data-mood-short-panel={panel.role}
      style={{
        position: "absolute",
        top: `${panel.top * 100}%`,
        left: `${panel.left * 100}%`,
        width: `${panel.width * 100}%`,
        height: `${panel.height * 100}%`,
        overflow: "hidden",
        borderRadius: panel.borderRadius,
        border: `2px solid ${palette.panelBorder}`,
        boxShadow: "0 18px 50px rgba(0, 0, 0, 0.42)",
        transform: `scale(${punchInScale})`,
        transformOrigin: "center center",
        backgroundColor: "#17181d",
        marginTop: panel.role === "lower" ? panelGapPx : 0,
        zIndex: 2,
      }}
    >
      <PanelMedia source={source} crop={fittedCrop} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.03) 45%, rgba(0,0,0,0.32) 100%)",
          pointerEvents: "none",
        }}
      />
      {panel.label && (
        <div
          style={{
            position: "absolute",
            top: 18,
            left: 18,
            padding: "7px 12px",
            borderRadius: 999,
            backgroundColor: "rgba(8, 9, 12, 0.72)",
            color: "rgba(255,255,255,0.82)",
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: "0.08em",
          }}
        >
          {panel.label}
        </div>
      )}
    </div>
  );
};

export const HookOverlay: React.FC<{
  hook: MoodShortHook | undefined;
  fallbackText?: string;
  fallbackLabel?: string;
  mood: MoodShortMood;
}> = ({ hook, fallbackText, fallbackLabel, mood }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const text = hook?.text || fallbackText;
  if (!text) return null;

  const startFrame = secondsToFrames(
    hook?.startSeconds ?? hook?.start,
    fps,
  );
  const endFrame = Math.max(
    startFrame + 1,
    secondsToFrames(
      hook?.endSeconds ?? hook?.end,
      fps,
    ) || secondsToFrames(MOOD_SHORT_DEFAULT_HOOK_SECONDS, fps),
  );
  if (frame < startFrame || frame >= endFrame) return null;

  const fadeFrames = Math.max(1, Math.min(8, Math.floor((endFrame - startFrame) / 3)));
  const opacity = getMoodShortWindowOpacity(frame, startFrame, endFrame, fps);
  const translateY = interpolate(
    frame,
    [startFrame, startFrame + fadeFrames],
    [26, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const scale = interpolate(
    frame,
    [startFrame, startFrame + fadeFrames],
    [0.96, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const palette = MOOD_PALETTES[mood];
  const label = hook?.sourceLabel || fallbackLabel;

  return (
    <div
      data-mood-short-hook="true"
      style={{
        position: "absolute",
        top: 116,
        left: 72,
        right: 72,
        zIndex: 5,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        opacity,
        transform: `translateY(${translateY}px) scale(${scale})`,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          maxWidth: 900,
          padding: "18px 28px 20px",
          borderRadius: 20,
          textAlign: "center",
          backgroundColor: palette.hookBackground,
          border: `1px solid ${palette.accent}88`,
          boxShadow: `0 14px 42px rgba(0,0,0,0.32), 0 0 26px ${palette.accent}22`,
        }}
      >
        <div
          style={{
            color: "#FFFDF7",
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: 56,
            lineHeight: 1.06,
            fontWeight: 850,
            letterSpacing: "-0.025em",
          }}
        >
          {text}
        </div>
        {label && (
          <div
            style={{
              marginTop: 10,
              color: palette.accent,
              fontFamily: "Inter, system-ui, sans-serif",
              fontSize: 18,
              lineHeight: 1.2,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            {label}
          </div>
        )}
      </div>
    </div>
  );
};

export const CaptionLayer: React.FC<{
  captions: MoodShortCaption[];
  fps: number;
  bottomPx: number;
  fontSize: number;
  highlightColor: string;
}> = ({ captions, fps, bottomPx, fontSize, highlightColor }) => {
  const frame = useCurrentFrame();
  const caption = getActiveMoodShortCaption(captions, frame, fps);
  if (!caption || !caption.text) return null;

  const startFrame = secondsToFrames(
    caption.startSeconds ?? caption.start,
    fps,
  );
  const endFrame = Math.max(
    startFrame + 1,
    secondsToFrames(caption.endSeconds ?? caption.end, fps),
  );
  const opacity = getMoodShortWindowOpacity(frame, startFrame, endFrame, fps);
  const isHighlight = Boolean(caption.highlight || caption.emphasis);
  const captionRuns = getMoodShortCaptionRuns(
    caption.text,
    caption.accentText,
  );
  const pulseFrames = Math.max(1, Math.min(10, Math.round(fps * 0.28)));
  const highlightPulse = isHighlight
    ? interpolate(
        frame,
        [startFrame, startFrame + Math.floor(pulseFrames / 2), startFrame + pulseFrames],
        [0, 1, 0],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      )
    : 0;
  const entranceFrames = Math.max(
    1,
    Math.min(6, Math.floor((endFrame - startFrame) / 3)),
  );
  const entranceScale = interpolate(
    frame,
    [startFrame, startFrame + entranceFrames],
    [0.94, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const entranceY = interpolate(
    frame,
    [startFrame, startFrame + entranceFrames],
    [18, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <div
      data-mood-short-caption="true"
      data-caption-highlight={isHighlight ? "true" : "false"}
      style={{
        position: "absolute",
        left: 80,
        right: 170,
        bottom: bottomPx,
        zIndex: 6,
        display: "flex",
        justifyContent: "center",
        opacity,
        transform: `translateY(${entranceY}px) scale(${entranceScale + highlightPulse * 0.045})`,
        transformOrigin: "center bottom",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          maxWidth: 900,
          position: "relative",
          padding: "16px 24px 17px",
          borderRadius: 16,
          backgroundColor: isHighlight
            ? "rgba(24, 19, 8, 0.96)"
            : "rgba(6, 7, 10, 0.94)",
          border: isHighlight
            ? `2px solid ${highlightColor}CC`
            : "2px solid rgba(255,255,255,0.28)",
          boxShadow: isHighlight
            ? `0 14px 38px rgba(0, 0, 0, 0.55), 0 0 22px ${highlightColor}38`
            : "0 14px 38px rgba(0, 0, 0, 0.58)",
          color: "#FFFDF7",
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize,
          lineHeight: 1.16,
          fontWeight: isHighlight ? 850 : 760,
          letterSpacing: "-0.018em",
          textAlign: "center",
          textShadow: "0 2px 0 rgba(0,0,0,0.9), 0 0 10px rgba(0,0,0,0.75)",
          whiteSpace: "pre-wrap",
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 2,
          overflow: "hidden",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: -2,
            left: 24,
            right: 24,
            height: 4,
            borderRadius: 999,
            background: `linear-gradient(90deg, transparent, ${highlightColor}, transparent)`,
            opacity: isHighlight ? 1 : 0.72,
          }}
        />
        {captionRuns.map((run, index) => (
          <span
            key={`${index}-${run.text}`}
            style={
              run.accent
                ? {
                    color: highlightColor,
                    fontWeight: 900,
                    textShadow: `0 2px 0 rgba(0,0,0,0.95), 0 0 13px ${highlightColor}55`,
                  }
                : undefined
            }
          >
            {run.text}
          </span>
        ))}
      </div>
    </div>
  );
};

/**
 * Reusable source-led 9:16 edit: one audio-owning background, two muted
 * editorial reframes, visual hook, calm page captions, and optional mood bed.
 */
export const MoodShort: React.FC<MoodShortProps> = ({
  videoSrc,
  sourceSrc,
  sourceVideoSrc,
  source,
  mood = "neutral",
  sourceAspectRatio = 16 / 9,
  upperPanel,
  lowerPanel,
  panels,
  facecamCrop,
  contextCrop,
  emphasisWindows = [],
  punchIns = [],
  hook,
  hookText,
  sourceLabel,
  captions = [],
  sourceHasBurnedCaptions,
  musicSrc,
  musicStartSeconds = 0,
  musicVolume,
  backgroundBlurPx = 18,
  backgroundBrightness = 0.42,
  backgroundOpacity = 0.96,
  panelGapPx = 0,
  captionBottomPx = 270,
  captionFontSize = 42,
  captionHighlightColor,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const safeMood: MoodShortMood =
    mood === "funny" || mood === "hype" ? mood : "neutral";
  const safeSourceAspectRatio = clamp(
    finiteOr(sourceAspectRatio, 16 / 9),
    0.5,
    4,
  );
  const palette = MOOD_PALETTES[safeMood];
  const resolvedSource = [videoSrc, sourceSrc, sourceVideoSrc, source].find(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.trim().length > 0,
  );
  const sourceAsset = resolvedSource ? resolveMoodShortAsset(resolvedSource) : "";
  const resolvedPanels = resolveMoodShortPanels({
    upperPanel,
    lowerPanel,
    panels,
    facecamCrop,
    contextCrop,
  });
  const globalWindows = [
    ...normalizeMoodShortEmphasisWindows(emphasisWindows),
    ...normalizeMoodShortEmphasisWindows(punchIns),
  ];
  const backgroundFilter = `blur(${clamp(finiteOr(backgroundBlurPx, 18), 0, 48)}px) brightness(${clamp(finiteOr(backgroundBrightness, 0.42), 0.1, 1)})`;
  const safeSourceLabel = optionalMoodShortString(sourceLabel);
  const hookValue = normalizeMoodShortHook(hook, hookText, safeSourceLabel);
  // The empty Studio fixture may show its placeholder without a source. Any
  // real source must declare whether it already owns the caption track.
  const safeCaptions = sourceAsset
    ? resolveMoodShortCaptionTrack(
        captions,
        sourceHasBurnedCaptions,
        durationInFrames,
        fps,
      )
    : [];
  const safeMusicSrc = optionalMoodShortString(musicSrc);
  const safeCaptionHighlightColor = optionalMoodShortString(
    captionHighlightColor,
  );
  const maxCaptionFontSize = clamp(finiteOr(captionFontSize, 42), 24, 64);
  const safeCaptionBottomPx = clamp(finiteOr(captionBottomPx, 270), 240, 360);
  const safePanelGapPx = clamp(finiteOr(panelGapPx, 0), 0, 48);

  return (
    <AbsoluteFill
      data-mood-short="true"
      style={{
        backgroundColor: "#090A0D",
        overflow: "hidden",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      {/* This is the only unmuted source layer: creator audio stays intact. */}
      {sourceAsset ? (
        <OffthreadVideo
          src={sourceAsset}
          volume={1}
          data-mood-short-source="true"
          style={{
            position: "absolute",
            inset: -36,
            width: "calc(100% + 72px)",
            height: "calc(100% + 72px)",
            objectFit: "cover",
            filter: backgroundFilter,
            opacity: clamp(finiteOr(backgroundOpacity, 0.96), 0, 1),
          }}
        />
      ) : (
        <div
          data-mood-short-source-placeholder="true"
          style={{ position: "absolute", inset: 0, backgroundColor: "#090A0D" }}
        />
      )}

      {/* Darkened source remains visible around the panels for continuity. */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(8,9,12,0.5) 0%, rgba(8,9,12,0.28) 42%, rgba(8,9,12,0.7) 100%)",
          zIndex: 1,
        }}
      />

      <MoodShortPanelRenderer
        panel={resolvedPanels[0]}
        source={sourceAsset}
        mood={safeMood}
        globalWindows={globalWindows}
        panelGapPx={safePanelGapPx}
        sourceAspectRatio={safeSourceAspectRatio}
      />
      <MoodShortPanelRenderer
        panel={resolvedPanels[1]}
        source={sourceAsset}
        mood={safeMood}
        globalWindows={globalWindows}
        panelGapPx={safePanelGapPx}
        sourceAspectRatio={safeSourceAspectRatio}
      />

      <HookOverlay
        hook={hookValue}
        fallbackLabel={safeSourceLabel}
        mood={safeMood}
      />

      {sourceAsset && sourceHasBurnedCaptions === false && (
        <CaptionLayer
          captions={safeCaptions}
          fps={fps}
          bottomPx={safeCaptionBottomPx}
          fontSize={maxCaptionFontSize}
          highlightColor={
            safeCaptionHighlightColor || MOOD_PALETTES[safeMood].captionHighlight
          }
        />
      )}

      {safeMusicSrc && safeMood !== "neutral" && (
        <Audio
          src={resolveMoodShortAsset(safeMusicSrc)}
          startFrom={secondsToFrames(musicStartSeconds, fps)}
          volume={getMoodMusicVolume(
            frame,
            fps,
            durationInFrames,
            safeMood,
            musicVolume,
          )}
          loop
          data-mood-short-music="true"
        />
      )}

      {/* A subtle bottom rule gives the captions a safe visual anchor. */}
      <div
        style={{
          position: "absolute",
          left: 72,
          right: 72,
          bottom: Math.max(86, safeCaptionBottomPx - 44),
          height: 2,
          background: `linear-gradient(90deg, transparent 0%, ${palette.accent}55 24%, ${palette.accent}55 76%, transparent 100%)`,
          opacity: interpolate(
            frame,
            [0, Math.max(1, Math.round(fps * 0.35))],
            [0, 0.7],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          ),
          zIndex: 4,
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};

/** Metadata keeps the template reusable while matching the 13.824s sample. */
export const calculateMoodShortMetadata: CalculateMetadataFunction<MoodShortProps> = ({
  props,
}) => ({
  durationInFrames: durationSecondsToFrames(props.durationSeconds),
  fps: MOOD_SHORT_FPS,
  width: MOOD_SHORT_WIDTH,
  height: MOOD_SHORT_HEIGHT,
});
