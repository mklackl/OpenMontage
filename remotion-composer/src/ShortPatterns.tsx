import React from "react";
import {
  AbsoluteFill,
  Audio,
  CalculateMetadataFunction,
  OffthreadVideo,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

import {
  CaptionLayer,
  HookOverlay,
  MOOD_SHORT_DEFAULT_DURATION_FRAMES,
  MOOD_SHORT_FPS,
  MOOD_SHORT_HEIGHT,
  MOOD_SHORT_WIDTH,
  PanelMedia,
  durationSecondsToFrames,
  fitMoodShortCropToPanel,
  getMoodMusicVolume,
  getMoodShortPunchInScale,
  normalizeMoodShortCaptions,
  normalizeMoodShortCrop,
  resolveMoodShortAsset,
  resolveMoodShortCaptionTrack,
  secondsToFrames,
  type MoodShortCaption,
  type MoodShortCrop,
  type MoodShortEmphasisWindow,
  type MoodShortHook,
  type MoodShortMood,
  type MoodShortCaptionOwnership,
} from "./MoodShort";

type ShortPatternBaseProps = {
  [key: string]: unknown;
  videoSrc?: string;
  sourceSrc?: string;
  sourceVideoSrc?: string;
  source?: string;
  durationSeconds?: number;
  sourceAspectRatio?: number;
  mood?: MoodShortMood;
  hook?: MoodShortHook;
  hookText?: string;
  sourceLabel?: string;
  musicSrc?: string;
  musicStartSeconds?: number;
  musicVolume?: number;
  captionBottomPx?: number;
  captionFontSize?: number;
  captionHighlightColor?: string;
  backgroundBlurPx?: number;
  backgroundBrightness?: number;
  backgroundOpacity?: number;
} & MoodShortCaptionOwnership;

export type ImpactShortProps = ShortPatternBaseProps & {
  mainCrop?: MoodShortCrop;
  facecamCrop?: MoodShortCrop;
  facecamCropVerified?: boolean;
  facecamLabel?: string;
  emphasisWindows?: MoodShortEmphasisWindow[];
  facecamEmphasisWindows?: MoodShortEmphasisWindow[];
};

export type SwitchFocusShot = {
  startSeconds?: number;
  endSeconds?: number;
  start?: number;
  end?: number;
  focus?: "context" | "facecam" | "action" | string;
  crop?: MoodShortCrop;
  label?: string;
  scale?: number;
};

export type SwitchShortProps = ShortPatternBaseProps & {
  focusShots?: SwitchFocusShot[];
  defaultCrop?: MoodShortCrop;
  focusLabel?: string;
};

export type CleanShortProps = ShortPatternBaseProps & {
  frameLabel?: string;
  nativeCrop?: MoodShortCrop;
  frameTopPx?: number;
};

const FULL_CROP: MoodShortCrop = { x: 0, y: 0, width: 1, height: 1 };

const PATTERN_ACCENTS: Record<MoodShortMood, string> = {
  funny: "#FFD166",
  hype: "#E3A13B",
  neutral: "#D8C29A",
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const finiteOr = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isFinite(value) ? value : fallback;

const resolveMood = (mood: MoodShortMood | undefined): MoodShortMood =>
  mood === "funny" || mood === "hype" ? mood : "neutral";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

export const resolveImpactFacecamLabel = (value: unknown): string => {
  const label = optionalString(value);
  return label?.replace(/\s+/g, " ").toUpperCase().includes("ACTION FOCUS")
    ? "REACTION"
    : label || "REACTION";
};

const optionalNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const optionalCrop = (value: unknown): MoodShortCrop | undefined => {
  if (!isRecord(value)) return undefined;
  return {
    x: optionalNumber(value.x) ?? 0,
    y: optionalNumber(value.y) ?? 0,
    width: optionalNumber(value.width) ?? 1,
    height: optionalNumber(value.height) ?? 1,
  };
};

export const resolveShortPatternSource = (
  props: ShortPatternBaseProps,
): string => {
  const source = [
    props.videoSrc,
    props.sourceSrc,
    props.sourceVideoSrc,
    props.source,
  ].find(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.trim().length > 0,
  );
  return source ? resolveMoodShortAsset(source) : "";
};

export const normalizeShortPatternCaptions = (
  value: unknown,
): MoodShortCaption[] => normalizeMoodShortCaptions(value);

export const resolveShortPatternCaptionTrack = (
  value: unknown,
  sourceHasBurnedCaptions: unknown,
  durationInFrames = MOOD_SHORT_DEFAULT_DURATION_FRAMES,
  fps = MOOD_SHORT_FPS,
): MoodShortCaption[] =>
  resolveMoodShortCaptionTrack(
    value,
    sourceHasBurnedCaptions,
    durationInFrames,
    fps,
  );

const MAX_IMPACT_FACECAM_SOURCE_FRACTION = 0.35;

export const resolveImpactFacecamCrop = (
  value: unknown,
  facecamCropVerified: unknown,
  sourceAspectRatio: unknown = 16 / 9,
): MoodShortCrop | undefined => {
  if (facecamCropVerified !== true) return undefined;
  const crop = optionalCrop(value);
  if (!crop) return undefined;
  const normalized = normalizeMoodShortCrop(crop);
  const safeSourceAspectRatio =
    typeof sourceAspectRatio === "number" &&
    Number.isFinite(sourceAspectRatio) &&
    sourceAspectRatio >= 0.5 &&
    sourceAspectRatio <= 4
      ? sourceAspectRatio
      : 16 / 9;
  const renderedCrop = fitMoodShortCropToPanel(
    normalized,
    360 / 300,
    safeSourceAspectRatio,
  );
  const sourceFraction = renderedCrop.width * renderedCrop.height;
  if (
    sourceFraction > MAX_IMPACT_FACECAM_SOURCE_FRACTION ||
    renderedCrop.width > 0.65 ||
    renderedCrop.height > 0.65
  ) {
    return undefined;
  }
  return normalized;
};

const normalizeShortPatternHook = (
  hookValue: unknown,
  hookTextValue: unknown,
  sourceLabelValue: unknown,
): MoodShortHook | undefined => {
  const sourceLabel = optionalString(sourceLabelValue);
  if (isRecord(hookValue)) {
    const text = optionalString(hookValue.text);
    if (text) {
      return {
        text,
        sourceLabel: optionalString(hookValue.sourceLabel) || sourceLabel,
        startSeconds: optionalNumber(hookValue.startSeconds),
        endSeconds: optionalNumber(hookValue.endSeconds),
        start: optionalNumber(hookValue.start),
        end: optionalNumber(hookValue.end),
      };
    }
  }
  const hookText = optionalString(hookTextValue);
  return hookText ? { text: hookText, sourceLabel } : undefined;
};

export const normalizeShortPatternEmphasisWindows = (
  value: unknown,
): MoodShortEmphasisWindow[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    return [
      {
        startSeconds: optionalNumber(candidate.startSeconds),
        endSeconds: optionalNumber(candidate.endSeconds),
        start: optionalNumber(candidate.start),
        end: optionalNumber(candidate.end),
        scale: optionalNumber(candidate.scale),
        panel: optionalString(candidate.panel),
      },
    ];
  });
};

