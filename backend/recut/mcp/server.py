"""Recut MCP server — pipeline operations exposed as MCP tools.

The co-writing agent (and any MCP client, e.g. Claude Desktop) drives the whole
pipeline through these tools: analyse a reference, build the base cut, write the
script onto beats, refine lines, add slots, generate gap-fill, and render the export.

Run: `recut-mcp` (stdio transport). Tool logic lives in recut.mcp.tools (unit-tested);
this module just registers them so the deterministic API path and the agentic MCP path
share one implementation.
"""

from __future__ import annotations

from recut.core.db import init_db
from recut.mcp import tools

try:
    from mcp.server.fastmcp import FastMCP
except Exception:  # pragma: no cover - mcp optional at import time
    FastMCP = None  # type: ignore


def build_server():
    if FastMCP is None:
        raise RuntimeError("mcp package not installed")
    mcp = FastMCP("recut")

    mcp.tool(name="analyse_reference", description="Analyse a reference asset into a transferable recipe (structure only, never the reference's content).")(tools.analyse_reference)
    mcp.tool(name="build_base_cut", description="Turn a recipe into a base cut: every beat becomes a stand-in slot so the cut plays end to end immediately.")(tools.build_base_cut)
    mcp.tool(name="draft_script_on_beats", description="Write the creator's story onto the recipe's beats, one line per beat.")(tools.draft_script_on_beats)
    mcp.tool(name="refine_beat", description="Refine one beat's line in place given an instruction.")(tools.refine_beat)
    mcp.tool(name="add_slot_from_prompt", description="Insert a new generated-b-roll slot described by a prompt, after a given slot.")(tools.add_slot_from_prompt)
    mcp.tool(name="draft_caption_and_cover", description="Draft the caption, hashtags, and 3 cover concepts from the timeline's script.")(tools.draft_caption_and_cover)
    mcp.tool(name="generate_broll", description="Queue async generated b-roll for a kept slot (deferred, token-capped, gap-fill only).")(tools.generate_broll)
    mcp.tool(name="generate_voiceover", description="Queue async voiceover for the timeline.")(tools.generate_voiceover)
    mcp.tool(name="render_export", description="Queue the final 9:16 MP4 export render.")(tools.render_export)
    mcp.tool(name="job_status", description="Check an async job's status, progress, and result.")(tools.job_status)
    # AI Showrunner (Track 2)
    mcp.tool(name="showrunner_develop", description="Writers' room: premise -> treatment (title, logline, cast, locations, scene beats) via a writer+critic loop.")(tools.showrunner_develop)
    mcp.tool(name="showrunner_storyboard", description="Break the treatment's scene beats into concrete shots.")(tools.showrunner_storyboard)
    mcp.tool(name="showrunner_cast", description="Generate + lock a character/location reference still (consistency anchor for i2v).")(tools.showrunner_cast)
    mcp.tool(name="showrunner_produce", description="Autonomously generate every shot (image-to-video + consistency critic) + voiceover + render the final film.")(tools.showrunner_produce)
    mcp.tool(name="showrunner_scoreboard", description="Quality-per-token scoreboard for a production.")(tools.showrunner_scoreboard)
    return mcp


def run() -> None:
    init_db()
    build_server().run()


if __name__ == "__main__":
    run()
