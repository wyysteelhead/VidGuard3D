import open3d as o3d
import numpy as np
from scipy.spatial.distance import cdist
import json
import os
import tempfile
from datetime import datetime


def _write_json_atomic(file_path, payload):
    directory = os.path.dirname(file_path)
    with tempfile.NamedTemporaryFile('w', dir=directory, delete=False, suffix='.json') as tmp_file:
        json.dump(payload, tmp_file, indent=4)
        tmp_path = tmp_file.name
    os.replace(tmp_path, file_path)

def cal_dis(SAGA_path, ground_truth_path, matrix_path):
    ply1 = o3d.io.read_point_cloud(SAGA_path)
    ply2 = o3d.io.read_point_cloud(ground_truth_path)
    # matrix_path = "reg_result.txt"
    # reg_result = np.array([
    #     [-0.004644321907, 0.228430130599, -0.246083966487, 0.425069100527],
    #     [-0.000771585464, -0.246114117666, -0.228443556693, 0.680081150201],
    #     [-0.335763380646, -0.002594103569, 0.003928828932, -0.394124958233],
    #     [0.000000000000, 0.000000000000, 0.000000000000, 1.000000000000]
    # ])
    # np.savetxt(matrix_path, reg_result)
    reg_result = np.loadtxt(matrix_path)
    ply1.transform(reg_result)
    init = np.array([
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1]
    ])
    icp = o3d.pipelines.registration.registration_icp(
        ply1, ply2, 0.03, init,
        o3d.pipelines.registration.TransformationEstimationPointToPoint()
    )
    ply1.transform(icp.transformation)
    bbox1 = ply1.get_axis_aligned_bounding_box()
    bbox2 = ply2.get_axis_aligned_bounding_box()

    # Normalize by the bounding-box diagonal to better reflect the overall model scale.
    diagonal1 = np.linalg.norm(bbox1.get_max_bound() - bbox1.get_min_bound())
    diagonal2 = np.linalg.norm(bbox2.get_max_bound() - bbox2.get_min_bound())
    diagonal_length = max(diagonal1, diagonal2)

    ply1.points = o3d.utility.Vector3dVector(np.asarray(ply1.points) / diagonal_length)
    ply2.points = o3d.utility.Vector3dVector(np.asarray(ply2.points) / diagonal_length)

    # Compute the bidirectional Chamfer distance.
    distances_1to2 = ply1.compute_point_cloud_distance(ply2)  # SAGA -> ground truth (precision)
    distances_2to1 = ply2.compute_point_cloud_distance(ply1)  # Ground truth -> SAGA (completeness)

    return distances_1to2, distances_2to1, diagonal_length

