from __future__ import annotations

import argparse

from .bootstrap import load_legacy_module


legacy_main = load_legacy_module("app.py")


def build_parser() -> argparse.ArgumentParser:
    return argparse.ArgumentParser(description="Run the released scene risk pipeline.")


def run() -> None:
    legacy_main.main_process()


def main() -> None:
    build_parser().parse_args()
    run()


if __name__ == "__main__":
    main()