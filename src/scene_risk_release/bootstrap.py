from __future__ import annotations

import importlib.util
import sys
from functools import lru_cache
from pathlib import Path
from types import ModuleType


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def backend_root() -> Path:
    return repo_root() / "backend"


def algorithm_root() -> Path:
    return repo_root() / "algorithm"


def ensure_repo_on_path() -> Path:
    root = repo_root()
    backend = backend_root()
    algorithm = algorithm_root()
    search_paths = [
        backend,
        algorithm,
        algorithm / "third_party",
        algorithm / "third_party" / "kmeans_pytorch",
        algorithm / "third_party" / "segment-anything",
        root,
    ]
    for path in reversed(search_paths):
        path_text = str(path)
        if path.exists() and path_text not in sys.path:
            sys.path.insert(0, path_text)
    return root


@lru_cache(maxsize=None)
def load_legacy_module(file_name: str) -> ModuleType:
    root = ensure_repo_on_path()
    target = backend_root() / file_name
    if not target.exists():
        raise FileNotFoundError(f"Legacy module not found: {target}")

    module_name = f"scene_risk_release_legacy_{target.stem}"
    spec = importlib.util.spec_from_file_location(module_name, target)
    if spec is None or spec.loader is None:
        raise ImportError(f"Unable to build import spec for {target}")

    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module
