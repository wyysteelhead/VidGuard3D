
import time
import os
import json
# os.environ["CUDA_VISIBLE_DEVICES"] = "1"
import torch
import pytorch3d.ops
from plyfile import PlyData, PlyElement
import numpy as np
from matplotlib import pyplot as plt
from PIL import Image
from argparse import ArgumentParser, Namespace
import cv2

from arguments import ModelParams, PipelineParams,OptimizationParams
from scene import Scene, GaussianModel, FeatureGaussianModel
from gaussian_renderer import render, render_contrastive_feature

from segment_anything import (SamAutomaticMaskGenerator, SamPredictor,
                              sam_model_registry)
from utils.sh_utils import SH2RGB
from utils.general_utils import safe_state
import os
import kmeans_pytorch
import importlib
importlib.reload(kmeans_pytorch)
from kmeans_pytorch import kmeans
import gaussian_renderer
import importlib
from render import render_sets_with_return

import sys
import subprocess
import multiprocessing
import random
import shutil
from risk_eval import RiskEval,RiskEvalFromFile

def init_args():
    # # Hyper-parameters
    parser = ArgumentParser(description="Testing script parameters")
    model = ModelParams(parser, sentinel=True)
    pipeline = PipelineParams(parser)
    parser.add_argument("--iteration", default=-1, type=int)
    parser.add_argument("--skip_train", action="store_true")
    parser.add_argument("--skip_test", action="store_true")
    parser.add_argument("--quiet", action="store_true")
    parser.add_argument("--segment", action="store_true")
    parser.add_argument('--target', default='scene', const='scene', nargs='?', choices=['scene', 'seg', 'feature', 'coarse_seg_everything', 'contrastive_feature', 'xyz'])
    parser.add_argument('--idx', default=0, type=int)
    parser.add_argument('--precomputed_mask', default=None, type=str)
    parser.add_argument('--ext_device', default="cuda", type=str)
    parser.add_argument('--mask_device', default="cuda", type=str)
    parser.add_argument('--con_device', default="cuda", type=str)
    parser.add_argument('--seg_device', default="cuda", type=str)
    parser.add_argument("--divide", action="store_true")
    args = get_combined_args(parser)
    return args, model, pipeline

# def read_args():
#     # Set up command line argument parser
#     parser = ArgumentParser(description="Training script parameters")
#     lp = ModelParams(parser)
#     op = OptimizationParams(parser)
#     pp = PipelineParams(parser)
#     parser.add_argument('--ip', type=str, default="127.0.0.1")
#     parser.add_argument('--port', type=int, default=6009)
#     parser.add_argument('--debug_from', type=int, default=-1)
#     parser.add_argument('--detect_anomaly', action='store_true', default=False)
#     parser.add_argument("--test_iterations", nargs="+", type=int, default=[7_000, 30_000])
#     parser.add_argument("--save_iterations", nargs="+", type=int, default=[7_000, 30_000])
#     parser.add_argument("--quiet", action="store_true")
#     parser.add_argument("--checkpoint_iterations", nargs="+", type=int, default=[])
#     parser.add_argument("--start_checkpoint", type=str, default=None)
#     parser.add_argument("--eval_checkpoint", type=str, default=None)
#     parser.add_argument("--video_path", type=str, default=None)
#     parser.add_argument("--iteration", default=-1, type=int)
#     parser.add_argument("--skip_train", action="store_true")
#     parser.add_argument("--skip_test", action="store_true")
#     parser.add_argument("--segment", action="store_true")
#     parser.add_argument('--target', default='scene', const='scene', nargs='?', choices=['scene', 'seg', 'feature', 'coarse_seg_everything', 'contrastive_feature', 'xyz'])
#     parser.add_argument('--idx', default=0, type=int)
#     parser.add_argument('--precomputed_mask', default=None, type=str)
#     parser.add_argument('--ext_device', default="cuda", type=str)
#     parser.add_argument('--mask_device', default="cuda", type=str)
#     parser.add_argument('--con_device', default="cuda", type=str)
#     parser.add_argument('--seg_device', default="cuda", type=str)
#     parser.add_argument("--divide", action="store_true")
#     # args = parser.parse_args(sys.argv[1:])
#     args = get_combined_args(parser)
#     args.save_iterations.append(args.iterations)
#     if args.divide:
#         args.images = "images_div"

#     return lp, op, pp, args
    
