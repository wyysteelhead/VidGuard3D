from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import List, Optional

import numpy as np
import torch

from .bootstrap import ensure_repo_on_path, load_legacy_module, repo_root

ensure_repo_on_path()

from scene.gaussian_model import GaussianModel


media_utils = load_legacy_module("media_utils.py")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Prepare released backend assets.")
    parser.add_argument("--static-dir", default=str(repo_root() / "static"))
    parser.add_argument("--sample")
    parser.add_argument("--write-ids", action="store_true")
    parser.add_argument("--center-point-cloud", action="store_true")
    return parser


def iter_samples(static_dir: Path, sample_name: Optional[str]) -> List[Path]:
    if sample_name:
        sample_dir = static_dir / sample_name
        return [sample_dir] if sample_dir.is_dir() else []

    result = []
    for child in sorted(static_dir.iterdir()):
        if child.is_dir() and child.name != "models":
            result.append(child)
    return result


def write_sample_id(sample_dir: Path) -> bool:
    video_path = sample_dir / "model.mp4"
    if not video_path.exists():
        return False

    sample_id = media_utils.file_md5(str(video_path))
    (sample_dir / "id.txt").write_text(sample_id)
    return True


def center_point_cloud(static_dir: Path, sample_dir: Path) -> bool:
    model_dir = static_dir / "models" / sample_dir.name
    source_ply = model_dir / "point_cloud" / "SAGA.ply"
    centered_ply = model_dir / "point_cloud" / "SAGA_centered.ply"
    cameras_path = model_dir / "cameras.json"
    cameras2_path = model_dir / "cameras2.json"

    if not source_ply.exists() or not cameras_path.exists():
        return False

    gaussian_model = GaussianModel(3)
    gaussian_model.load_ply(str(source_ply))
    center = np.mean(gaussian_model.get_xyz.detach().cpu().numpy(), axis=0)
    gaussian_model.get_xyz.data.sub_(torch.tensor(center, dtype=torch.float, device=gaussian_model.get_xyz.device))

    with cameras_path.open("r") as handle:
        cameras = json.load(handle)

    for camera in cameras:
        camera["position"] = [position - center[index] for index, position in enumerate(camera["position"])]

    with cameras_path.open("w") as handle:
        json.dump(cameras, handle, indent=2)

    if cameras2_path.exists():
        cameras2_path.unlink()
    if centered_ply.exists():
        centered_ply.unlink()

    gaussian_model.save_ply(str(centered_ply))
    return True


def main() -> None:
    args = build_parser().parse_args()
    static_dir = Path(args.static_dir).resolve()
    if not static_dir.is_dir():
        raise FileNotFoundError(f"Static directory not found: {static_dir}")

    samples = iter_samples(static_dir, args.sample)
    if not samples:
        raise FileNotFoundError("No matching samples found.")

    for sample_dir in samples:
        if args.write_ids:
            write_sample_id(sample_dir)
        if args.center_point_cloud:
            center_point_cloud(static_dir, sample_dir)


if __name__ == "__main__":
    main()