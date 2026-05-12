#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python}"

detect_matching_cuda_home() {
    "$PYTHON_BIN" - <<'PY'
import os
import re
import shutil
import subprocess
import sys

try:
    import torch
except Exception as exc:
    raise SystemExit(
        "Failed to import torch before building local CUDA extensions. "
        f"Current interpreter: {sys.executable}. Import error: {exc}"
    )

torch_cuda = torch.version.cuda
if not torch_cuda:
    raise SystemExit(
        "Installed PyTorch does not expose a CUDA runtime. "
        "The local extensions in algorithm/submodules require a CUDA-enabled PyTorch build. "
        "Create the environment from algorithm/environment.yml or install a matching CUDA PyTorch build first."
    )

expected = ".".join(torch_cuda.split(".")[:2])

def nvcc_version(nvcc_path):
    if not nvcc_path or not os.path.exists(nvcc_path):
        return None

    try:
        output = subprocess.check_output(
            [nvcc_path, "--version"],
            stderr=subprocess.STDOUT,
            text=True,
        )
    except Exception:
        return None

    match = re.search(r"release\s+(\d+\.\d+)", output)
    return match.group(1) if match else None

def add_candidate(paths, value):
    if value:
        paths.append(value)

cuda_home = os.environ.get("CUDA_HOME")
conda_prefix = os.environ.get("CONDA_PREFIX")
active_nvcc = shutil.which("nvcc")

candidates = []
add_candidate(candidates, os.path.join(cuda_home, "bin", "nvcc") if cuda_home else None)
add_candidate(candidates, active_nvcc)
add_candidate(candidates, os.path.join(conda_prefix, "bin", "nvcc") if conda_prefix else None)
add_candidate(candidates, f"/usr/local/cuda-{expected}/bin/nvcc")
add_candidate(candidates, "/usr/local/cuda/bin/nvcc")

seen = set()
for candidate in candidates:
    if candidate in seen:
        continue
    seen.add(candidate)
    version = nvcc_version(candidate)
    if version == expected:
        print(os.path.dirname(os.path.dirname(candidate)))
        raise SystemExit(0)

details = [f"PyTorch was compiled against CUDA {expected}."]
if active_nvcc:
    details.append(
        f"The nvcc currently on PATH is {active_nvcc} (CUDA {nvcc_version(active_nvcc) or 'unknown'})."
    )
else:
    details.append("No nvcc executable was found on PATH.")

if cuda_home:
    details.append(
        f"CUDA_HOME is set to {cuda_home} (CUDA {nvcc_version(os.path.join(cuda_home, 'bin', 'nvcc')) or 'unknown'})."
    )

if conda_prefix:
    conda_nvcc = os.path.join(conda_prefix, "bin", "nvcc")
    details.append(
        f"CONDA_PREFIX is {conda_prefix} (nvcc CUDA {nvcc_version(conda_nvcc) or 'missing'})."
    )

details.append(
    "Install a CUDA toolkit that matches torch.version.cuda and rerun, or export CUDA_HOME to that toolkit before running install_local_deps.sh. "
    "The reference environment in algorithm/environment.yml expects PyTorch 1.12.1 with cudatoolkit 11.6."
)
raise SystemExit(" ".join(details))
PY
}

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
    echo "Python interpreter not found: $PYTHON_BIN" >&2
    echo "Set PYTHON_BIN to a Python 3.7+ executable before running this script." >&2
    exit 1
fi

"$PYTHON_BIN" - <<'PY'
import sys

if sys.version_info < (3, 7):
    current = ".".join(str(part) for part in sys.version_info[:3])
    raise SystemExit(
        "install_local_deps.sh requires Python >= 3.7. "
        f"Current interpreter: {sys.executable} ({current}). "
        "Activate the correct environment or rerun with "
        "PYTHON_BIN=/path/to/python3.7+."
    )
PY

echo "Using Python: $("$PYTHON_BIN" -c 'import sys; print(sys.executable)')"

"$PYTHON_BIN" -m pip install -r "$ROOT_DIR/requirements.txt"
"$PYTHON_BIN" -m pip install -e "$ROOT_DIR"

CUDA_HOME="$(detect_matching_cuda_home)"
export CUDA_HOME
export PATH="$CUDA_HOME/bin:$PATH"
echo "Using CUDA toolkit: $CUDA_HOME"

"$PYTHON_BIN" -m pip install -e "$ROOT_DIR/algorithm/submodules/simple-knn"
"$PYTHON_BIN" -m pip install -e "$ROOT_DIR/algorithm/submodules/diff-gaussian-rasterization"
"$PYTHON_BIN" -m pip install -e "$ROOT_DIR/algorithm/submodules/diff-gaussian-rasterization_contrastive_f"

if [ -d "$ROOT_DIR/algorithm/third_party/kmeans_pytorch" ]; then
    "$PYTHON_BIN" -m pip install -e "$ROOT_DIR/algorithm/third_party/kmeans_pytorch"
fi

if [ -d "$ROOT_DIR/algorithm/third_party/segment-anything" ]; then
    "$PYTHON_BIN" -m pip install -e "$ROOT_DIR/algorithm/third_party/segment-anything"
fi

echo "Installed Python dependencies and local CUDA extensions."
echo "Repository structure now assumes:"
echo "  - algorithm contains the maintained algorithm source tree"
echo "  - pytorch3d"