def get_combined_args(parser : ArgumentParser, target_cfg_file = None):
    cmdlne_string = sys.argv[1:]
    # cmdlne_string = ['--model_path', model_path]
    cfgfile_string = "Namespace()"
    args_cmdline = parser.parse_args(cmdlne_string)
    
    if target_cfg_file is None:
        if args_cmdline.target == 'seg':
            target_cfg_file = "seg_cfg_args"
        elif args_cmdline.target == 'scene':
            target_cfg_file = "cfg_args"
        elif args_cmdline.target == 'feature' or args_cmdline.target == 'contrastive_feature' :
            target_cfg_file = "feature_cfg_args"

    try:
        cfgfilepath = os.path.join(args_cmdline.model_path, target_cfg_file)
        print("Looking for config file in", cfgfilepath)
        with open(cfgfilepath) as cfg_file:
            print("Config file found: {}".format(cfgfilepath))
            cfgfile_string = cfg_file.read()
    except TypeError:
        print("Config file found: {}".format(cfgfilepath))
        pass
    args_cfgfile = eval(cfgfile_string)

    merged_dict = vars(args_cfgfile).copy()
    for k,v in vars(args_cmdline).items():
        if v != None:
            merged_dict[k] = v

    return Namespace(**merged_dict)

def load_point_colors_from_pcd(num_points, path):
    plydata = PlyData.read(path)

    features_dc = np.zeros((num_points, 3))
    features_dc[:, 0] = np.asarray(plydata.elements[0]["f_dc_0"])
    features_dc[:, 1] = np.asarray(plydata.elements[0]["f_dc_1"])
    features_dc[:, 2] = np.asarray(plydata.elements[0]["f_dc_2"])

    colors = SH2RGB(features_dc)

    # N, 3
    return torch.clamp(torch.from_numpy(colors).squeeze().cuda(), 0.0, 1.0) * 255.

def write_ply(save_path, points, colors = None, normals = None, text=True):
    """
    save_path : path to save: '/yy/XX.ply'
    pt: point_cloud: size (N,3)
    """
    assert colors is None or normals is None, "Cannot have both colors and normals"
    
    if colors is None and normals is None:
        points = [(points[i,0], points[i,1], points[i,2]) for i in range(points.shape[0])]
        vertex = np.array(points, dtype=[('x', 'f4'), ('y', 'f4'),('z', 'f4')])
    elif colors is not None:
        dtype_full = [('x', 'f4'), ('y', 'f4'), ('z', 'f4'), ('red', 'u1'), ('green', 'u1'), ('blue', 'u1')]
        points = [(points[i,0], points[i,1], points[i,2], colors[i,0], colors[i,1], colors[i,2]) for i in range(points.shape[0])]
        vertex = np.array(points, dtype=dtype_full)
    else:
        dtype_full = [('x', 'f4'), ('y', 'f4'), ('z', 'f4'), ('normal_x', 'f4'), ('normal_y', 'f4'), ('normal_z', 'f4')]
        points = [(points[i,0], points[i,1], points[i,2], normals[i,0], normals[i,1], normals[i,2]) for i in range(points.shape[0])]
        vertex = np.array(points, dtype=dtype_full)

    el = PlyElement.describe(vertex, 'vertex', comments=['vertices'])
    PlyData([el], text=text).write(save_path)
    
def write_ply_with_color(save_path, points, colors, text=True):
    dtype_full = [('x', 'f4'), ('y', 'f4'), ('z', 'f4'), ('red', 'u1'), ('green', 'u1'), ('blue', 'u1')]
    points = [(points[i,0], points[i,1], points[i,2], colors[i,0], colors[i,1], colors[i,2]) for i in range(points.shape[0])]
    vertex = np.array(points, dtype=dtype_full)
    el = PlyElement.describe(vertex, 'vertex', comments=['vertices'])
    PlyData([el], text=text).write(save_path)
    
def postprocess_statistical_filtering(pcd, precomputed_mask = None, max_time = 5):
    
    if type(pcd) == np.ndarray:
        pcd = torch.from_numpy(pcd).cuda()
    else:
        pcd = pcd.cuda()

    num_points = pcd.shape[0]
    print("pcd shape", pcd.shape)
    # (N, P1, K)

    std_nearest_k_distance = 10
    
    while std_nearest_k_distance > 0.1 and max_time > 0:
        nearest_k_distance = pytorch3d.ops.knn_points(
            pcd.unsqueeze(0),
            pcd.unsqueeze(0),
            K=int(num_points**0.5),
        ).dists
        mean_nearest_k_distance, std_nearest_k_distance = nearest_k_distance.mean(), nearest_k_distance.std()
        print(std_nearest_k_distance, "std_nearest_k_distance")

        mask = nearest_k_distance.mean(dim = -1) < mean_nearest_k_distance + std_nearest_k_distance

        mask = mask.squeeze()

        pcd = pcd[mask,:]
        if precomputed_mask is not None:
            precomputed_mask[precomputed_mask != 0] = mask
        max_time -= 1
        
    return pcd.squeeze(), nearest_k_distance.mean(), precomputed_mask