def cal_dis_selected(SAGA_path, ground_truth_path, matrix_path, selected_indices, selected_gt_indices=None):
    """
    Compute the bidirectional Chamfer distance for the selected SAGA points.

    Args:
        SAGA_path: Path to the SAGA point cloud.
        ground_truth_path: Path to the ground-truth point cloud.
        matrix_path: Path to the registration matrix.
        selected_indices: Index list for the selected SAGA points.
        selected_gt_indices: Optional index list for selected ground-truth points. If None, ground-truth points are filtered by the bounding box automatically.

    Returns:
        distances_1to2: Distances from selected SAGA points to ground truth.
        distances_2to1: Distances from ground truth to the selected SAGA points.
        diagonal_length: Normalization factor.
    """
    ply1 = o3d.io.read_point_cloud(SAGA_path)
    ply2 = o3d.io.read_point_cloud(ground_truth_path)

    # Load and apply the registration matrix.
    reg_result = np.loadtxt(matrix_path)
    ply1.transform(reg_result)

    # Refine alignment with ICP.
    init = np.array([
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1]
    ])
    icp = o3d.pipelines.registration.registration_icp(
        ply1, ply2, 0.03, init,
        o3d.pipelines.registration.TransformationEstimationPointToPoint()
    )
    ply1.transform(icp.transformation)

    # Compute the normalization factor.
    bbox1 = ply1.get_axis_aligned_bounding_box()
    bbox2 = ply2.get_axis_aligned_bounding_box()
    diagonal1 = np.linalg.norm(bbox1.get_max_bound() - bbox1.get_min_bound())
    diagonal2 = np.linalg.norm(bbox2.get_max_bound() - bbox2.get_min_bound())
    diagonal_length = max(diagonal1, diagonal2)

    # Normalize both point clouds.
    ply1.points = o3d.utility.Vector3dVector(np.asarray(ply1.points) / diagonal_length)
    ply2.points = o3d.utility.Vector3dVector(np.asarray(ply2.points) / diagonal_length)

    # Extract the selected SAGA points.
    saga_points_all = np.asarray(ply1.points)
    saga_points_selected = saga_points_all[selected_indices]

    # Build a point cloud from the selected points.
    ply1_selected = o3d.geometry.PointCloud()
    ply1_selected.points = o3d.utility.Vector3dVector(saga_points_selected)

    print(f"[cal_dis_selected] Total SAGA points: {len(saga_points_all)}")
    print(f"[cal_dis_selected] Selected SAGA points: {len(saga_points_selected)}")
    print(f"[cal_dis_selected] Ground truth points (total): {len(np.asarray(ply2.points))}")

    # Retrieve ground-truth points.
    gt_points_all = np.asarray(ply2.points)

    # Use front-end selected ground-truth points when they are provided.
    if selected_gt_indices is not None:
        print(f"[cal_dis_selected] Using user-selected GT points: {len(selected_gt_indices)} points")
        gt_points_selected = gt_points_all[selected_gt_indices]
    else:
        # Otherwise, create an expanded bounding box around the selected SAGA points.
        print(f"[cal_dis_selected] Auto-selecting GT points using bounding box")
        bbox_selected = ply1_selected.get_axis_aligned_bounding_box()
        min_bound = bbox_selected.get_min_bound()
        max_bound = bbox_selected.get_max_bound()

        # Expand the bounding box by 20% to better capture the matching GT region.
        extent = max_bound - min_bound
        expansion = extent * 0.2
        min_bound_expanded = min_bound - expansion
        max_bound_expanded = max_bound + expansion

        print(f"[cal_dis_selected] Bounding box: min={min_bound}, max={max_bound}")
        print(f"[cal_dis_selected] Expanded bbox: min={min_bound_expanded}, max={max_bound_expanded}")

        # Keep only ground-truth points inside the expanded bounding box.
        in_bbox_mask = np.all(
            (gt_points_all >= min_bound_expanded) & (gt_points_all <= max_bound_expanded),
            axis=1
        )
        gt_points_selected = gt_points_all[in_bbox_mask]

    # Build the filtered ground-truth point cloud.
    ply2_selected = o3d.geometry.PointCloud()
    ply2_selected.points = o3d.utility.Vector3dVector(gt_points_selected)

    print(f"[cal_dis_selected] Ground truth points (selected): {len(gt_points_selected)}")

    # Compute the bidirectional Chamfer distance.
    # Direction 1: selected SAGA -> matching GT region (precision)
    distances_1to2 = ply1_selected.compute_point_cloud_distance(ply2_selected)
    print(f"[cal_dis_selected] Direction 1 (SAGA→GT): mean={np.mean(distances_1to2):.6f}, min={np.min(distances_1to2):.6f}, max={np.max(distances_1to2):.6f}")

    # Direction 2: matching GT region -> selected SAGA (completeness)
    distances_2to1 = ply2_selected.compute_point_cloud_distance(ply1_selected)
    print(f"[cal_dis_selected] Direction 2 (GT→SAGA): mean={np.mean(distances_2to1):.6f}, min={np.min(distances_2to1):.6f}, max={np.max(distances_2to1):.6f}")

    return distances_1to2, distances_2to1, diagonal_length