export const resolveShortPatternAspectRatio = (
  value: number | undefined,
): number =>
  value !== undefined && Number.isFinite(value) && value >= 0.5 && value <= 4
    ? value
    : 16 / 9;

export const resolveShortPatternCrop = (
  crop: MoodShortCrop | undefined,
  panelAspectRatio: number,
  sourceAspectRatio: number,
): MoodShortCrop =>
  fitMoodShortCropToPanel(
    normalizeMoodShortCrop(crop || FULL_CROP),
    clamp(finiteOr(panelAspectRatio, 9 / 16), 0.1, 10),
    resolveShortPatternAspectRatio(sourceAspectRatio),
  );

export const getShortPatternMusicVolume = (
  frame: number,
  fps: number,
  durationInFrames: number,
  mood: MoodShortMood | undefined,
  requestedVolume?: number,
): number =>
  getMoodMusicVolume(
    frame,
    fps,
    durationInFrames,
    resolveMood(mood),
    requestedVolume,
  );

const BaseSourceLayer: React.FC<{
  source: string;
  blurPx: number;
  brightness: number;
  opacity: number;
}> = ({ source, blurPx, brightness, opacity }) =>
  source ? (
    <OffthreadVideo
      src={source}
      volume={1}
      data-short-pattern-source-audio="true"
      style={{
        position: "absolute",
        inset: -40,
        width: "calc(100% + 80px)",
        height: "calc(100% + 80px)",
        objectFit: "cover",
        filter: `blur(${clamp(blurPx, 0, 48)}px) brightness(${clamp(
          brightness,
          0.1,
          1,
        )})`,
        opacity: clamp(opacity, 0, 1),
      }}
    />
  ) : (
    <AbsoluteFill
      data-short-pattern-source-placeholder="true"
      style={{ backgroundColor: "#090A0D" }}
    />
  );

