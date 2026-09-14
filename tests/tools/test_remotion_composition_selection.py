"""Contract tests for selecting a registered shared Remotion composition."""

import re
from pathlib import Path

import pytest

from tools.video.video_compose import VideoCompose


def test_composition_id_is_optional_input_and_template_is_allowlisted():
    assert "composition_id" in VideoCompose.input_schema["properties"]
    for composition_id in (
        "CamelotMoodShort",
        "CamelotImpactShort",
        "CamelotSwitchShort",
        "CamelotCleanShort",
    ):
        assert VideoCompose._get_registered_composition_id(composition_id) == composition_id
    assert VideoCompose._get_composition_id("explainer-data") == "Explainer"


def test_registered_composition_allowlist_matches_shared_root():
    root_path = (
        Path(__file__).resolve().parents[2]
        / "remotion-composer"
        / "src"
        / "Root.tsx"
    )
    registered_in_root = set(
        re.findall(r'id="([A-Za-z][A-Za-z0-9]+)"', root_path.read_text())
    )

    assert registered_in_root == set(VideoCompose.REGISTERED_COMPOSITION_IDS)


@pytest.fixture
def remotion_tool(monkeypatch):
    monkeypatch.setattr("shutil.which", lambda _: "/usr/bin/npx")
    return VideoCompose()


def test_remotion_render_accepts_registered_composition_id(
    remotion_tool, tmp_path, monkeypatch
):
    output_path = tmp_path / "mood-short.mp4"
    seen = {}

    def fake_run_command(cmd, *args, **kwargs):
        seen["cmd"] = cmd
        # The real renderer creates this file; the test only needs to exercise
        # command construction without launching Chromium or rendering media.
        Path(cmd[5]).touch()

    monkeypatch.setattr(remotion_tool, "run_command", fake_run_command)

    result = remotion_tool.execute(
        {
            "operation": "remotion_render",
            "edit_decisions": {
                "renderer_family": "explainer-data",
                "videoSrc": "/tmp/source.mp4",
                "durationSeconds": 13.824,
            },
            "composition_id": "CamelotMoodShort",
            "output_path": str(output_path),
        }
    )

    assert result.success, result.error
    assert seen["cmd"][4] == "CamelotMoodShort"


def test_remotion_render_rejects_unregistered_composition_id(
    remotion_tool, tmp_path, monkeypatch
):
    called = False

    def fake_run_command(*args, **kwargs):
        nonlocal called
        called = True

    monkeypatch.setattr(remotion_tool, "run_command", fake_run_command)

    result = remotion_tool.execute(
        {
            "operation": "remotion_render",
            "edit_decisions": {"renderer_family": "explainer-data", "cuts": []},
            "composition_id": "NotARegisteredComposition",
            "output_path": str(tmp_path / "out.mp4"),
        }
    )

    assert result.success is False
    assert "Unknown composition_id" in (result.error or "")
    assert called is False


def test_renderer_family_routing_is_unchanged_without_override(
    remotion_tool, tmp_path, monkeypatch
):
    seen = {}

    def fake_run_command(cmd, *args, **kwargs):
        seen["cmd"] = cmd
        Path(cmd[5]).touch()

    monkeypatch.setattr(remotion_tool, "run_command", fake_run_command)

    result = remotion_tool.execute(
        {
            "operation": "remotion_render",
            "edit_decisions": {
                "renderer_family": "presenter",
                "cuts": [],
            },
            "output_path": str(tmp_path / "out.mp4"),
        }
    )

    assert result.success, result.error
    assert seen["cmd"][4] == "TalkingHead"


def test_composition_id_changes_idempotency_key_for_same_render_inputs():
    tool = VideoCompose()
    common_inputs = {
        "operation": "remotion_render",
        "input_path": "/tmp/source.mp4",
        "edit_decisions": {"renderer_family": "explainer-data"},
    }

    mood_key = tool.idempotency_key(
        {**common_inputs, "composition_id": "CamelotMoodShort"}
    )
    impact_key = tool.idempotency_key(
        {**common_inputs, "composition_id": "CamelotImpactShort"}
    )

    assert mood_key != impact_key
