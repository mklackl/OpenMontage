import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateCleanShortMetadata,
  calculateImpactShortMetadata,
  calculateSwitchShortMetadata,
  getShortPatternMusicVolume,
  getSwitchFocusShot,
  getSwitchFocusShotIndex,
  normalizeShortPatternCaptions,
  normalizeShortPatternEmphasisWindows,
  resolveShortPatternCaptionTrack,
  resolveImpactFacecamCrop,
  resolveImpactFacecamLabel,
  normalizeSwitchFocusShots,
  resolveShortPatternAspectRatio,
  resolveShortPatternCrop,
  resolveShortPatternSource,
  type CleanShortProps,
  type ImpactShortProps,
  type SwitchFocusShot,
  type SwitchShortProps,
} from "../src/ShortPatterns";

test("all patterns keep the vertical contract and derive duration metadata", () => {
  const metadataCases = [
    [calculateImpactShortMetadata, { durationSeconds: 4.2 } as ImpactShortProps],
    [calculateSwitchShortMetadata, { durationSeconds: 4.2 } as SwitchShortProps],
    [calculateCleanShortMetadata, { durationSeconds: 4.2 } as CleanShortProps],
  ] as const;

  for (const [calculateMetadata, props] of metadataCases) {
    assert.deepEqual(
      calculateMetadata({ props } as never),
      {
        durationInFrames: 126,
        fps: 30,
        width: 1080,
        height: 1920,
      },
    );
  }

  const defaultMetadata = calculateImpactShortMetadata({
    props: {} as ImpactShortProps,
  } as never) as { durationInFrames: number };
  assert.equal(defaultMetadata.durationInFrames, 415);
});

test("aspect ratios and crops are safe for authored source reframes", () => {
  assert.equal(resolveShortPatternAspectRatio(21 / 9), 21 / 9);
  assert.equal(resolveShortPatternAspectRatio(Number.NaN), 16 / 9);
  assert.equal(resolveShortPatternAspectRatio(0.1), 16 / 9);

  const crop = resolveShortPatternCrop(
    { x: 0.96, y: -0.2, width: 0.4, height: 0.8 },
    9 / 16,
    16 / 9,
  );
  assert.ok(crop.x >= 0 && crop.y >= 0);
  assert.ok(crop.x + crop.width <= 1);
  assert.ok(crop.y + crop.height <= 1);
  assert.ok(crop.width >= 0.05 && crop.height >= 0.05);
});

test("impact facecam inset rejects a repeated full-screen source", () => {
  assert.equal(
    resolveImpactFacecamCrop({ x: 0, y: 0, width: 1, height: 1 }, true),
    undefined,
  );
  assert.equal(
    resolveImpactFacecamCrop({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 }, true),
    undefined,
  );
  assert.equal(
    resolveImpactFacecamCrop({ x: 0, y: 0, width: 0.65, height: 0.05 }, true),
    undefined,
  );
  assert.equal(
    resolveImpactFacecamCrop(
      { x: 0, y: 0.7, width: 0.28, height: 0.3 },
      false,
    ),
    undefined,
  );
  assert.deepEqual(
    resolveImpactFacecamCrop(
      { x: 0, y: 0.7, width: 0.28, height: 0.3 },
      true,
    ),
    { x: 0, y: 0.7, width: 0.28, height: 0.3 },
  );
});

test("source-burned captions suppress the generated caption track", () => {
  const captions = [{ text: "ONE TRACK", startSeconds: 0, endSeconds: 1 }];
  assert.deepEqual(resolveShortPatternCaptionTrack(captions, true), []);
  assert.equal(resolveShortPatternCaptionTrack(captions, false).length, 1);
  assert.throws(
    () => resolveShortPatternCaptionTrack(captions, undefined),
    /must be explicitly true or false/,
  );
  assert.throws(
    () => resolveShortPatternCaptionTrack(captions, "unverified"),
    /must be explicitly true or false/,
  );
  assert.throws(
    () => resolveShortPatternCaptionTrack([], false),
    /must contain at least one timed cue inside the composition/,
  );
  assert.throws(
    () =>
      resolveShortPatternCaptionTrack(
        [{ text: "TOO LATE", startSeconds: 999, endSeconds: 1000 }],
        false,
      ),
    /must contain at least one timed cue inside the composition/,
  );
});