def get_chamfer_metrics(distances_1to2, distances_2to1=None, diagonal_length=None):
    """
    Compute summary Chamfer Distance metrics from bidirectional distance arrays.

    Args:
        distances_1to2: Distances from SAGA to ground truth (precision).
        distances_2to1: Distances from ground truth to SAGA (completeness). If None, metrics are computed in one direction only.
        diagonal_length: Model diagonal length used to compute percentages.

    Returns:
        dict: Dictionary containing the summary metrics.
    """
    distances_1to2_np = np.asarray(distances_1to2)

    # Handle the bidirectional case.
    if distances_2to1 is not None:
        distances_2to1_np = np.asarray(distances_2to1)

        # Direction 1: SAGA -> ground truth (precision)
        mean_1to2 = float(np.mean(distances_1to2_np))
        median_1to2 = float(np.median(distances_1to2_np))
        std_1to2 = float(np.std(distances_1to2_np))
        min_1to2 = float(np.min(distances_1to2_np))
        max_1to2 = float(np.max(distances_1to2_np))
        p90_1to2 = float(np.percentile(distances_1to2_np, 90))
        p95_1to2 = float(np.percentile(distances_1to2_np, 95))

        # Direction 2: ground truth -> SAGA (completeness)
        mean_2to1 = float(np.mean(distances_2to1_np))
        median_2to1 = float(np.median(distances_2to1_np))
        std_2to1 = float(np.std(distances_2to1_np))
        min_2to1 = float(np.min(distances_2to1_np))
        max_2to1 = float(np.max(distances_2to1_np))
        p90_2to1 = float(np.percentile(distances_2to1_np, 90))
        p95_2to1 = float(np.percentile(distances_2to1_np, 95))

        # Bidirectional mean.
        mean_bidirectional = (mean_1to2 + mean_2to1) / 2
        median_bidirectional = (median_1to2 + median_2to1) / 2
        p90_bidirectional = (p90_1to2 + p90_2to1) / 2

        # Assign the quality level from the bidirectional mean percentage.
        mean_percentage = mean_bidirectional * 100
    else:
        # Handle the one-way case for backward compatibility.
        mean_1to2 = float(np.mean(distances_1to2_np))
        median_1to2 = float(np.median(distances_1to2_np))
        std_1to2 = float(np.std(distances_1to2_np))
        min_1to2 = float(np.min(distances_1to2_np))
        max_1to2 = float(np.max(distances_1to2_np))
        p90_1to2 = float(np.percentile(distances_1to2_np, 90))
        p95_1to2 = float(np.percentile(distances_1to2_np, 95))

        mean_bidirectional = mean_1to2
        median_bidirectional = median_1to2
        p90_bidirectional = p90_1to2
        mean_percentage = mean_1to2 * 100

        # Leave direction-2 metrics unset.
        mean_2to1 = median_2to1 = std_2to1 = None
        min_2to1 = max_2to1 = p90_2to1 = p95_2to1 = None

    # Determine the quality label.
    if mean_percentage < 1.0:
        quality_level = "excellent"
        quality_description = "Excellent"
    elif mean_percentage < 2.0:
        quality_level = "good"
        quality_description = "Good"
    elif mean_percentage < 5.0:
        quality_level = "fair"
        quality_description = "Fair"
    else:
        quality_level = "poor"
        quality_description = "Needs attention"

    # Assemble the metrics payload.
    metrics = {
        # Bidirectional mean value as the primary metric.
        "chamfer_distance_mean": mean_bidirectional,
        "chamfer_distance_median": median_bidirectional,
        "chamfer_distance_p90": p90_bidirectional,
        "chamfer_distance_mean_percentage": mean_bidirectional * 100,
        "chamfer_distance_median_percentage": median_bidirectional * 100,
        "chamfer_distance_p90_percentage": p90_bidirectional * 100,

        # Direction 1: SAGA -> ground truth (precision)
        "accuracy_mean": mean_1to2,
        "accuracy_median": median_1to2,
        "accuracy_std": std_1to2,
        "accuracy_min": min_1to2,
        "accuracy_max": max_1to2,
        "accuracy_p90": p90_1to2,
        "accuracy_p95": p95_1to2,
        "accuracy_mean_percentage": mean_1to2 * 100,

        # Quality assessment.
        "quality_level": quality_level,
        "quality_description": quality_description,

        # Metadata.
        "point_count_saga": int(len(distances_1to2_np)),
        "normalization_factor": float(diagonal_length) if diagonal_length else None,
        "timestamp": datetime.now().isoformat(),
        "is_bidirectional": distances_2to1 is not None
    }

    # Add direction-2 statistics when bidirectional data is available.
    if distances_2to1 is not None:
        metrics.update({
            # Direction 2: ground truth -> SAGA (completeness)
            "completeness_mean": mean_2to1,
            "completeness_median": median_2to1,
            "completeness_std": std_2to1,
            "completeness_min": min_2to1,
            "completeness_max": max_2to1,
            "completeness_p90": p90_2to1,
            "completeness_p95": p95_2to1,
            "completeness_mean_percentage": mean_2to1 * 100,
            "point_count_ground_truth": int(len(distances_2to1_np))
        })

    return metrics

def compute_and_save_chamfer_metrics(SAGA_path, ground_truth_path, matrix_path, output_dir, force_recompute=False):
    """
    Compute Chamfer Distance metrics and save them to JSON.
    If the output already exists, read it directly; otherwise compute and store it.

    Args:
        SAGA_path: Path to the SAGA point cloud.
        ground_truth_path: Path to the ground-truth point cloud.
        matrix_path: Path to the registration matrix.
        output_dir: Output directory, usually source_path.

    Returns:
        dict: Chamfer metrics dictionary.
    """
    metrics_path = os.path.join(output_dir, 'chamfer_metrics.json')

    # Read the saved metrics when they already exist.
    if os.path.exists(metrics_path) and not force_recompute:
        with open(metrics_path, 'r') as f:
            return json.load(f)

    # Otherwise compute them.
    distances_1to2, distances_2to1, diagonal_length = cal_dis(SAGA_path, ground_truth_path, matrix_path)
    metrics = get_chamfer_metrics(distances_1to2, distances_2to1, diagonal_length)

    # Save the metrics.
    _write_json_atomic(metrics_path, metrics)

    return metrics

if __name__ == "__main__":
    cal_dis('', '', '')

