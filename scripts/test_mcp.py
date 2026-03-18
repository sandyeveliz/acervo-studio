"""Test MCP server connections and web search.

Usage:
    uv run python scripts/test_mcp.py
    uv run python scripts/test_mcp.py "query to search"
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from providers.mcp_client import MCPManager


async def main() -> None:
    query = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else "Cipolletti Rio Negro Argentina"

    print("=" * 60)
    print("MCP Connection Test")
    print("=" * 60)

    mcp = MCPManager()

    if not mcp.has_servers:
        print("\n[ERROR] No MCP servers found in .mcp.json")
        return

    print(f"\nServers configured: {mcp.server_names}")

    # Test each server
    for name in mcp.server_names:
        print(f"\n--- {name} ---")
        status = mcp.get_status(name)
        print(f"  Status: {status}")

    # Test web search
    print(f"\n--- Web Search Test ---")
    print(f"  Query: \"{query}\"")
    print(f"  Searching...")

    result = await mcp.search_web(query)

    if result:
        print(f"  OK: Got {len(result)} chars")
        # Safe print — Windows terminal may not support all Unicode
        preview = result[:800].encode("ascii", errors="replace").decode("ascii")
        print(f"\n{preview}")
    else:
        print(f"  FAILED: No results")

    # Show final status
    print(f"\n--- Final Status ---")
    for name in mcp.server_names:
        status = mcp.get_status(name)
        error = mcp.get_error(name)
        icon = {"ready": "OK", "error": "FAIL", "unknown": "?"}[status]
        print(f"  [{icon}] {name}")
        if error:
            print(f"        Error: {error}")

    # Check fallback
    if any(mcp.get_status(n) == "error" for n in mcp.server_names):
        print(f"\n  Note: MCP stdio failed (common on Windows).")
        print(f"  HTTP fallback was used successfully." if result else "  HTTP fallback also failed.")


if __name__ == "__main__":
    asyncio.run(main())
