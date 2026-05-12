from __future__ import annotations

import argparse

from .bootstrap import load_legacy_module


legacy_main = load_legacy_module("app.py")
app = legacy_main.app
socketio = getattr(legacy_main, "socketio", None)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the released scene risk backend.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=6006)
    parser.add_argument("--debug", action="store_true")
    return parser


def run(host: str = "127.0.0.1", port: int = 6006, debug: bool = False) -> None:
    app.run(host=host, port=port, debug=debug)


def main() -> None:
    args = build_parser().parse_args()
    run(host=args.host, port=args.port, debug=args.debug)


if __name__ == "__main__":
    main()
