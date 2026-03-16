"""AVS-Agents — Entry point."""

from tui.app import AVSAgentsApp


def main() -> None:
    app = AVSAgentsApp()
    app.run()


if __name__ == "__main__":
    main()
