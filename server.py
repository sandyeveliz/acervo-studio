"""AVS-Agents — Web server entry point."""

import os
import sys

import uvicorn

from api.app import create_app


if __name__ == "__main__":
    app = create_app()
    try:
        uvicorn.run(app, host="0.0.0.0", port=8000)
    except (KeyboardInterrupt, SystemExit):
        pass
    finally:
        # On Windows, uvicorn shutdown can corrupt the terminal state.
        # Reset it so the shell remains usable.
        if sys.platform == "win32":
            os.system("")  # re-enables ANSI escape processing on Windows