const MoodMusic: React.FC<{
  musicSrc?: string;
  startSeconds: number;
  requestedVolume?: number;
  mood: MoodShortMood;
}> = ({ musicSrc, startSeconds, requestedVolume, mood }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  if (!musicSrc || mood === "neutral") return null;

  return (
    <Audio
      src={resolveMoodShortAsset(musicSrc)}
      startFrom={secondsToFrames(startSeconds, fps)}
      volume={getShortPatternMusicVolume(
        frame,
        fps,
        durationInFrames,
        mood,
        requestedVolume,
      )}
      loop
      data-short-pattern-music="true"
    />
  );
};

const PatternShell: React.FC<{
  props: ShortPatternBaseProps;
  children: React.ReactNode;
  captionBottomPx: number;
  captionFontSize: number;
}> = ({ props, children, captionBottomPx, captionFontSize }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const source = resolveShortPatternSource(props);
  const mood = resolveMood(props.mood);
  const accent =
    optionalString(props.captionHighlightColor) || PATTERN_ACCENTS[mood];
  const sourceLabel = optionalString(props.sourceLabel);
  const hook = normalizeShortPatternHook(
    props.hook,
    props.hookText,
    sourceLabel,
  );
  // Preserve the source-less Studio placeholder. Once a real source is
  // supplied, its caption ownership must be explicit and fail closed.
  const captions = source
    ? resolveShortPatternCaptionTrack(
        props.captions,
        props.sourceHasBurnedCaptions,
        durationInFrames,
        fps,
      )
    : [];
  const musicSrc = optionalString(props.musicSrc);

  return (
    <AbsoluteFill
      data-camelot-short-pattern="true"
      style={{
        overflow: "hidden",
        backgroundColor: "#090A0D",
        color: "#FFFDF7",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <BaseSourceLayer
        source={source}
        blurPx={finiteOr(props.backgroundBlurPx, 28)}
        brightness={finiteOr(props.backgroundBrightness, 0.3)}
        opacity={finiteOr(props.backgroundOpacity, 0.9)}
      />
      <AbsoluteFill
        style={{
          zIndex: 1,
          background:
            "linear-gradient(180deg, rgba(5,6,9,0.62) 0%, rgba(5,6,9,0.18) 40%, rgba(5,6,9,0.78) 100%)",
        }}
      />
      {children}
      <HookOverlay hook={hook} fallbackLabel={sourceLabel} mood={mood} />
      {source && props.sourceHasBurnedCaptions === false && (
        <CaptionLayer
          captions={captions}
          fps={fps}
          bottomPx={clamp(
            finiteOr(props.captionBottomPx, captionBottomPx),
            240,
            720,
          )}
          fontSize={clamp(
            finiteOr(props.captionFontSize, captionFontSize),
            28,
            64,
          )}
          highlightColor={accent}
        />
      )}
      <MoodMusic
        musicSrc={musicSrc}
        startSeconds={finiteOr(props.musicStartSeconds, 0)}
        requestedVolume={props.musicVolume}
        mood={mood}
      />
    </AbsoluteFill>
  );
};

const CropPanel: React.FC<{
  source: string;
  crop: MoodShortCrop | undefined;
  sourceAspectRatio: number;
  panelAspectRatio: number;
  label?: string;
  accent: string;
  radius?: number;
}> = ({
  source,
  crop,
  sourceAspectRatio,
  panelAspectRatio,
  label,
  accent,
  radius = 28,
}) => {
  const fittedCrop = resolveShortPatternCrop(
    crop,
    panelAspectRatio,
    sourceAspectRatio,
  );
  return (
    <AbsoluteFill
      style={{
        overflow: "hidden",
        borderRadius: radius,
        border: `2px solid ${accent}99`,
        boxShadow: "0 20px 56px rgba(0,0,0,0.46)",
        backgroundColor: "#17181D",
      }}
    >
      <PanelMedia source={source} crop={fittedCrop} />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.02) 55%, rgba(0,0,0,0.32) 100%)",
        }}
      />
      {label && (
        <div
          style={{
            position: "absolute",
            top: 18,
            left: 18,
            padding: "7px 13px",
            borderRadius: 999,
            color: "rgba(255,255,255,0.88)",
            backgroundColor: "rgba(6,7,10,0.78)",
            fontSize: 18,
            lineHeight: 1.1,
            fontWeight: 800,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          {label}
        </div>
      )}
    </AbsoluteFill>
  );
};