def postprocess_grad_based_statistical_filtering(pcd, precomputed_mask, feature_gaussians, view, sam_mask, pipeline_args):
    start_time = time.time()
    
    background = torch.zeros(feature_gaussians.get_opacity.shape[0], 3, device = 'cuda')

    grad_catch_mask = torch.zeros(feature_gaussians.get_opacity.shape[0], 1, device = 'cuda')
    grad_catch_mask[precomputed_mask, :] = 1
    grad_catch_mask.requires_grad = True

    grad_catch_2dmask = render(
        view, 
        feature_gaussians, 
        pipeline_args, 
        background,
        filtered_mask=~precomputed_mask, 
        override_color=torch.zeros(feature_gaussians.get_opacity.shape[0], 3, device = 'cuda'),
        override_mask=grad_catch_mask,
        )['mask']


    target_mask = torch.tensor(sam_mask, device=grad_catch_2dmask.device)
    target_mask = torch.nn.functional.interpolate(target_mask.unsqueeze(0).unsqueeze(0).float(), size=grad_catch_2dmask.shape[-2:] , mode='bilinear').squeeze(0).repeat([3,1,1])
    target_mask[target_mask > 0.5] = 1
    target_mask[target_mask != 1] = 0

    loss = -(target_mask * grad_catch_2dmask).sum() + 10 * ((1-target_mask)* grad_catch_2dmask).sum()
    loss.backward()

    grad_score = grad_catch_mask.grad[precomputed_mask != 0].clone().squeeze()
    grad_score = -grad_score
    
    pos_grad_score = grad_score.clone()
    print("pos_grad_score", pos_grad_score)
    pos_grad_score[pos_grad_score <= 0] = 0
    pos_grad_score[pos_grad_score <= pos_grad_score.mean() + pos_grad_score.std()] = 0
    pos_grad_score[pos_grad_score != 0] = 1

    confirmed_mask = pos_grad_score.bool()

    if type(pcd) == np.ndarray:
        pcd = torch.from_numpy(pcd).cuda()
    else:
        pcd = pcd.cuda()

    confirmed_point = pcd[confirmed_mask == 1]

    print("confirmed_point", confirmed_point)
    print("confirmed_mask", confirmed_mask)
    print("pos_grad_score", pos_grad_score)
    print("pos_grad_score mean", pos_grad_score.mean())
    print("pos_grad_score std", pos_grad_score.std())

    confirmed_point, _, _ = postprocess_statistical_filtering(confirmed_point, max_time=5)

    test_nearest_k_distance = pytorch3d.ops.knn_points(
        confirmed_point.unsqueeze(0),
        confirmed_point.unsqueeze(0),
        K=2,
    ).dists
    mean_nearest_k_distance, std_nearest_k_distance = test_nearest_k_distance[:,:,1:].mean(), test_nearest_k_distance[:,:,1:].std()
    test_threshold = torch.max(test_nearest_k_distance)
    print(test_threshold, "test threshold")

    while True:

        nearest_k_distance = pytorch3d.ops.knn_points(
            pcd.unsqueeze(0),
            confirmed_point.unsqueeze(0),
            K=1,
        ).dists
        mask = nearest_k_distance.mean(dim = -1) <= test_threshold
        mask = mask.squeeze()
        true_mask = mask
        if torch.abs(true_mask.count_nonzero() - confirmed_point.shape[0]) / confirmed_point.shape[0] < 0.001:
            break

        confirmed_point = pcd[true_mask,:]

    precomputed_mask[precomputed_mask == 1] = true_mask
        
    print(time.time() - start_time)
    return confirmed_point.squeeze().detach().cpu().numpy(), precomputed_mask, test_threshold
    
def postprocess_growing(original_pcd, point_colors, seed_pcd, seed_point_colors, thresh = 0.05, grow_iter = 1):
    s_time = time.time()
    min_x, min_y, min_z = seed_pcd[:,0].min(), seed_pcd[:,1].min(), seed_pcd[:,2].min()
    max_x, max_y, max_z = seed_pcd[:,0].max(), seed_pcd[:,1].max(), seed_pcd[:,2].max()

    lx, ly, lz = max_x - min_x, max_y - min_y, max_z - min_z
    min_x, min_y, min_z = min_x - lx*0.05, min_y - ly*0.05, min_z - lz*0.05
    max_x, max_y, max_z = max_x + lx*0.05, max_y + ly*0.05, max_z + lz*0.05

    cutout_mask = (original_pcd[:,0] < max_x) * (original_pcd[:,1] < max_y) * (original_pcd[:,2] < max_z)
    cutout_mask *= (original_pcd[:,0] > min_x) * (original_pcd[:,1] > min_y) * (original_pcd[:,2] > min_z)
    
    cutout_point_cloud = original_pcd[cutout_mask > 0]

    for i in range(grow_iter):
        num_points_in_seed = seed_pcd.shape[0]
        res = pytorch3d.ops.ball_query(
            cutout_point_cloud.unsqueeze(0), 
            seed_pcd.unsqueeze(0),
            K=1,
            radius=thresh,
            return_nn=False
        ).idx

        mask = (res != -1).sum(-1) != 0

        mask = mask.squeeze()

        seed_pcd = cutout_point_cloud[mask, :]
    
    final_mask = cutout_mask.clone()
    final_mask[final_mask != 0] = mask > 0

    print(mask.count_nonzero())
    print(time.time() - s_time)

    return seed_pcd, final_mask, None