test("impact pattern does not render the Action Focus badge", () => {
  assert.equal(resolveImpactFacecamLabel(undefined), "REACTION");
  assert.equal(resolveImpactFacecamLabel("ACTION FOCUS"), "REACTION");
  assert.equal(resolveImpactFacecamLabel("  action\nfocus badge  "), "REACTION");
  assert.equal(resolveImpactFacecamLabel("EBONHARDTTV"), "EBONHARDTTV");
});

test("switch focus shots clamp before, during, and after the authored timeline", () => {
  const focusShots: SwitchFocusShot[] = [
    {
      startSeconds: 0.5,
      endSeconds: 2,
      focus: "context",
      crop: { x: 0, y: 0, width: 0.8, height: 0.8 },
    },
    {
      startSeconds: 2,
      endSeconds: 3.5,
      focus: "facecam",
      crop: { x: 0.5, y: 0.1, width: 0.45, height: 0.7 },
    },
  ];

  assert.equal(getSwitchFocusShotIndex(0, 30, focusShots), 0);
  assert.equal(getSwitchFocusShotIndex(45, 30, focusShots), 0);
  assert.equal(getSwitchFocusShotIndex(75, 30, focusShots), 1);
  assert.equal(getSwitchFocusShotIndex(999, 30, focusShots), 1);
  assert.equal(getSwitchFocusShot(75, 30, focusShots)?.focus, "facecam");
  assert.equal(getSwitchFocusShot(0, 30, [])?.focus, undefined);
});

test("pattern music shares the capped funny/hype/neutral envelope", () => {
  assert.equal(getShortPatternMusicVolume(15, 30, 120, "neutral", 0.8), 0);

  const funny = getShortPatternMusicVolume(60, 30, 120, "funny", 0.8);
  const hype = getShortPatternMusicVolume(60, 30, 120, "hype", 0.8);
  assert.ok(funny > hype);
  assert.ok(funny <= 0.7);
  assert.ok(hype <= 0.28);
  assert.equal(getShortPatternMusicVolume(119, 30, 120, "funny", 0.8), 0);
});

test("raw JSON boundaries discard malformed strings, arrays, and entries", () => {
  assert.equal(resolveShortPatternSource({ videoSrc: 42 } as never), "");
  assert.match(
    resolveShortPatternSource({
      videoSrc: { bad: true },
      sourceSrc: "safe-source.mp4",
    } as never),
    /safe-source\.mp4$/,
  );

  assert.deepEqual(normalizeShortPatternCaptions("not-an-array"), []);
  assert.deepEqual(
    normalizeShortPatternCaptions([
      null,
      "bad",
      { text: { bad: true } },
      { text: "NO TIMING", accentText: 42, startSeconds: "now" },
      { text: "SAFE CAPTION", accentText: 42, startSeconds: 0, endSeconds: 1 },
    ]),
    [
      {
        text: "SAFE CAPTION",
        startSeconds: 0,
        endSeconds: 1,
        start: undefined,
        end: undefined,
        highlight: false,
        emphasis: false,
        accentText: undefined,
      },
    ],
  );
  assert.deepEqual(normalizeShortPatternEmphasisWindows({ bad: true }), []);
});

test("switch shots are sanitized and sorted before timeline selection", () => {
  const sorted = normalizeSwitchFocusShots([
    { startSeconds: 2, endSeconds: 3, focus: "reaction" },
    null,
    { startSeconds: "bad", endSeconds: 1, focus: "setup" },
  ]);
  assert.equal(sorted.length, 2);
  assert.equal(sorted[0].focus, "setup");
  assert.equal(sorted[1].focus, "reaction");
  assert.equal(getSwitchFocusShot(15, 30, sorted)?.focus, "setup");
});