export const ImpactShort: React.FC<ImpactShortProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const source = resolveShortPatternSource(props);
  const mood = resolveMood(props.mood);
  const accent =
    optionalString(props.captionHighlightColor) || PATTERN_ACCENTS[mood];
  const sourceAspectRatio = resolveShortPatternAspectRatio(props.sourceAspectRatio);
  const mainCrop = optionalCrop(props.mainCrop);
  const facecamCrop = resolveImpactFacecamCrop(
    props.facecamCrop,
    props.facecamCropVerified,
    props.sourceAspectRatio,
  );
  const heroAspectRatio = 934 / 1630;
  const heroScale = getMoodShortPunchInScale(
    frame,
    fps,
    normalizeShortPatternEmphasisWindows(props.emphasisWindows),
    "lower",
    "impact-hero",
  );
  const facecamScale = getMoodShortPunchInScale(
    frame,
    fps,
    normalizeShortPatternEmphasisWindows(props.facecamEmphasisWindows),
    "upper",
    "impact-facecam",
  );

  return (
    <PatternShell props={props} captionBottomPx={270} captionFontSize={52}>
      <div
        data-impact-hero="true"
        style={{
          position: "absolute",
          zIndex: 2,
          left: 26,
          right: 120,
          top: 82,
          height: 1630,
          transform: `scale(${heroScale})`,
          transformOrigin: "center center",
        }}
      >
        <CropPanel
          source={source}
          crop={mainCrop}
          sourceAspectRatio={sourceAspectRatio}
          panelAspectRatio={heroAspectRatio}
          accent={accent}
          radius={34}
        />
      </div>

      {facecamCrop && (
        <div
          data-impact-facecam="true"
          style={{
            position: "absolute",
            zIndex: 4,
            width: 360,
            height: 300,
            right: 126,
            top: 275,
            transform: `scale(${facecamScale})`,
            transformOrigin: "center center",
          }}
        >
          <CropPanel
            source={source}
            crop={facecamCrop}
            sourceAspectRatio={sourceAspectRatio}
            panelAspectRatio={360 / 300}
            label={resolveImpactFacecamLabel(props.facecamLabel)}
            accent={accent}
            radius={24}
          />
        </div>
      )}

      <div
        style={{
          position: "absolute",
          zIndex: 3,
          left: 58,
          bottom: 160,
          width: 210,
          height: 6,
          borderRadius: 999,
          background: `linear-gradient(90deg, ${accent}, transparent)`,
          opacity: 0.8,
        }}
      />
    </PatternShell>
  );
};