def find_foreground_points(image, threshold=0.5, max_points=10):  
    """  
    Find points representing the foreground in an image using saliency detection.  
      
    Args:  
        image (numpy.ndarray): The input image.  
        threshold (float): Threshold for binarizing the saliency map.  
        max_points (int): Maximum number of points to return.  
  
    Returns:  
        numpy.ndarray: An array of points representing the foreground.  
    """  
    # Initialize OpenCV's static saliency spectral residual detector and compute the saliency map  
    saliency = cv2.saliency.StaticSaliencySpectralResidual_create()  
    (success, saliency_map) = saliency.computeSaliency(image)  
    saliency_map = (saliency_map * 255).astype("uint8")  
  
    # Binarize the saliency map  
    _, saliency_mask = cv2.threshold(saliency_map, int(threshold * 255), 255, cv2.THRESH_BINARY)  
  
    # Find contours  
    contours, _ = cv2.findContours(saliency_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)  
  
    # Find the centroids of the contours and take up to max_points of them  
    points = []  
    for contour in contours:  
        M = cv2.moments(contour)  
        if M["m00"] != 0:  
            cX = int(M["m10"] / M["m00"])  
            cY = int(M["m01"] / M["m00"])  
            points.append([cX, cY])  
            if len(points) == max_points:  
                break  
  
    return np.array(points, dtype=np.int32)  

