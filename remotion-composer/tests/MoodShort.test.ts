import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateMoodShortMetadata,
  durationSecondsToFrames,
  fitMoodShortCropToPanel,
  getActiveMoodShortCaption,
  getMoodMusicVolume,
  getMoodShortCaptionRuns,
  getMoodShortCropGeometry,
  getMoodShortPunchInScale,
  getMoodShortWindowOpacity,
  normalizeMoodShortCaptions,
  normalizeMoodShortEmphasisWindows,
  resolveMoodShortAsset,
  resolveMoodShortCaptionTrack,
  resolveMoodShortPanels,
  type MoodShortCaption,
  type MoodShortEmphasisWindow,
  type MoodShortProps,
} from "../src/MoodShort";

test("duration metadata keeps the sample at 415 frames and derives custom durations", () => {
  assert.equal(durationSecondsToFrames(13.824), 415);
  assert.equal(durationSecondsToFrames(2.5), 75);
  assert.equal(durationSecondsToFrames(undefined), 415);

  const metadata = calculateMoodShortMetadata({
    props: { durationSeconds: 4.2 } as MoodShortProps,
  } as never);

  assert.deepEqual(metadata, {
    durationInFrames: 126,
    fps: 30,
    width: 1080,
    height: 1920,
  });
});

test("punch-ins are quiet outside prop-defined windows and target one panel", () => {
  const windows: MoodShortEmphasisWindow[] = [
    { startSeconds: 1, endSeconds: 2, scale: 1.06, panel: "lower" },
  ];

  assert.equal(getMoodShortPunchInScale(15, 30, windows, "lower"), 1);
  assert.ok(getMoodShortPunchInScale(45, 30, windows, "lower") > 1.04);
  assert.equal(getMoodShortPunchInScale(45, 30, windows, "upper"), 1);
  assert.equal(getMoodShortPunchInScale(75, 30, windows, "lower"), 1);
});

test("funny music stays audible and escalates while hype remains restrained", () => {
  const funnyStart = getMoodMusicVolume(0, 30, 415, "funny", 0.6);
  const funnyPayoff = getMoodMusicVolume(400, 30, 415, "funny", 0.6);
  const funnyEnd = getMoodMusicVolume(414, 30, 415, "funny", 0.6);
  const hypeMid = getMoodMusicVolume(210, 30, 415, "hype", 0.18);

  assert.ok(funnyStart >= 0.4);
  assert.ok(funnyPayoff > funnyStart);
  assert.ok(funnyPayoff <= 0.7);
  assert.equal(funnyEnd, 0);
  assert.ok(hypeMid <= 0.18);
  assert.ok(hypeMid > 0);
  assert.equal(getMoodMusicVolume(12, 30, 30, "neutral", 0.3), 0);
});

test("short timing windows remain strictly renderable", () => {
  const shortWindow: MoodShortEmphasisWindow[] = [
    { startSeconds: 0, endSeconds: 4 / 30, scale: 1.06, panel: "lower" },
  ];

  assert.ok(getMoodShortPunchInScale(2, 30, shortWindow, "lower") > 1);
  assert.ok(getMoodShortWindowOpacity(2, 0, 4, 30) > 0);
  assert.doesNotThrow(() => getMoodMusicVolume(1, 30, 3, "hype", 0.18));
});

test("normalized crop geometry maps the requested rectangle exactly", () => {
  assert.deepEqual(
    getMoodShortCropGeometry({ x: 0.25, y: 0.5, width: 0.5, height: 0.25 }),
    {
      leftPercent: -50,
      topPercent: -200,
      widthPercent: 200,
      heightPercent: 400,
    },
  );

  const fitted = fitMoodShortCropToPanel(
    { x: 0.5, y: 0.25, width: 0.35, height: 0.56 },
    1.1,
    16 / 9,
  );
  assert.ok(Math.abs((fitted.width / fitted.height) * (16 / 9) - 1.1) < 0.0001);
  assert.ok(fitted.width >= 0.35);
  assert.ok(fitted.height >= 0.56);
});

test("caption selection is time-based and supports a single highlighted payoff", () => {
  const captions: MoodShortCaption[] = [
    { startSeconds: 0, endSeconds: 1, text: "Wait for it" },
    { startSeconds: 10.5, endSeconds: 12, text: "HE ONLY TYPED: HI GUZU", highlight: true },
  ];

  assert.equal(getActiveMoodShortCaption(captions, 15, 30)?.text, "Wait for it");
  assert.equal(
    getActiveMoodShortCaption(captions, 330, 30)?.highlight,
    true,
  );
  assert.equal(getActiveMoodShortCaption(captions, 90, 30), undefined);
});

test("caption accents isolate one case-insensitive phrase", () => {
  assert.deepEqual(
    getMoodShortCaptionRuns(
      "AND IT'S AN AUTOMATIC TRANSLATION.",
      "automatic translation",
    ),
    [
      { text: "AND IT'S AN ", accent: false },
      { text: "AUTOMATIC TRANSLATION", accent: true },
      { text: ".", accent: false },
    ],
  );
});

test("source-burned captions own the only visible caption track", () => {
  const captions: MoodShortCaption[] = [
    { startSeconds: 0, endSeconds: 1, text: "ONE TRACK" },
  ];

  assert.deepEqual(resolveMoodShortCaptionTrack(captions, true), []);
  const generatedTrack = resolveMoodShortCaptionTrack(captions, false);
  assert.equal(generatedTrack.length, 1);
  assert.equal(generatedTrack[0]?.text, "ONE TRACK");
  assert.throws(
    () => resolveMoodShortCaptionTrack(captions, undefined),
    /must be explicitly true or false/,
  );
  assert.throws(
    () => resolveMoodShortCaptionTrack(captions, "unverified"),
    /must be explicitly true or false/,
  );
  assert.throws(
    () => resolveMoodShortCaptionTrack([], false),
    /must contain at least one timed cue inside the composition/,
  );
  assert.throws(
    () =>
      resolveMoodShortCaptionTrack(
        [{ text: "TOO LATE", startSeconds: 999, endSeconds: 1000 }],
        false,
      ),
    /must contain at least one timed cue inside the composition/,
  );
  assert.throws(
    () => resolveMoodShortCaptionTrack([{ text: "NO TIMING" }], false),
    /must contain at least one timed cue inside the composition/,
  );
});

test("asset resolution preserves URLs and routes relative assets through staticFile", () => {
  assert.equal(resolveMoodShortAsset("https://cdn.example.test/clip.mp4"), "https://cdn.example.test/clip.mp4");
  assert.equal(resolveMoodShortAsset("file:///tmp/clip.mp4"), "file:///tmp/clip.mp4");
});

test("allowlisted MoodShort boundaries discard malformed raw JSON", () => {
  assert.equal(resolveMoodShortAsset(42), "");
  assert.deepEqual(normalizeMoodShortCaptions("not-an-array"), []);
  assert.deepEqual(normalizeMoodShortEmphasisWindows({ bad: true }), []);
  assert.equal(
    normalizeMoodShortCaptions([
      null,
      { text: { bad: true } },
      { text: "NO TIMING", accentText: 42 },
      { text: "SAFE", startSeconds: 0, endSeconds: 1, accentText: 42 },
    ])[0]?.text,
    "SAFE",
  );

  const panels = resolveMoodShortPanels({
    panels: "not-an-array",
    upperPanel: { label: { bad: true }, emphasisWindows: "bad" },
  } as never);
  assert.equal(panels[0].id, "upper");
  assert.equal(panels[0].label, undefined);
  assert.deepEqual(panels[0].emphasisWindows, []);
});