const shotStartSeconds = (shot: SwitchFocusShot): number =>
  Math.max(0, finiteOr(shot.startSeconds ?? shot.start, 0));

const shotEndSeconds = (shot: SwitchFocusShot): number =>
  Math.max(shotStartSeconds(shot), finiteOr(shot.endSeconds ?? shot.end, 0));

export const normalizeSwitchFocusShots = (
  value: unknown,
): SwitchFocusShot[] => {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((candidate) => {
      if (!isRecord(candidate)) return [];
      return [
        {
          startSeconds: optionalNumber(candidate.startSeconds),
          endSeconds: optionalNumber(candidate.endSeconds),
          start: optionalNumber(candidate.start),
          end: optionalNumber(candidate.end),
          focus: optionalString(candidate.focus),
          crop: optionalCrop(candidate.crop),
          label: optionalString(candidate.label),
          scale: optionalNumber(candidate.scale),
        },
      ];
    })
    .sort((left, right) => shotStartSeconds(left) - shotStartSeconds(right));
};

const getSwitchFocusShotIndexFromNormalized = (
  frame: number,
  fps: number,
  shots: SwitchFocusShot[],
): number => {
  if (shots.length === 0) return -1;
  const safeFps = Math.max(1, finiteOr(fps, MOOD_SHORT_FPS));
  const seconds = Math.max(0, frame) / safeFps;
  const inWindow = shots.findIndex(
    (shot) =>
      seconds >= shotStartSeconds(shot) && seconds < shotEndSeconds(shot),
  );
  if (inWindow >= 0) return inWindow;
  if (seconds < shotStartSeconds(shots[0])) return 0;
  for (let index = shots.length - 1; index >= 0; index -= 1) {
    if (seconds >= shotStartSeconds(shots[index])) return index;
  }
  return 0;
};

export const getSwitchFocusShotIndex = (
  frame: number,
  fps: number,
  shots: SwitchFocusShot[] = [],
): number =>
  getSwitchFocusShotIndexFromNormalized(
    frame,
    fps,
    normalizeSwitchFocusShots(shots),
  );

export const getSwitchFocusShot = (
  frame: number,
  fps: number,
  shots: SwitchFocusShot[] = [],
): SwitchFocusShot | undefined => {
  const normalized = normalizeSwitchFocusShots(shots);
  const index = getSwitchFocusShotIndexFromNormalized(frame, fps, normalized);
  return index >= 0 ? normalized[index] : undefined;
};