def promptSegment(args, model, pipeline):
    torch.cuda.set_device(args.seg_device)
    FEATURE_DIM = 32
    DATA_ROOT = args.source_path
    # the model path, same to the --model_path in the training, after train_scene.py this folder will be created but named randomly
    MODEL_PATH = args.model_path
    # 'lego_real_night_radial'
    # SPIN_SCENE_NAME = 'lego_real_night_radial'
    # NVOS_SCENE_NAME = 'orchids'
    FEATURE_GAUSSIAN_ITERATION = 30000

    SAM_PROJ_PATH = os.path.join(MODEL_PATH, f'point_cloud/iteration_{str(FEATURE_GAUSSIAN_ITERATION)}/sam_proj.pt')
    NEG_PROJ_PATH = os.path.join(MODEL_PATH, f'point_cloud/iteration_{str(FEATURE_GAUSSIAN_ITERATION)}/neg_proj.pt')
    FEATURE_PCD_PATH = os.path.join(MODEL_PATH, f'point_cloud/iteration_{str(FEATURE_GAUSSIAN_ITERATION)}/contrastive_feature_point_cloud.ply')
    SCENE_PCD_PATH = os.path.join(MODEL_PATH, f'point_cloud/iteration_{str(FEATURE_GAUSSIAN_ITERATION)}/scene_point_cloud.ply')

    SAM_ARCH = 'vit_h'
    SAM_CKPT_PATH = os.path.join(os.path.dirname(os.path.realpath(__file__)), 'dependencies/sam_ckpt/sam_vit_h_4b8939.pth')
    # # Data and Model Preparation
    # 

    nonlinear = torch.nn.Sequential(
        torch.nn.Linear(256, 64, bias=True),
        torch.nn.LayerNorm(64),
        torch.nn.LeakyReLU(),
        torch.nn.Linear(64, 64, bias=True),
        torch.nn.LayerNorm(64),
        torch.nn.LeakyReLU(),
        torch.nn.Linear(64, FEATURE_DIM, bias=True),
    )
    nonlinear.load_state_dict(torch.load(SAM_PROJ_PATH))
    nonlinear = nonlinear.cuda()
    nonlinear.eval()

    dataset = model.extract(args)
    dataset.need_features = False
    dataset.need_masks = True

    feature_gaussians = FeatureGaussianModel(FEATURE_DIM)

    scene = Scene(dataset, None, feature_gaussians, load_iteration=-1, feature_load_iteration=FEATURE_GAUSSIAN_ITERATION, shuffle=False, mode='eval', target='contrastive_feature', divide=args.divide)

    xyz = feature_gaussians.get_xyz
    point_features = feature_gaussians.get_point_features.cuda()


    model_type = SAM_ARCH
    sam = sam_model_registry[model_type](checkpoint=SAM_CKPT_PATH).to('cuda')
    predictor = SamPredictor(sam)

    # Begin Segmenting

    cameras = scene.getTrainCameras()
    print("There are",len(cameras),"views in the dataset.")

    ref_img_camera_id = 1
    mask_img_camera_id = 1

    view = cameras[ref_img_camera_id]
    img = view.original_image * 255
    img = cv2.resize(img.permute([1,2,0]).detach().cpu().numpy().astype(np.uint8),dsize=(1024,1024),fx=1,fy=1,interpolation=cv2.INTER_LINEAR)
    predictor.set_image(img)
    sam_feature = predictor.features
    # sam_feature = view.original_features

    start_time = time.time()
    bg_color = [0 for i in range(FEATURE_DIM)]
    background = torch.tensor(bg_color, dtype=torch.float32, device="cuda")
    rendered_feature = render_contrastive_feature(view, feature_gaussians, pipeline.extract(args), background)['render']
    time1 = time.time() - start_time

    H, W = sam_feature.shape[-2:]

    print(time1)
    
    input_point = np.array([[512, 500], [200, 400], [200, 545]])
    

    plt.scatter(input_point[:, 0], input_point[:, 1], marker='o', color='r') 


    plt.imshow(img)
    plt.savefig('test.png')
    plt.show()
    

    # input_point = np.array([[820, 580], [400, 500]])
    # input_point = np.array([[300, 400], [600, 700]])
    # input_point = np.array([[800, 600]])
    # trex part
    # input_point = np.array([[650, 670], [650, 800]])
    # orchids part
    # input_point = np.array([[520, 550]])
    # kitchen part
    # input_point = np.array([[600, 620]])
    # chesstable
    # input_point = np.array([[400, 600], [400, 800], [280, 650]])
    # garden
    # input_point = np.array([[520, 400], [550, 300]])

    # input_point = np.array([[600, 500], [717, 430], [528, 638], [506, 668], [309, 677], [708, 668]])
    # toy
    # input_point = np.array([[512, 512]])
    input_label = np.ones(len(input_point))

    with torch.no_grad():
        vanilla_masks, scores, logits = predictor.predict(
            point_coords=input_point,
            point_labels=input_label,
            multimask_output=True,
        )


    plt.subplot(1,3,1)
    plt.imshow(vanilla_masks[0])
    plt.subplot(1,3,2)
    plt.imshow(vanilla_masks[1])
    plt.subplot(1,3,3)
    plt.imshow(vanilla_masks[2])
    plt.show()
    plt.savefig('1.png')

    masks = torch.nn.functional.interpolate(torch.from_numpy(vanilla_masks).float().unsqueeze(0), (64,64), mode='bilinear').squeeze(0).cuda()
    masks[masks > 0.5] = 1
    masks[masks != 1] = 0
    
    # Manually select one of the candidate masks (0, 1, or 2).
    mask_id = 1
    # Automatically select the mask with the largest area.
    # mask_id = np.argmax([vanilla_mask.sum() for vanilla_mask in vanilla_masks])
    origin_ref_mask = torch.tensor(vanilla_masks[mask_id]).float().cuda()
    plt.imshow(vanilla_masks[mask_id])
    # plt.show()

    if origin_ref_mask.shape != (64,64):
        ref_mask = torch.nn.functional.interpolate(origin_ref_mask[None, None, :, :], (64,64), mode='bilinear').squeeze().cuda()
        ref_mask[ref_mask > 0.5] = 1
        ref_mask[ref_mask != 1] = 0
    else:
        ref_mask = origin_ref_mask
    # sam features
    start_time = time.time()

    low_dim_features = nonlinear(
        sam_feature.view(-1, H*W).permute([1,0])
    ).squeeze().permute([1,0]).reshape([-1, H, W])

    # SAM query
    mask_low_dim_features = ref_mask.unsqueeze(0) * torch.nn.functional.interpolate(low_dim_features.unsqueeze(0), ref_mask.shape[-2:], mode = 'bilinear').squeeze()
    mask_pooling_prototype = mask_low_dim_features.sum(dim = (1,2)) / torch.count_nonzero(ref_mask)

    # Feature Field query
    mask_low_dim_features = ref_mask.unsqueeze(0) * torch.nn.functional.interpolate(rendered_feature.unsqueeze(0), ref_mask.shape[-2:], mode = 'bilinear').squeeze()
    mask_pooling_prototype = mask_low_dim_features.sum(dim = (1,2)) / torch.count_nonzero(ref_mask)

    time2 = time.time() - start_time
    print(time2)
    print(mask_pooling_prototype.shape)


    # K-means or not

    start_time = time.time()

    bg_color = [0 for i in range(32)]
    background = torch.tensor(bg_color, dtype=torch.float32, device="cuda")
    rendered_feature = render_contrastive_feature(view, feature_gaussians, pipeline.extract(args), background)['render']

    similarity_mask = torch.einsum('C,CHW->HW', mask_pooling_prototype.cuda(), rendered_feature)
    similarity_mask = torch.nn.functional.interpolate(similarity_mask.float().unsqueeze(0).unsqueeze(0), (64,64), mode='bilinear').squeeze().cuda()
    similarity_mask[similarity_mask > 0] = 1
    similarity_mask[similarity_mask != 1] = 0

    iob = (similarity_mask * ref_mask).sum(dim = (-1, -2)) / ref_mask.sum()

    if iob > 0.9:
        fmask_prototype = mask_pooling_prototype.unsqueeze(0)
    else:

        downsampled_masks = torch.nn.functional.adaptive_avg_pool2d(ref_mask.unsqueeze(0).unsqueeze(0), (8,8)).squeeze()
        downsampled_features = torch.nn.functional.adaptive_avg_pool2d(mask_low_dim_features.unsqueeze(0), (8,8)).squeeze(0)
        downsampled_features /= downsampled_masks.unsqueeze(0)

        downsampled_masks[downsampled_masks != 0]= 1
        init_prototypes = downsampled_features[:, downsampled_masks.bool()].permute([1,0])


        masked_sam_features = low_dim_features[:, ref_mask.bool()]
        masked_sam_features = masked_sam_features.permute([1,0])

        num_clusters = init_prototypes.shape[0]
        print(num_clusters)
        if num_clusters <= 1:
            num_clusters = min(int(masked_sam_features.shape[0] ** 0.5), 32)
            init_prototypes = []

        cluster_ids_x, cluster_centers = kmeans(
            X=masked_sam_features, num_clusters=num_clusters, distance='cosine', device=torch.device('cuda')
        )

        similarity_mask = torch.sigmoid(torch.einsum('NC,CHW->NHW', cluster_centers.cuda(), rendered_feature))
        similarity_mask = torch.nn.functional.interpolate(similarity_mask.float().unsqueeze(1), (64,64), mode='bilinear').squeeze().cuda()
        similarity_mask[similarity_mask >= 0.5] = 1
        similarity_mask[similarity_mask != 1] = 0
        similarity_mask = similarity_mask.squeeze()

        ioa = (similarity_mask * ref_mask[None,:,:]).sum(dim = (-1, -2)) / (similarity_mask.sum(dim = (-1, -2)) + 1e-5)
        iob = (similarity_mask * ref_mask[None,:,:]).sum(dim = (-1, -2)) / ref_mask.sum()

        ioa = ioa.squeeze()
        iob = iob.squeeze()
        cluster_mask = ioa > 0.75

        # NMS
        for i in range(len(cluster_mask)):
            if not cluster_mask[i]:
                continue

            for j in range(i+1, len(cluster_mask)):
                if not cluster_mask[j]:
                    continue

                if (similarity_mask[j] * similarity_mask[i]).sum() / ((similarity_mask[j] + similarity_mask[i]).sum() - (similarity_mask[j] * similarity_mask[i]).sum()) > 0.75:
                    if ioa[i] > ioa[j]:
                        cluster_mask[j] = False
                    else:
                        cluster_mask[i] = False
                        break

        fmask_prototype = torch.cat([mask_pooling_prototype.unsqueeze(0), cluster_centers[cluster_mask, :].cuda()], dim = 0)

    time3 = time.time() - start_time
    print(time3)
    print(fmask_prototype.shape)

    mask_prototype = fmask_prototype
    start_time = time.time()
    if mask_prototype.shape[0] == 1 or len(mask_prototype.shape) == 1:
        point_logits = torch.einsum('NC,C->N', point_features, mask_prototype.squeeze())
        point_scores = torch.sigmoid(point_logits)
    else:
        point_logits = torch.einsum('NC,LC->NL', point_features, mask_prototype)
        point_logits = point_logits.max(-1)[0]
        point_scores = torch.sigmoid(point_logits)
    two_d_point_logits = torch.einsum('NC,CHW->NHW', mask_prototype.cuda(), rendered_feature).max(dim = 0)[0]
    two_d_point_logits = torch.nn.functional.interpolate(two_d_point_logits.float()[None, None, ...], ref_mask.shape[-2:], mode='bilinear').squeeze().cuda()
    in_mask_logits = two_d_point_logits[ref_mask.bool()]

    # Adjustable Threshold
    thresh = max(max(in_mask_logits.mean() + in_mask_logits.std(), torch.topk(point_logits, int(point_logits.shape[0]*0.1))[0][-1]), 0)

    mask = point_logits > thresh
    # if mask.is_cuda:  
    #     show_mask = mask.cpu()
    # plt.imshow(show_mask, cmap='gray')  
    # plt.show() 
    if not os.path.exists(os.path.join(args.model_path, 'segmentation_res')):
        os.mkdir(os.path.join(args.model_path, 'segmentation_res'))
    torch.save(mask, os.path.join(args.model_path, 'segmentation_res/test_mask.pt'))
    print(torch.count_nonzero(mask))
    time4 = time.time() - start_time
    print(time4)
    print(mask.shape)

    start_time = time.time()
    selected_xyz = xyz[mask.cpu()].data
    print(selected_xyz.shape)
    print(xyz.shape)
    selected_score = point_scores[mask.cpu()]
    # write_ply('./segmentation_res/vanilla_seg.ply', selected_xyz)

    selected_xyz, thresh, mask_ = postprocess_statistical_filtering(pcd=selected_xyz.clone(), precomputed_mask = mask.clone(), max_time=1)
    filtered_points, filtered_mask, thresh = postprocess_grad_based_statistical_filtering(pcd=selected_xyz.clone(), precomputed_mask=mask_.clone(), feature_gaussians=feature_gaussians, view=view, sam_mask=ref_mask.clone(), pipeline_args=pipeline.extract(args))
    # filtered_points, thresh = postprocess_statistical_filtering(pcd=selected_xyz.clone(), max_time=3)

    # print(thresh)
    # write_ply('./segmentation_res/filtered_seg.ply', filtered_points)
    time5 = time.time() - start_time
    print(time5)

    start_time = time.time()
    final_xyz, point_mask, final_normals = postprocess_growing(xyz, None, torch.from_numpy(filtered_points).cuda(), None, max(thresh, 0.05), grow_iter = 1)

    time6 = time.time() - start_time
    print(time6)
    torch.save(torch.logical_and(feature_gaussians.get_opacity.squeeze() > 0.1, point_mask.bool()), os.path.join(args.model_path, 'segmentation_res/pre_final_mask.pt'))

    # # Filter out the points confirmed to be negative

    importlib.reload(gaussian_renderer)

    start_time = time.time()

    final_mask = point_mask.float().detach().clone().unsqueeze(-1)
    final_mask.requires_grad = True

    background = torch.zeros(final_mask.shape[0], 3, device = 'cuda')
    rendered_mask_pkg = gaussian_renderer.render_mask(cameras[ref_img_camera_id], feature_gaussians, pipeline.extract(args), background, precomputed_mask=final_mask)

    # print(rendered_mask_pkg['mask'].min(), rendered_mask_pkg['mask'].max())

    tmp_target_mask = torch.tensor(origin_ref_mask, device=rendered_mask_pkg['mask'].device)
    tmp_target_mask = torch.nn.functional.interpolate(tmp_target_mask.unsqueeze(0).unsqueeze(0).float(), size=rendered_mask_pkg['mask'].shape[-2:] , mode='bilinear').squeeze(0)
    tmp_target_mask[tmp_target_mask > 0.5] = 1
    tmp_target_mask[tmp_target_mask != 1] = 0

    loss = 30*torch.pow(tmp_target_mask - rendered_mask_pkg['mask'], 2).sum()
    loss.backward()

    grad_score = final_mask.grad.clone()
    final_mask = final_mask - grad_score
    final_mask[final_mask < 0] = 0
    final_mask[final_mask != 0] = 1
    final_mask *= point_mask.unsqueeze(-1)

    time7 = time.time() - start_time
    print(time7)

    torch.save(final_mask.bool(), os.path.join(args.model_path, 'segmentation_res/final_mask.pt'))

    final_xyz = xyz[final_mask.cpu().bool().squeeze(), ...].data

    # mask_img_camera_id = 0
    rendered_mask_pkg = gaussian_renderer.render_mask(cameras[mask_img_camera_id], feature_gaussians, pipeline.extract(args), background, precomputed_mask=final_mask.float())
    plt.subplot(1,2,1)
    plt.imshow(rendered_mask_pkg['mask'].squeeze().detach().cpu() >= 0.5)
    plt.subplot(1,2,2)
    plt.imshow((cameras[mask_img_camera_id].original_image).permute([1,2,0]).cpu())
    plt.show()
    
    plt.savefig('3.png')

    print("Time Cost:", time1 + time2 + time3 + time4 + time5 + time6 + time7)
    return model, pipeline

