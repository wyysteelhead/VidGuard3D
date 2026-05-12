# VidGuard3D

VidGuard3D is the source code of paper "VidGuard3D: A Visual Risk Analysis Approach for Protecting 3D Assets against Video-based Reconstruction Attacks".

## Repository Layout

- `src/scene_risk_release/`: public entry points and bootstrap logic.
- `backend/app.py`: backend implementation.
- `backend/metrics.py`: Chamfer distance and related metrics.
- `backend/media_utils.py`: file and image utility helpers.
- `algorithm/`: maintained algorithm source tree used by the backend and pipeline.
- `algorithm/submodules/`: local CUDA extension sources installed from the repository.
- `algorithm/third_party/`: third-party dependencies used by the algorithm code, including git submodules.
- `frontend/`: frontend application.
- `scripts/install_local_deps.sh`: installation helper for local CUDA extensions.

Part of the algorithm code in `algorithm/` is derived in part from SegAnyGAussians and includes project-specific modifications and added modules.

This repository does not use SegAnyGAussians as a git submodule anymore. Instead, it publishes the maintained source tree directly and keeps attribution at the repository level through `LICENSE` and `NOTICE`.

If you later choose to reorganize the algorithm sources into a fork or submodule workflow, that can be done on top of this repository structure.

## Requirements

The project assumes a Linux or macOS development environment with Python 3.7+.

For the full pipeline you will also need:

- A CUDA-capable PyTorch installation that matches your machine.
- Build tools for native Python extensions.
- COLMAP and the other external tools already required by the original pipeline.

The original algorithm environment in [algorithm/environment.yml](algorithm/environment.yml) is based on Python 3.7.13, PyTorch 1.12.1, and torchvision 0.13.1.

Two dependencies are still external and are not vendored in this repository:

- `pytorch3d`

PyTorch3D still needs to be installed separately because it is typically installed per-platform and per-CUDA version.

The repository already includes these algorithm-side git submodules and expects them to be initialized:

- `algorithm/third_party/kmeans_pytorch`
- `algorithm/third_party/segment-anything`

## Installation

Create and activate a Python environment first, then run:

```bash
git clone <your-new-repository-url>
cd VidGuard3D
git submodule update --init --recursive
bash scripts/install_local_deps.sh
```

Then install the remaining external dependency explicitly:

```bash
python -m pip install pytorch3d
```

If you need a custom PyTorch or PyTorch3D build for your CUDA version, install those first and then rerun the local dependency script.

For the frontend application, install Node.js dependencies and start the dev server from `frontend/`:

```bash
cd frontend
npm install
npm run dev
```

Additional frontend-specific notes currently live in `frontend/README.md`.

## Commands

Start the backend:

```bash
scene-risk-backend
```

Run the pipeline:

```bash
scene-risk-pipeline
```

Prepare sample assets:

```bash
scene-risk-prepare-assets --write-ids --center-point-cloud
```

Start the frontend application:

```bash
cd frontend
npm run dev
```

## Important Notes

- This repository is self-contained at the source level, but it is not a zero-dependency project.
- The pipeline still depends on GPU-oriented research components and native CUDA extensions.
- Before publishing, you should still review datasets, checkpoints, generated files, and any private sample content under `static/`.
- The repository already includes top-level attribution, but you should still review whether additional file-level modification notices are needed before making the repository public.

## Validation

After installation, a minimal sanity check is:

```bash
python -m compileall src
python -c "import sys; sys.path.insert(0, 'src'); from scene_risk_release.bootstrap import backend_root, algorithm_root; print(backend_root()); print(algorithm_root())"
```

Once the missing external dependencies are installed, you can also validate imports with:

```bash
python -c "import sys; sys.path.insert(0, 'src'); from scene_risk_release.backend import app; print(type(app).__name__)"
```

## Publishing Recommendation

Before publishing or distributing the code, you should still complete these final checks:

1. Confirm that no private data, weights, or internal samples remain under the repository root.
2. Review the top-level license and attribution notice for completeness.
3. Verify the installation steps on a clean machine or clean virtual environment.