export const SwitchShort: React.FC<SwitchShortProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const source = resolveShortPatternSource(props);
  const mood = resolveMood(props.mood);
  const accent =
    optionalString(props.captionHighlightColor) || PATTERN_ACCENTS[mood];
  const sourceAspectRatio = resolveShortPatternAspectRatio(props.sourceAspectRatio);
  const focusShots = normalizeSwitchFocusShots(props.focusShots);
  const activeIndex = getSwitchFocusShotIndexFromNormalized(
    frame,
    fps,
    focusShots,
  );
  const activeShot = activeIndex >= 0 ? focusShots[activeIndex] : undefined;
  const shotStartFrame = secondsToFrames(
    activeShot?.startSeconds ?? activeShot?.start,
    fps,
  );
  const settleFrame = shotStartFrame + Math.max(1, Math.round(fps * 0.18));
  const editorialScale = interpolate(
    frame,
    [shotStartFrame, settleFrame],
    [clamp(finiteOr(activeShot?.scale, 1.035), 1, 1.1), 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const label =
    activeShot?.label ||
    activeShot?.focus ||
    optionalString(props.focusLabel) ||
    "FOCUS";

  return (
    <PatternShell props={props} captionBottomPx={270} captionFontSize={52}>
      <div
        data-switch-hero="true"
        data-switch-shot-index={activeIndex}
        style={{
          position: "absolute",
          zIndex: 2,
          left: 34,
          right: 128,
          top: 110,
          height: 1450,
          transform: `scale(${editorialScale})`,
          transformOrigin: "center center",
        }}
      >
        <CropPanel
          source={source}
          crop={activeShot?.crop || optionalCrop(props.defaultCrop)}
          sourceAspectRatio={sourceAspectRatio}
          panelAspectRatio={918 / 1450}
          label={label}
          accent={accent}
          radius={34}
        />
      </div>

      {focusShots.length > 1 && (
        <div
          data-switch-timeline="true"
          style={{
            position: "absolute",
            zIndex: 4,
            left: 76,
            right: 170,
            bottom: 178,
            display: "flex",
            gap: 10,
          }}
        >
          {focusShots.map((shot, index) => (
            <div
              key={`${index}-${shotStartSeconds(shot)}`}
              style={{
                flex: Math.max(0.1, shotEndSeconds(shot) - shotStartSeconds(shot)),
                height: index === activeIndex ? 7 : 3,
                borderRadius: 999,
                backgroundColor:
                  index === activeIndex ? accent : "rgba(255,255,255,0.26)",
                boxShadow: index === activeIndex ? `0 0 14px ${accent}77` : "none",
              }}
            />
          ))}
        </div>
      )}
    </PatternShell>
  );
};

export const CleanShort: React.FC<CleanShortProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const source = resolveShortPatternSource(props);
  const mood = resolveMood(props.mood);
  const accent =
    optionalString(props.captionHighlightColor) || PATTERN_ACCENTS[mood];
  const sourceAspectRatio = resolveShortPatternAspectRatio(props.sourceAspectRatio);
  const entranceFrame = Math.max(1, Math.round(fps * 0.3));
  const entrance = interpolate(frame, [0, entranceFrame], [0.985, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const frameTop = clamp(finiteOr(props.frameTopPx, 390), 340, 700);

  return (
    <PatternShell props={props} captionBottomPx={610} captionFontSize={48}>
      <div
        data-clean-native-frame="true"
        style={{
          position: "absolute",
          zIndex: 2,
          left: 28,
          right: 108,
          top: frameTop,
          height: 531,
          transform: `scale(${entrance})`,
          transformOrigin: "center center",
        }}
      >
        <CropPanel
          source={source}
          crop={optionalCrop(props.nativeCrop) || FULL_CROP}
          sourceAspectRatio={sourceAspectRatio}
          panelAspectRatio={944 / 531}
          label={optionalString(props.frameLabel) || "FULL CONTEXT"}
          accent={accent}
          radius={26}
        />
      </div>

      <div
        style={{
          position: "absolute",
          zIndex: 2,
          top: frameTop - 42,
          left: 64,
          width: 82,
          height: 4,
          borderRadius: 999,
          backgroundColor: accent,
          boxShadow: `0 0 18px ${accent}66`,
        }}
      />
      <div
        style={{
          position: "absolute",
          zIndex: 2,
          top: frameTop + 566,
          left: 68,
          right: 158,
          color: "rgba(255,255,255,0.48)",
          fontSize: 18,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        {optionalString(props.sourceLabel) || "SOURCE CLIP"}
      </div>
    </PatternShell>
  );
};

const calculatePatternMetadata = <T extends ShortPatternBaseProps>({
  props,
}: {
  props: T;
}) => ({
  durationInFrames: durationSecondsToFrames(props.durationSeconds),
  fps: MOOD_SHORT_FPS,
  width: MOOD_SHORT_WIDTH,
  height: MOOD_SHORT_HEIGHT,
});

export const calculateImpactShortMetadata: CalculateMetadataFunction<ImpactShortProps> =
  calculatePatternMetadata;

export const calculateSwitchShortMetadata: CalculateMetadataFunction<SwitchShortProps> =
  calculatePatternMetadata;

export const calculateCleanShortMetadata: CalculateMetadataFunction<CleanShortProps> =
  calculatePatternMetadata;

export const SHORT_PATTERN_DEFAULT_DURATION_FRAMES =
  MOOD_SHORT_DEFAULT_DURATION_FRAMES;