def seg_mask(precomputed_mask):
    if precomputed_mask is not None:
        if '.pt' in precomputed_mask:
            precomputed_mask = torch.load(precomputed_mask)
        elif '.npy' in precomputed_mask:
            import numpy as np
            precomputed_mask = torch.from_numpy(np.load(precomputed_mask)).cuda()
            precomputed_mask[precomputed_mask > 0] = 1
            precomputed_mask[precomputed_mask != 1] = 0
            precomputed_mask = precomputed_mask.bool()
    return precomputed_mask

def run_script(script_name, args, cuda_device=None):  
    if cuda_device is not None:
        # Restrict the child process to the requested CUDA device.
        os.environ['CUDA_VISIBLE_DEVICES'] = str(cuda_device)
        
    script = os.path.join(os.path.dirname(os.path.realpath(__file__)), f'{script_name}.py')  
    command = ['python', script] + args  
    try:  
        subprocess.run(command, check=True)  
        print(f"{script_name} on CUDA device {cuda_device} completed successfully")  
        return script_name, 0  # 0 indicates success  
    except subprocess.CalledProcessError as e:  
        print(f"{script_name} on CUDA device {cuda_device} failed with return code: {e.returncode}")  
        return script_name, e.returncode  # Return non-zero return code for failure  

def random_select_and_save(input_path, output_path=None, div=4):  
    parent_dir = os.path.dirname(input_path)   
    if output_path is None:  
        output_path = os.path.join(parent_dir, 'images_div') 
        if not os.path.exists(output_path):  
            os.makedirs(output_path)
    resolved_parent_dir = os.path.abspath(parent_dir)
    resolved_input_path = os.path.abspath(input_path)
    resolved_output_path = os.path.abspath(output_path)
    if os.path.exists(output_path):
        if os.path.commonpath([resolved_parent_dir, resolved_output_path]) != resolved_parent_dir:
            raise ValueError(f"Refusing to delete output path outside the dataset directory: {resolved_output_path}")
        if resolved_output_path in {resolved_parent_dir, resolved_input_path}:
            raise ValueError(f"Refusing to delete unsafe output path: {resolved_output_path}")
        shutil.rmtree(output_path)
    # if os.path.exists(os.path.join(parent_dir, 'features')):
    #     shutil.rmtree(os.path.join(parent_dir, 'features'))
    # if os.path.exists(os.path.join(parent_dir, 'sam_masks')):
    #     shutil.rmtree(os.path.join(parent_dir, 'sam_masks'))
    # Collect all image files under the input directory.
    image_files = [f for f in os.listdir(input_path) if os.path.isfile(os.path.join(input_path, f)) and f.endswith(('.jpg', '.jpeg', '.png'))]  
      
    # Compute how many images to sample.
    num_images_to_select = len(image_files) // div
      
    # Randomly sample one quarter of the images by default.
    selected_images = random.sample(image_files, num_images_to_select)  
      
    # Ensure the output directory exists.
    if not os.path.exists(output_path):  
        os.makedirs(output_path)  
      
    # Copy the sampled images into the output directory.
    for image_file in selected_images:  
        input_image_path = os.path.join(input_path, image_file)  
        output_image_path = os.path.join(output_path, image_file)  
        shutil.copy(input_image_path, output_image_path)  
    # return output_path

def prepare_data(args):
    if args.divide:
        random_select_and_save(os.path.join(args.source_path, 'images'))
    if not os.path.isdir(os.path.join(args.source_path, 'features')):
        tasks = [  
            ('extract_features', ['--image_root', args.source_path], args.ext_device.split(":")[1] ),  
        ]  
        with multiprocessing.Pool(processes=1) as pool:  
            pool.starmap(run_script, tasks)
        print("SAM data preparation 1 done.")
    else:
        print("Feature already extracted, skipping extract_features.py")
    if not os.path.isdir(os.path.join(args.source_path, 'sam_masks')):
        tasks = [  
            ('extract_segment_everything_masks', ['--image_root', args.source_path] + (['--divide'] if args.divide else []), args.mask_device.split(":")[1] ),
        ]  
        with multiprocessing.Pool(processes=1) as pool:  
            pool.starmap(run_script, tasks)
    else:
        print("Feature already extracted, skipping extract_segment_everything_masks.py")
    
def prepare_data_parallel(args):
    random_select_and_save(os.path.join(args.source_path, 'images'))
    tasks = [  
        ('extract_features', ['--image_root', args.source_path], args.ext_device.split(":")[1] ),  
        ('extract_segment_everything_masks', ['--image_root', args.source_path] + (['--divide'] if args.divide else []), args.mask_device.split(":")[1] ),
    ]  
    with multiprocessing.Pool(processes=2) as pool:  
        pool.starmap(run_script, tasks)
        
def train_contrastive_feature(args):
    tasks = [    
        ('train_contrastive_feature', ['-m', args.model_path, '--device', args.con_device, '--iterations', '30000'] + (['--divide'] if args.divide else []))    
    ]   
    with multiprocessing.Pool(processes=1) as pool:  
        pool.starmap(run_script, tasks) 

def SAGA(args, model, pipeline):
    promptSegment(args, model, pipeline)
    gaussians = render_sets_with_return(model.extract(args), args.iteration, pipeline.extract(args), True, True, True, 'scene', 0, args.precomputed_mask)
    return gaussians

if __name__ == "__main__":
    # lp, op, pp, args = read_args()
    # dataset = lp.extract(args)
    args, model, pipeline = init_args()
    # prepare_data(args)
    # # The steps below depend on the training pipeline having completed first.
    # # random_select_and_save(os.path.join(args.source_path, 'images'))
    # train_contrastive_feature(args)
    gaussians = SAGA(args, model, pipeline)
    # precomputed_mask = seg_mask(args.precomputed_mask)
    # bg_color = [1, 1, 1] if dataset.white_background else [0, 0, 0]
    # cam_infos, gaussians_info = RiskEvalFromFile(eval_checkpoint=args.eval_checkpoint, dataset=lp.extract(args), 
    #                                             opt=op.extract(args), pipe=pp.extract(args),
    #                                             bg_color=bg_color, selected_cams=None, 
    #                                             selected_gaussians=torch.squeeze(precomputed_mask), selected_frame=None, 
    #                                             frame_mask=None)
    # gaussians_infos_grad = gaussians_info.grad.detach().cpu().numpy().tolist()
    # with open('/path/to/static/test_model/cloud_grad.json', 'w') as json_file:
    #     json.dump(gaussians_infos_grad, json_file)