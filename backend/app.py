import logging
logging.basicConfig(level="INFO")
from flask import Flask, abort, jsonify, send_from_directory, request, send_file
from flask_cors import CORS  # Import the CORS module.
from flask_socketio import SocketIO, emit
from argparse import ArgumentParser, Namespace
from arguments import ModelParams, PipelineParams, OptimizationParams
from skimage.metrics import structural_similarity as ssim
from plyfile import PlyData
import torch
import cv2
import shutil,os,sys,json,base64,math,time,uuid
from datetime import datetime
import numpy as np
import open3d as o3d
from utils.general_utils import safe_state
from utils.graphics_utils import focal2fov
from utils.data_conv_utils import mesh2point,convert
from gaussian_renderer import network_gui
from train_scene import training_return_info
from risk_eval import RiskEval,RiskEvalFromFile,FrameMask,FrameFreeMask,RiskEvalFromFile_test
from prompt_segmenting import promptSegment,render_sets_with_return
from utils.system_utils import searchForMaxIteration
from media_utils import images_to_base64_from_dir,file_md5, image_to_base64
from metrics import cal_dis, get_chamfer_metrics, compute_and_save_chamfer_metrics
from prompt_segmenting import prepare_data, train_contrastive_feature, SAGA, seg_mask
from multiprocessing import Process 
import multiprocessing
import threading 
from PIL import Image
app = Flask(__name__, static_folder="static", static_url_path="/api/static")
# CORS(app)  # Enable CORS for the application.
CORS(app, resources={r"/*": {"origins": "*", "methods": "*"}})
socketio = SocketIO(app, cors_allowed_origins="*")
dif = 0.80
opt = pipe = gaussians = viewpoint_cams = precomputed_mask = None

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

def read_args():
    # Set up command line argument parser
    parser = ArgumentParser(description="Training script parameters")
    lp = ModelParams(parser)
    op = OptimizationParams(parser)
    pp = PipelineParams(parser)
    parser.add_argument('--ip', type=str, default="127.0.0.1")
    parser.add_argument('--port', type=int, default=6009)
    parser.add_argument('--debug_from', type=int, default=-1)
    parser.add_argument('--detect_anomaly', action='store_true', default=False)
    parser.add_argument("--test_iterations", nargs="+", type=int, default=[7_000, 30_000])
    parser.add_argument("--save_iterations", nargs="+", type=int, default=[7_000, 30_000])
    parser.add_argument("--quiet", action="store_true")
    parser.add_argument("--checkpoint_iterations", nargs="+", type=int, default=[])
    parser.add_argument("--start_checkpoint", type=str, default=None)
    parser.add_argument("--eval_checkpoint", type=str, default=None)
    parser.add_argument("--video_path", type=str, default=None)
    parser.add_argument("--iteration", default=-1, type=int)
    parser.add_argument("--skip_train", action="store_true")
    parser.add_argument("--skip_test", action="store_true")
    parser.add_argument("--segment", action="store_true")
    parser.add_argument('--target', default='scene', const='scene', nargs='?', choices=['scene', 'seg', 'feature', 'coarse_seg_everything', 'contrastive_feature', 'xyz'])
    parser.add_argument('--idx', default=0, type=int)
    parser.add_argument('--precomputed_mask', default=None, type=str)
    parser.add_argument('--ext_device', default="cuda", type=str)
    parser.add_argument('--mask_device', default="cuda", type=str)
    parser.add_argument('--con_device', default="cuda", type=str)
    parser.add_argument('--seg_device', default="cuda", type=str)
    parser.add_argument("--divide", action="store_true")
    args = parser.parse_args(sys.argv[1:])
    # args = get_combined_args(parser)
    args.save_iterations.append(args.iterations)
    if args.divide:
        args.images = "images_div"

    return lp, op, pp, args

lp, op, pp, args = read_args()
dataset = lp.extract(args)
SAM_process = None
# Initialize system state (RNG)
safe_state(args.quiet)

# Allow the caller to override source and model paths when needed.
def training_main(lp, op, pp, args, source_path=None, model_path=None):
    # print("Optimizing " + args.model_path)
    # change source_path and model_path information
    dataset = lp.extract(args)
    if source_path is not None:
        dataset.source_path = source_path
    if model_path is not None:
        dataset.model_path = model_path

    # Start GUI server, configure and run training
    network_gui.init(args.ip, args.port)
    torch.autograd.set_detect_anomaly(args.detect_anomaly)
    opt, pipe, gaussians, viewpoint_cams = training_return_info(dataset, op.extract(args), pp.extract(args),
                                                                args.test_iterations, args.save_iterations,
                                                                args.checkpoint_iterations, args.start_checkpoint,
                                                                args.debug_from)

    # All done
    # print("\nTraining complete.")
    return opt, pipe, gaussians, viewpoint_cams

def main_process():
    global lp, op, pp, args, dataset
    global opt, pipe, gaussians, viewpoint_cams, precomputed_mask

    _ = process_video(video_path = args.video_path
                  , source_path = dataset.source_path
                  , dif = 0.85)  
    convert(dataset.source_path)
    
    # Run SAM feature extraction and training in sequence.
    SAM_process = Process(target=prepare_data, args=(args,))
    SAM_process.start() 
    SAM_process.join() 
    
    opt, pipe, gaussians, viewpoint_cams = training_main(lp, op, pp, args)
    
    args = get_combined_args(args)

    # Run train_contrastive_feature.
    SAM_process = Process(target=train_contrastive_feature, args=(args,))
    SAM_process.start()  
    SAM_process.join()

    # Finish the SAM segmentation stage.
    promptSegment(args, lp, pp)
    
    render_sets_with_return(lp.extract(args), args.iteration, pp.extract(args), True, True, True, 'scene', 0, args.precomputed_mask)
    
    precomputed_mask = seg_mask(args.precomputed_mask)
    mesh2point(os.path.join(args.source_path, 'mesh.obj'), os.path.join(args.source_path, 'ground_truth.ply'), torch.sum(precomputed_mask).item())
    
    distances_1to2, distances_2to1, diagonal_length = cal_dis(os.path.join(args.model_path, 'point_cloud/SAGA.ply'),
            os.path.join(args.source_path, 'ground_truth.ply'),
            os.path.join(args.source_path, 'matrix.txt'))

    # Save the bidirectional distance arrays.
    np.savetxt(os.path.join(args.source_path, 'distances_1to2.txt'), distances_1to2)
    np.savetxt(os.path.join(args.source_path, 'distances_2to1.txt'), distances_2to1)

    # Compute and save Chamfer Distance metrics.
    chamfer_metrics = get_chamfer_metrics(distances_1to2, distances_2to1, diagonal_length)
    with open(os.path.join(args.source_path, 'chamfer_metrics.json'), 'w') as f:
        json.dump(chamfer_metrics, f, indent=4)

    bg_color = [1, 1, 1] if dataset.white_background else [0, 0, 0]
    cam_infos, gaussians_info = RiskEvalFromFile(eval_checkpoint=args.eval_checkpoint, dataset=lp.extract(args), 
                                                opt=op.extract(args), pipe=pp.extract(args),
                                                bg_color=bg_color, selected_cams=None, 
                                                selected_gaussians=torch.squeeze(precomputed_mask), selected_frame=None, 
                                                frame_mask=None, distance=distances)
    gaussians_infos_grad = gaussians_info.grad.detach().cpu().numpy().tolist()
    with open(os.path.join(args.source_path, 'cloud_grad.json'), 'w') as json_file:
        json.dump(gaussians_infos_grad, json_file)
    cam_infos_grad = []
    for i in cam_infos:
        cam_infos_grad.append(i.grad.detach().cpu().numpy().tolist())
    with open(os.path.join(args.source_path, 'cam_grad.json'), 'w') as json_file:
        json.dump(cam_infos_grad, json_file)


@app.route('/api/upload', methods=['POST'])
def upload():
    global lp, op, pp, args, dataset
    # Retrieve the uploaded video file.
    video_file = request.files['video']
    video_name = request.form['name']
    mesh = request.files['mesh']
    upload_root = os.path.dirname(args.source_path)
    temp_video_path = os.path.join(upload_root, f".upload_{uuid.uuid4().hex}.mp4")
    video_file.save(temp_video_path)
    id = file_md5(temp_video_path)
    path = find_path(id)
    if path != '':
        if os.path.exists(temp_video_path):
            os.remove(temp_video_path)
        return jsonify({'message':'ready',
                        'id':id})
    
    args.source_path = os.path.dirname(args.source_path)
    if os.path.exists(os.path.join(args.source_path, video_name)):
        cnt = 1
        while os.path.exists(os.path.join(args.source_path, "{}({})".format(video_name, cnt))):
            cnt += 1
        args.model_path = os.path.join(args.source_path, 'models')  
        args.model_path = os.path.join(args.model_path, "{}({})".format(video_name, cnt))   
        args.source_path = os.path.join(args.source_path, "{}({})".format(video_name, cnt))
    else:
        args.model_path = os.path.join(args.source_path, 'models')  
        args.model_path = os.path.join(args.model_path, video_name)    
        args.source_path = os.path.join(args.source_path, video_name)
    os.makedirs(args.source_path)
    os.makedirs(args.model_path)
    args.eval_checkpoint = os.path.join(args.model_path, "chkpnt{}.pth".format(args.checkpoint_iterations[-1]))
    args.video_path = os.path.join(args.source_path, 'model.mp4')
    args.precomputed_mask = os.path.join(args.model_path, 'segmentation_res/final_mask.pt')
    dataset = lp.extract(args)
    
    # with open(os.path.join(args.source_path, 'id.txt'), 'w') as file:
    #     file.write(id)
    shutil.copyfile(temp_video_path, args.video_path)
    if os.path.exists(temp_video_path):
        os.remove(temp_video_path)
    mesh.save(os.path.join(args.source_path, 'mesh.obj'))

    Main_process = Process(target=main_process)
    Main_process.start()  
    return jsonify({'message':'processing',
                        'id':id})

def normalize_list(input_list, input_list_init = None):
    input_list = [i if i > 0 else 0 for i in input_list]
    max_value = max(input_list)
    min_value = 0
    if input_list_init != None:
        max_value = max(max_value, max(input_list_init))
        min_value = 0
    if max_value != min_value:
        normalized_list = [(x - min_value) / (max_value - min_value) for x in input_list]
        return normalized_list
    return input_list

def normalize_with_filter(input_list, input_list_init = None):
    sorted_list = sorted(input_list)
    input_list = [i if i > 0 else 0 for i in input_list]
    num = sum(x > 0 for x in input_list)
    num = int(0.01 * num)
    input_list = [input_list[i] if input_list[i] < sorted_list[-num] else sorted_list[-num] for i in range(len(input_list))]
    max_value = max(input_list)
    min_value = 0
    if input_list_init != None:
        input_list_init_sorted = sorted(input_list_init)
        max_value = max(max_value, input_list_init_sorted[-int(0.01 * len(input_list_init))])
        min_value = 0
    if max_value != min_value:
        normalized_list = [(x - min_value) / (max_value - min_value) for x in input_list]
        return normalized_list
    return input_list

def calculate_histogram(image):
    hist = cv2.calcHist([image], [0, 1, 2], None, [8, 8, 8], [0, 256, 0, 256, 0, 256])
    hist = cv2.normalize(hist, hist).flatten()
    return hist

def calculate_ssim(image1, image2):
    gray1 = cv2.cvtColor(image1, cv2.COLOR_BGR2GRAY)
    gray2 = cv2.cvtColor(image2, cv2.COLOR_BGR2GRAY)
    ssim_score, _ = ssim(gray1, gray2, full=True)
    return ssim_score

def calculate_similarity(image1, image2, weight_histogram=0.5):
    hist1 = calculate_histogram(image1)
    hist2 = calculate_histogram(image2)
    ssim_score = calculate_ssim(image1, image2)
    
    similarity_score = (1 - weight_histogram) * ssim_score + weight_histogram * cv2.compareHist(hist1, hist2, cv2.HISTCMP_CORREL)
    return similarity_score

def process_video(video_path, source_path, dif, exists = None):
    # Save the video as frames and collect cluster start indices.
    cap = cv2.VideoCapture(video_path)
    starts = [] # Record the start index of each cluster.
    frames = []
    output_path = os.path.join(source_path, 'input')
    flag = False
    if not os.path.exists(output_path):
        os.makedirs(output_path)
    flag = True
    cnt = 0
    last_frame = None
    miss_cnt = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if (exists is not None) and (not cnt in exists):
            miss_cnt += 1
            cnt += 1
            continue
        if  len(frames) == 0 or calculate_similarity(frame, frames[-1]) < dif or calculate_similarity(frame, last_frame) < 0.35:
            starts.append(cnt - miss_cnt)
            frames.append(frame)
        if flag:
            frame_filename = f"image{cnt}.jpg"
            cv2.imwrite(os.path.join(output_path, frame_filename), frame)
        last_frame = frame
        cnt += 1
    return starts

@app.route('/api/data/<string:id>/select_point_cloud', methods=['POST'])
def select_point_cloud(id):
    global args
    save_path = find_path(id)
    parent_dir = os.path.dirname(save_path)
    file_name = os.path.basename(save_path)
    model_path = os.path.join(os.path.join(parent_dir, 'models'), file_name)
    mask_path = os.path.join(model_path, 'segmentation_res/final_mask.pt')
    distance_path = os.path.join(save_path, 'distances.txt')
    if save_path == '' or (not os.path.exists(mask_path)) or (not os.path.exists(distance_path)):
        abort(404)
    with open(distance_path, 'r') as file:
        distance_list = [float(line.strip()) for line in file]
    precomputed_mask = torch.load(mask_path, map_location=lambda storage, loc: storage.cuda(0))
    data = request.get_json()
    SAGA_mask = data['selected_cloud']
    SAGA_mask = sorted(SAGA_mask)
    include_chamfer_metrics = data.get('include_chamfer_metrics', False)
    selected_gt = data.get('selected_gt', None)  # Optional ground-truth point indices selected in the front end.
    if selected_gt is not None:
        selected_gt = sorted(selected_gt)

    mask = []
    distance_list_new = []
    cnt = 0
    now_idx = 0
    for i in range(precomputed_mask.shape[0]):
        if precomputed_mask[i, 0].item():
            if now_idx < len(SAGA_mask) and cnt == SAGA_mask[now_idx]:
                mask.append(True)
                distance_list_new.append(distance_list[cnt])
                now_idx += 1
            else:
                mask.append(False)
            cnt += 1
        else:
            mask.append(False)
    args.source_path = save_path
    args.model_path = model_path
    bg_color = [1, 1, 1] if dataset.white_background else [0, 0, 0]
    eval_checkpoint = os.path.join(model_path, 'chkpnt' + str(searchForMaxIteration(os.path.join(model_path, 'point_cloud'))) + '.pth')
    cam_infos, gaussians_info = RiskEvalFromFile_test(eval_checkpoint=eval_checkpoint, dataset=lp.extract(args),
                                                opt=op.extract(args), pipe=pp.extract(args),
                                                bg_color=bg_color, selected_cams=None,
                                                selected_gaussians=torch.tensor(mask), selected_frame=None,
                                                frame_masks=None, distance=distance_list_new)
    gaussians_infos_grad = gaussians_info.grad.detach().cpu().numpy().tolist()
    cloud_grad = []
    for i in range(precomputed_mask.shape[0]):
        if precomputed_mask[i, 0].item():
            cloud_grad.append(gaussians_infos_grad[i])
    cam_infos_grad = []
    for i in cam_infos:
        cam_infos_grad.append(i.grad.detach().cpu().numpy().tolist())   
    cloud_grad_path = os.path.join(save_path, 'cloud_grad.json')
    cam_grad_path = os.path.join(save_path, 'cam_grad.json')
    with open(cloud_grad_path, 'r') as json_file:
        cloud_grad_init = json.load(json_file)
    with open(cam_grad_path, 'r') as json_file:
        cam_infos_grad_init = json.load(json_file)
    cloud_grad = normalize_with_filter(cloud_grad)
    cam_infos_grad = normalize_list(cam_infos_grad) 
    cloud_grad = [float('%.5g'%i) for i in cloud_grad]
    cam_infos_grad = [float('%.5g'%i)  for i in cam_infos_grad]
    points, min_vals, max_vals = get_minmax(model_path)
    max_abs = np.max(np.abs([min_vals, max_vals]))
    points = points / max_abs
    points = points.tolist()
    cloud = group(points)
    for i in range(len(cloud)):
        for j in range(len(cloud[i])):
            cloud[i][j]['risk'] = float('%.5g'%cloud_grad[cloud[i][j]['idx']])
            cloud[i][j]['similarity'] = float('%.5g'%distance_list[cloud[i][j]['idx']])
    response_data = {
        'cloud_risk': cloud,
        'cam_risk':cam_infos_grad
    }

    # Compute and attach Chamfer metrics when the request asks for them.
    if include_chamfer_metrics:
        try:
            if len(distance_list_new) > 0:
                # Recompute the bidirectional Chamfer Distance for the selected points.
                SAGA_path = os.path.join(model_path, 'point_cloud/SAGA.ply')
                gt_path = os.path.join(save_path, 'ground_truth.ply')
                matrix_path = os.path.join(save_path, 'matrix.txt')

                if os.path.exists(SAGA_path) and os.path.exists(gt_path) and os.path.exists(matrix_path):
                    from CAL import cal_dis_selected, get_chamfer_metrics

                    # Collect the indices of the selected SAGA points.
                    selected_indices = []
                    cnt = 0
                    for i in range(precomputed_mask.shape[0]):
                        if precomputed_mask[i, 0].item():
                            if mask[i]:  # Keep points that are currently selected.
                                selected_indices.append(cnt)
                            cnt += 1

                    # Use cal_dis_selected to compute the bidirectional distances.
                    distances_1to2, distances_2to1, diagonal_length = cal_dis_selected(
                        SAGA_path, gt_path, matrix_path, selected_indices, selected_gt
                    )

                    # Compute the bidirectional Chamfer metrics.
                    chamfer_metrics = get_chamfer_metrics(distances_1to2, distances_2to1, diagonal_length)
                    response_data['chamfer_metrics'] = chamfer_metrics
        except Exception:
            # Do not block the main flow; still return the risk data.
            pass

    # Save cloud_risk as a JSON file
    with open(os.path.join(args.source_path, 'cloud_grad_select.json'), 'w') as json_file:
        json.dump(cloud, json_file)

    # Save cam_risk as a JSON file
    with open(os.path.join(args.source_path, 'cam_grad_select.json'), 'w') as json_file:
        json.dump(cam_infos_grad, json_file)
    return jsonify(response_data)

# def base642matrix(base64_data, width):
#     binary_data = base64.b64decode(base64_data)
#     boolean_matrix = []
#     current_row = []
#     for byte in binary_data:
#         for i in range(8):
#             bit = (byte >> (7 - i)) & 1
#             current_row.append(bool(bit))
#             if len(current_row) == width:
#                 boolean_matrix.append(current_row)
#                 current_row = []
#     return boolean_matrix

# def base642matrix(base64_data, width):  
#     binary_data = base64.b64decode(base64_data)  
#     boolean_array = np.unpackbits(np.frombuffer(binary_data, dtype=np.uint8))  
#     boolean_matrix = boolean_array.reshape((-1, width))
#     # Invert the boolean matrix  
#     inverted_matrix = np.logical_not(boolean_matrix)  
#     return inverted_matrix.tolist() 

def base642matrix(base64_data, width):    
    binary_data = base64.b64decode(base64_data)    
    boolean_array = np.unpackbits(np.frombuffer(binary_data, dtype=np.uint8))    
  
    # Calculate the number of padding bits  
    padding_bits = boolean_array.size % width
    if padding_bits > 0:  
        # Remove the padding bits  
        boolean_array = boolean_array[:-padding_bits] 
    # print("len:", len(boolean_array), padding_bits)
  
    boolean_matrix = boolean_array.reshape((-1, width))  
    # Invert the boolean matrix    
    inverted_matrix = np.logical_not(boolean_matrix)    
    return inverted_matrix.tolist()   

@app.route('/api/data/<string:id>/frame_freemask_withbase64', methods=['POST'])
def frame_freemask_withbase64(id):
    global args
    save_path = find_path(id)
    parent_dir = os.path.dirname(save_path)
    file_name = os.path.basename(save_path)
    model_path = os.path.join(os.path.join(parent_dir, 'models'), file_name)
    data = request.get_json()
    base64_datas = data['base64_data']
    width = int(data['width'])
    print("1")
    mask_matrixs = [base642matrix(base64_data, width) for base64_data in base64_datas]
    
    # Convert each mask matrix to an image  
    images = []  
    for mask_matrix in mask_matrixs:  
        mask_image = np.array(mask_matrix, dtype=np.uint8) * 255  # Convert True to 255 and False to 0  
        mask_image = Image.fromarray(mask_image)  
        images.append(mask_image)  
    # Save the images as a GIF animation  
    images[0].save('mask_images.gif', save_all=True, append_images=images[1:], loop=0)  
    
    print("2")
    selected_frame = torch.BoolTensor(data['selected_frame'])
    frame_masks = [FrameFreeMask(mask_matrix) for mask_matrix in mask_matrixs]
    mask_path = os.path.join(model_path, 'segmentation_res/final_mask.pt')
    distance_path = os.path.join(save_path, 'distances.txt')
    if save_path == '' or (not os.path.exists(mask_path)) or (not os.path.exists(distance_path)):
        abort(404)
    print("3")
    precomputed_mask = torch.load(mask_path, map_location=lambda storage, loc: storage.cuda(0))
    print("4")
    with open(distance_path, 'r') as file:
        distance_list = [float(line.strip()) for line in file]
    bg_color = [1, 1, 1] if dataset.white_background else [0, 0, 0]
    args.source_path = save_path
    args.model_path = model_path
    eval_checkpoint = os.path.join(model_path, 'chkpnt' + str(searchForMaxIteration(os.path.join(model_path, 'point_cloud'))) + '.pth')
    cam_infos, gaussians_info = RiskEvalFromFile_test(eval_checkpoint=eval_checkpoint, dataset=lp.extract(args), 
                                                opt=op.extract(args), pipe=pp.extract(args),
                                                bg_color=bg_color, selected_cams=None, 
                                                selected_gaussians=torch.squeeze(precomputed_mask), selected_frame=selected_frame, 
                                                frame_masks=frame_masks, distance=distance_list)
    gaussians_infos_grad = gaussians_info.grad.detach().cpu().numpy().tolist()
    cloud_grad = []
    for i in range(precomputed_mask.shape[0]):
        if precomputed_mask[i, 0].item():
            cloud_grad.append(gaussians_infos_grad[i])
    cam_infos_grad = []
    for i in cam_infos:
        cam_infos_grad.append(i.grad.detach().cpu().numpy().tolist())

    cam_infos_init, gaussians_info_init = RiskEvalFromFile_test(eval_checkpoint=eval_checkpoint, dataset=lp.extract(args), 
                                                    opt=op.extract(args), pipe=pp.extract(args),
                                                    bg_color=bg_color, selected_cams=None, 
                                                    selected_gaussians=torch.squeeze(precomputed_mask), selected_frame=None, 
                                                    frame_masks=None, distance=distance_list)
    gaussians_infos_grad_init = gaussians_info_init.grad.detach().cpu().numpy().tolist()
    cloud_grad_init = []
    for i in range(precomputed_mask.shape[0]):
        if precomputed_mask[i, 0].item():
            cloud_grad_init.append(gaussians_infos_grad_init[i])
    cam_infos_grad_init = []
    for i in cam_infos_init:
        cam_infos_grad_init.append(i.grad.detach().cpu().numpy().tolist())  
    cloud_grad = [cloud_grad_init[i] - cloud_grad[i] for i in range(len(cloud_grad))]
    cam_infos_grad = [cam_infos_grad_init[i] - cam_infos_grad[i] for i in range(len(cam_infos_grad))]
    cloud_grad = normalize_with_filter(cloud_grad, cloud_grad_init)
    cam_infos_grad = normalize_list(cam_infos_grad, cam_infos_grad_init)
    cloud_grad = [float('%.5g'%i) for i in cloud_grad]
    cam_infos_grad = [float('%.5g'%i)  for i in cam_infos_grad]     
    
    points, min_vals, max_vals = get_minmax(model_path)
    max_abs = np.max(np.abs([min_vals, max_vals]))
    points = points / max_abs
    points = points.tolist()
    cloud = group(points)
    for i in range(len(cloud)):
        for j in range(len(cloud[i])):
            cloud[i][j]['risk'] = float('%.5g'%cloud_grad[cloud[i][j]['idx']])
            cloud[i][j]['similarity'] = float('%.5g'%distance_list[cloud[i][j]['idx']])

    response_data = {
        'cloud_risk': cloud,
        'cam_risk':cam_infos_grad
    }

    return jsonify(response_data)

@app.route('/api/data/<string:id>/frame_freemask', methods=['POST'])
def process_frame_freemask(id):
    global args
    save_path = find_path(id)
    parent_dir = os.path.dirname(save_path)
    file_name = os.path.basename(save_path)
    model_path = os.path.join(os.path.join(parent_dir, 'models'), file_name)
    data = request.get_json()
    mask_matrixs = data['mask_matrixs']
    selected_frame = torch.BoolTensor(data['selected_frame'])
    frame_masks = [FrameFreeMask(np.array(mask_matrix).transpose()) for mask_matrix in mask_matrixs]
    mask_path = os.path.join(model_path, 'segmentation_res/final_mask.pt')
    distance_path = os.path.join(save_path, 'distances.txt')
    if save_path == '' or (not os.path.exists(mask_path)) or (not os.path.exists(distance_path)):
        abort(404)
    precomputed_mask = torch.load(mask_path, map_location=lambda storage, loc: storage.cuda(0))
    with open(distance_path, 'r') as file:
        distance_list = [float(line.strip()) for line in file]
    bg_color = [1, 1, 1] if dataset.white_background else [0, 0, 0]
    args.source_path = save_path
    args.model_path = model_path
    eval_checkpoint = os.path.join(model_path, 'chkpnt' + str(searchForMaxIteration(os.path.join(model_path, 'point_cloud'))) + '.pth')
    cam_infos, gaussians_info = RiskEvalFromFile_test(eval_checkpoint=eval_checkpoint, dataset=lp.extract(args), 
                                                opt=op.extract(args), pipe=pp.extract(args),
                                                bg_color=bg_color, selected_cams=None, 
                                                selected_gaussians=torch.squeeze(precomputed_mask), selected_frame=selected_frame, 
                                                frame_masks=frame_masks, distance=distance_list)
    gaussians_infos_grad = gaussians_info.grad.detach().cpu().numpy().tolist()
    cloud_grad = []
    for i in range(precomputed_mask.shape[0]):
        if precomputed_mask[i, 0].item():
            cloud_grad.append(gaussians_infos_grad[i])
    cam_infos_grad = []
    for i in cam_infos:
        cam_infos_grad.append(i.grad.detach().cpu().numpy().tolist())

    cam_infos_init, gaussians_info_init = RiskEvalFromFile_test(eval_checkpoint=eval_checkpoint, dataset=lp.extract(args), 
                                                    opt=op.extract(args), pipe=pp.extract(args),
                                                    bg_color=bg_color, selected_cams=None, 
                                                    selected_gaussians=torch.squeeze(precomputed_mask), selected_frame=None, 
                                                    frame_masks=None, distance=distance_list)
    gaussians_infos_grad_init = gaussians_info_init.grad.detach().cpu().numpy().tolist()
    cloud_grad_init = []
    for i in range(precomputed_mask.shape[0]):
        if precomputed_mask[i, 0].item():
            cloud_grad_init.append(gaussians_infos_grad_init[i])
    cam_infos_grad_init = []
    for i in cam_infos_init:
        cam_infos_grad_init.append(i.grad.detach().cpu().numpy().tolist())  
    cloud_grad = [cloud_grad_init[i] - cloud_grad[i] for i in range(len(cloud_grad))]
    cam_infos_grad = [cam_infos_grad_init[i] - cam_infos_grad[i] for i in range(len(cam_infos_grad))]
    cloud_grad = normalize_with_filter(cloud_grad, cloud_grad_init)
    cam_infos_grad = normalize_list(cam_infos_grad, cam_infos_grad_init)
    cloud_grad = [float('%.5g'%i) for i in cloud_grad]
    cam_infos_grad = [float('%.5g'%i)  for i in cam_infos_grad]     
    
    points, min_vals, max_vals = get_minmax(model_path)
    max_abs = np.max(np.abs([min_vals, max_vals]))
    points = points / max_abs
    points = points.tolist()
    cloud = group(points)
    for i in range(len(cloud)):
        for j in range(len(cloud[i])):
            cloud[i][j]['risk'] = float('%.5g'%cloud_grad[cloud[i][j]['idx']])
            cloud[i][j]['similarity'] = float('%.5g'%distance_list[cloud[i][j]['idx']])

    response_data = {
        'cloud_risk': cloud,
        'cam_risk':cam_infos_grad
    }

    return jsonify(response_data)

@app.route('/api/data/<string:id>/frame_mask', methods=['POST'])
def process_frame_mask(id):
    global args
    save_path = find_path(id)
    parent_dir = os.path.dirname(save_path)
    file_name = os.path.basename(save_path)
    model_path = os.path.join(os.path.join(parent_dir, 'models'), file_name)
    data = request.get_json()
    mask = data['mask']
    selected_frame = torch.BoolTensor(data['selected_frame'])
    frame_mask = FrameMask(int(mask[0]), int(mask[1]), int(mask[2]), int(mask[3]))
    mask_path = os.path.join(model_path, 'segmentation_res/final_mask.pt')
    distance_path = os.path.join(save_path, 'distances.txt')
    if save_path == '' or (not os.path.exists(mask_path)) or (not os.path.exists(distance_path)):
        abort(404)
    precomputed_mask = torch.load(mask_path, map_location=lambda storage, loc: storage.cuda(0))
    with open(distance_path, 'r') as file:
        distance_list = [float(line.strip()) for line in file]
    bg_color = [1, 1, 1] if dataset.white_background else [0, 0, 0]
    args.source_path = save_path
    args.model_path = model_path
    eval_checkpoint = os.path.join(model_path, 'chkpnt' + str(searchForMaxIteration(os.path.join(model_path, 'point_cloud'))) + '.pth')
    cam_infos, gaussians_info = RiskEvalFromFile(eval_checkpoint=eval_checkpoint, dataset=lp.extract(args), 
                                                opt=op.extract(args), pipe=pp.extract(args),
                                                bg_color=bg_color, selected_cams=None, 
                                                selected_gaussians=torch.squeeze(precomputed_mask), selected_frame=selected_frame, 
                                                frame_mask=frame_mask, distance=distance_list)
    gaussians_infos_grad = gaussians_info.grad.detach().cpu().numpy().tolist()
    cloud_grad = []
    for i in range(precomputed_mask.shape[0]):
        if precomputed_mask[i, 0].item():
            cloud_grad.append(gaussians_infos_grad[i])
    cam_infos_grad = []
    for i in cam_infos:
        cam_infos_grad.append(i.grad.detach().cpu().numpy().tolist())

    cam_infos_init, gaussians_info_init = RiskEvalFromFile(eval_checkpoint=eval_checkpoint, dataset=lp.extract(args), 
                                                    opt=op.extract(args), pipe=pp.extract(args),
                                                    bg_color=bg_color, selected_cams=None, 
                                                    selected_gaussians=torch.squeeze(precomputed_mask), selected_frame=None, 
                                                    frame_mask=None, distance=distance_list)
    gaussians_infos_grad_init = gaussians_info_init.grad.detach().cpu().numpy().tolist()
    cloud_grad_init = []
    for i in range(precomputed_mask.shape[0]):
        if precomputed_mask[i, 0].item():
            cloud_grad_init.append(gaussians_infos_grad_init[i])
    cam_infos_grad_init = []
    for i in cam_infos_init:
        cam_infos_grad_init.append(i.grad.detach().cpu().numpy().tolist())  
    cloud_grad = [cloud_grad_init[i] - cloud_grad[i] for i in range(len(cloud_grad))]
    cam_infos_grad = [cam_infos_grad_init[i] - cam_infos_grad[i] for i in range(len(cam_infos_grad))]
    cloud_grad = normalize_with_filter(cloud_grad, cloud_grad_init)
    cam_infos_grad = normalize_list(cam_infos_grad, cam_infos_grad_init)
    cloud_grad = [float('%.5g'%i) for i in cloud_grad]
    cam_infos_grad = [float('%.5g'%i)  for i in cam_infos_grad]     
    
    points, min_vals, max_vals = get_minmax(model_path)
    max_abs = np.max(np.abs([min_vals, max_vals]))
    points = points / max_abs
    points = points.tolist()
    cloud = group(points)
    for i in range(len(cloud)):
        for j in range(len(cloud[i])):
            cloud[i][j]['risk'] = float('%.5g'%cloud_grad[cloud[i][j]['idx']])
            cloud[i][j]['similarity'] = float('%.5g'%distance_list[cloud[i][j]['idx']])

    response_data = {
        'cloud_risk': cloud,
        'cam_risk':cam_infos_grad
    }

    return jsonify(response_data)

@app.route('/api/data/<string:id>/freemask_with_select', methods=['POST'])
def freemask_with_select(id):
    global args
    save_path = find_path(id)
    parent_dir = os.path.dirname(save_path)
    file_name = os.path.basename(save_path)
    model_path = os.path.join(os.path.join(parent_dir, 'models'), file_name)
    data = request.get_json()
    base64_datas = data['base64_data']
    width = int(data['width'])
    mask_matrixs = [base642matrix(base64_data, width) for base64_data in base64_datas]
    frame_masks = [FrameFreeMask(mask_matrix) for mask_matrix in mask_matrixs]
    selected_frame = torch.BoolTensor(data['selected_frame'])

    SAGA_mask = data['selected_cloud']
    SAGA_mask = sorted(SAGA_mask)
    mask_path = os.path.join(model_path, 'segmentation_res/final_mask.pt')
    distance_path = os.path.join(save_path, 'distances.txt')
    if save_path == '' or (not os.path.exists(mask_path)) or (not os.path.exists(distance_path)):
        abort(404)
    precomputed_mask = torch.load(mask_path, map_location=lambda storage, loc: storage.cuda(0))
    with open(distance_path, 'r') as file:
        distance_list = [float(line.strip()) for line in file]
    mask = []
    distance_list_new = []
    cnt = 0
    now_idx = 0
    for i in range(precomputed_mask.shape[0]):
        if precomputed_mask[i, 0].item():
            if SAGA_mask == [] or now_idx < len(SAGA_mask) and cnt == SAGA_mask[now_idx]:
                mask.append(True)
                distance_list_new.append(distance_list[cnt])
                now_idx += 1
            else:
                mask.append(False)
            cnt += 1
        else:
            mask.append(False)

    bg_color = [1, 1, 1] if dataset.white_background else [0, 0, 0]
    args.source_path = save_path
    args.model_path = model_path
    eval_checkpoint = os.path.join(model_path, 'chkpnt' + str(
        searchForMaxIteration(os.path.join(model_path, 'point_cloud'))) + '.pth')
    cam_infos, gaussians_info = RiskEvalFromFile_test(eval_checkpoint=eval_checkpoint, dataset=lp.extract(args),
                                                      opt=op.extract(args), pipe=pp.extract(args),
                                                      bg_color=bg_color, selected_cams=None,
                                                      selected_gaussians=torch.tensor(mask),
                                                      selected_frame=selected_frame,
                                                      frame_masks=frame_masks, distance=distance_list_new)
    gaussians_infos_grad = gaussians_info.grad.detach().cpu().numpy().tolist()
    cloud_grad = []
    for i in range(precomputed_mask.shape[0]):
        if precomputed_mask[i, 0].item():
            cloud_grad.append(gaussians_infos_grad[i])
    cam_infos_grad = []
    for i in cam_infos:
        cam_infos_grad.append(i.grad.detach().cpu().numpy().tolist())

    # cam_infos_init, gaussians_info_init = RiskEvalFromFile_test(eval_checkpoint=eval_checkpoint,
    #                                                             dataset=lp.extract(args),
    #                                                             opt=op.extract(args), pipe=pp.extract(args),
    #                                                             bg_color=bg_color, selected_cams=None,
    #                                                             selected_gaussians=torch.squeeze(precomputed_mask),
    #                                                             selected_frame=None,
    #                                                             frame_masks=None, distance=distance_list)

    # Try to load risk data from plans.json; fall back to the original files otherwise.
    plans_path = os.path.join(save_path, 'plans.json')
    use_plan_risk = False

    if os.path.exists(plans_path):
        try:
            with open(plans_path, 'r') as f:
                plans_data = json.load(f)
                if plans_data.get("current_plan") and plans_data["current_plan"].get("risk"):
                    # Load risk data from plans.json.
                    plan_risk = plans_data["current_plan"]["risk"]
                    cloud_risk_from_plan = plan_risk.get("cloud_risk", [])
                    cam_risk_from_plan = plan_risk.get("cam_risk", [])

                    # Extract cloud_grad_init.
                    cloud_grad_init = []
                    for group_data in cloud_risk_from_plan:
                        for item in group_data:
                            if 'risk' in item:
                                cloud_grad_init.append(item['risk'])

                    # Extract cam_infos_grad_init.
                    cam_infos_grad_init = cam_risk_from_plan
                    use_plan_risk = True
        except Exception as e:
            print(f"Failed to load risk from plans.json: {e}")
            use_plan_risk = False

    # Use the original files when plans.json does not provide risk data.
    if not use_plan_risk:
        cloud_grad_path = os.path.join(save_path, 'cloud_grad_select.json')
        cam_grad_path = os.path.join(save_path, 'cam_grad_select.json')
        with open(cloud_grad_path, 'r') as json_file:
            gaussians_infos_grad_init = json.load(json_file)
        with open(cam_grad_path, 'r') as json_file:
            cam_infos_grad_init = json.load(json_file)
        cloud_grad_init = []
        for i in range(len(gaussians_infos_grad_init)):
            # if precomputed_mask[i, 0].item():
            cloud_grad_init.append(gaussians_infos_grad_init[i][0]["risk"])
    # cloud_grad = [cloud_grad_init[i] - cloud_grad[i] for i in range(len(cloud_grad))]
    # cam_infos_grad = [cam_infos_grad_init[i] - cam_infos_grad[i] for i in range(len(cam_infos_grad))]
    # cloud_grad = normalize_with_filter(cloud_grad, cloud_grad_init)
    # cam_infos_grad = normalize_list(cam_infos_grad, cam_infos_grad_init)
    cloud_grad = normalize_with_filter(cloud_grad, cloud_grad_init)
    cam_infos_grad = normalize_list(cam_infos_grad, cam_infos_grad_init)
    cloud_grad = [float('%.5g' % i) for i in cloud_grad]
    cam_infos_grad = [float('%.5g' % i) for i in cam_infos_grad]

    points, min_vals, max_vals = get_minmax(model_path)
    max_abs = np.max(np.abs([min_vals, max_vals]))
    points = points / max_abs
    points = points.tolist()
    cloud = group(points)
    for i in range(len(cloud)):
        for j in range(len(cloud[i])):
            cloud[i][j]['risk'] = float('%.5g' % cloud_grad[cloud[i][j]['idx']])
            cloud[i][j]['similarity'] = float('%.5g' % distance_list[cloud[i][j]['idx']])

    response_data = {
        'cloud_risk': cloud,
        'cam_risk': cam_infos_grad
    }

    return jsonify(response_data)

@app.route('/api/data/<string:id>/mask_with_select', methods=['POST'])
def mask_with_select(id):
    global args
    save_path = find_path(id)
    parent_dir = os.path.dirname(save_path)
    file_name = os.path.basename(save_path)
    model_path = os.path.join(os.path.join(parent_dir, 'models'), file_name)
    data = request.get_json()
    mask_ = data['mask']
    SAGA_mask = data['selected_cloud']
    SAGA_mask = sorted(SAGA_mask)
    
    # selected_frame is expected to be a PyTorch tensor.
    selected_frame = torch.BoolTensor(data['selected_frame'])

    # Convert the PyTorch tensor to a NumPy array.
    selected_frame_np = selected_frame.numpy()

    # Convert the NumPy array to a Python list.
    selected_frame_list = selected_frame_np.tolist()
    frame_mask = FrameMask(int(mask_[0]), int(mask_[1]), int(mask_[2]), int(mask_[3]))
    mask_path = os.path.join(model_path, 'segmentation_res/final_mask.pt')
    distance_path = os.path.join(save_path, 'distances.txt')
    if save_path == '' or (not os.path.exists(mask_path)) or (not os.path.exists(distance_path)):
        abort(404)
    precomputed_mask = torch.load(mask_path, map_location=lambda storage, loc: storage.cuda(0))
    with open(distance_path, 'r') as file:
        distance_list = [float(line.strip()) for line in file]
    mask = []
    distance_list_new = []
    cnt = 0
    now_idx = 0
    for i in range(precomputed_mask.shape[0]):
        if precomputed_mask[i, 0].item():
            if SAGA_mask == [] or now_idx < len(SAGA_mask) and cnt == SAGA_mask[now_idx]:
                mask.append(True)
                distance_list_new.append(distance_list[cnt])
                now_idx += 1
            else:
                mask.append(False)
            cnt += 1
        else:
            mask.append(False)
    bg_color = [1, 1, 1] if dataset.white_background else [0, 0, 0]
    args.source_path = save_path
    args.model_path = model_path
    eval_checkpoint = os.path.join(model_path, 'chkpnt' + str(searchForMaxIteration(os.path.join(model_path, 'point_cloud'))) + '.pth')
    cam_infos, gaussians_info = RiskEvalFromFile(eval_checkpoint=eval_checkpoint, dataset=lp.extract(args), 
                                                opt=op.extract(args), pipe=pp.extract(args),
                                                bg_color=bg_color, selected_cams=None, 
                                                selected_gaussians=torch.tensor(mask), selected_frame=selected_frame, 
                                                frame_mask=frame_mask, distance=distance_list_new)
    gaussians_infos_grad = gaussians_info.grad.detach().cpu().numpy().tolist()
    cloud_grad = []
    for i in range(precomputed_mask.shape[0]):
        if precomputed_mask[i, 0].item():
            cloud_grad.append(gaussians_infos_grad[i])
    cam_infos_grad = []
    for i in cam_infos:
        cam_infos_grad.append(i.grad.detach().cpu().numpy().tolist())

    cam_infos_init, gaussians_info_init = RiskEvalFromFile(eval_checkpoint=eval_checkpoint, dataset=lp.extract(args), 
                                                opt=op.extract(args), pipe=pp.extract(args),
                                                bg_color=bg_color, selected_cams=None, 
                                                selected_gaussians=torch.tensor(mask), selected_frame=None, 
                                                frame_mask=None, distance=distance_list_new)
    gaussians_infos_grad_init = gaussians_info_init.grad.detach().cpu().numpy().tolist()
    cloud_grad_init = []
    for i in range(precomputed_mask.shape[0]):
        if precomputed_mask[i, 0].item():
            cloud_grad_init.append(gaussians_infos_grad_init[i])
    cam_infos_grad_init = []
    for i in cam_infos_init:
        cam_infos_grad_init.append(i.grad.detach().cpu().numpy().tolist())

    cloud_grad = [cloud_grad_init[i] - cloud_grad[i] for i in range(len(cloud_grad))]
    cam_infos_grad = [cam_infos_grad_init[i] - cam_infos_grad[i] for i in range(len(cam_infos_grad))]
    # cloud_grad_path = os.path.join(save_path, 'cloud_grad.json')
    # cam_grad_path = os.path.join(save_path, 'cam_grad.json')
    # with open(cloud_grad_path, 'r') as json_file:
    #     cloud_grad_init = json.load(json_file)
    # with open(cam_grad_path, 'r') as json_file:
    #     cam_infos_grad_init = json.load(json_file)
    cloud_grad = normalize_with_filter(cloud_grad, cloud_grad_init)
    cam_infos_grad = normalize_list(cam_infos_grad, cam_infos_grad_init)
    cloud_grad = [float('%.5g'%i) for i in cloud_grad]
    cam_infos_grad = [float('%.5g'%i)  for i in cam_infos_grad]     
    
    points, min_vals, max_vals = get_minmax(model_path)
    max_abs = np.max(np.abs([min_vals, max_vals]))
    points = points / max_abs
    points = points.tolist()
    cloud = group(points)
    for i in range(len(cloud)):
        for j in range(len(cloud[i])):
            cloud[i][j]['risk'] = cloud_grad[cloud[i][j]['idx']]
            cloud[i][j]['similarity'] = float('%.5g'%distance_list[cloud[i][j]['idx']])
    
    response_data = {
        'cloud_risk': cloud,
        'cam_risk':cam_infos_grad
    }

    return jsonify(response_data)


@app.route('/api/data/<string:id>/export_modified_video', methods=['POST'])
def export_modified_video(id):
    """Receive edit plan and produce an edited mp4 saved in a versioned folder.

    Expected JSON (two fields relevant to masks):
      - selected_frame: optional list[bool] marking which frames are being edited. If omitted and
        masks are provided, masks are mapped sequentially to frames starting at 0.
      - base64_data: list of bit-packed base64 mask strings (each decoded with `width`).
      - width: integer width used to decode each base64 mask.
    Optional:
      - delete_frames: list of integer frame indices to remove from the output.
    Returns JSON with new folder and video path on success.
    """
    data = request.get_json()

    save_path = find_path(id)
    if save_path == '' or data is None:
        abort(404)

    src_video = os.path.join(save_path, 'model.mp4')
    if not os.path.exists(src_video):
        abort(404)

    parent_dir = os.path.dirname(save_path)
    base = os.path.basename(save_path)
    # find next edit version folder
    version = 1
    while True:
        new_dir = os.path.join(parent_dir, f"{base}_edit{version}")
        if not os.path.exists(new_dir):
            break
        version += 1
    os.makedirs(new_dir, exist_ok=True)

    # parse masks: only accept base64_data + width as input (no 'mask_matrixs' key)
    mask_map = {}
    mask_matrixs = []
    # read base64_data and width using .get() (consistent with selected_frame style)
    base64_datas = data.get('base64_data', None)
    mask_width = data.get('width', None)
    if base64_datas is not None and mask_width is not None:
        mask_matrixs = [base642matrix(b64, int(mask_width)) for b64 in base64_datas]

    selected_frame = data.get('selected_frame', None)
    # If selected_frame provided, pair masks to True entries in order; otherwise map sequentially
    mi = 0
    if selected_frame is not None:
        for fi, val in enumerate(selected_frame):
            if val:
                if mi >= len(mask_matrixs):
                    break
                mat = np.array(mask_matrixs[mi])
                mask_map[fi] = (mat != 0) if mat.ndim == 2 else (np.squeeze(mat) != 0)
                mi += 1

    # parse delete instructions: explicit list 'delete_frames'
    delete_set = set(data.get('delete_frames', []))

    # open source video
    cap = cv2.VideoCapture(src_video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    # background color
    bg_color = (255, 255, 255) if dataset.white_background else (0, 0, 0)

    out_video_path = os.path.join(new_dir, 'model.mp4')
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out_writer = cv2.VideoWriter(out_video_path, fourcc, fps, (width, height))

    idx = 0
    written = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        # skip deleted frames
        if idx in delete_set:
            idx += 1
            continue

        # apply mask if exists
        if idx in mask_map:
            mask = mask_map[idx]
            try:
                # Mask should match frame dimensions exactly - no resize/transpose
                # (base642matrix already returns correct orientation)
                if mask.shape[0] != height or mask.shape[1] != width:
                    # Skip this frame's mask application
                    idx += 1
                    out_writer.write(frame)
                    written += 1
                    continue

                mask_resized = mask.astype(bool)

                # Invert the mask so the selected region is preserved and the rest is masked out.
                mask_inverted = ~mask_resized
                for c in range(3):
                    channel = frame[:, :, c]
                    channel[mask_inverted] = bg_color[c]
                    frame[:, :, c] = channel
            except Exception:
                pass

        out_writer.write(frame)
        written += 1
        idx += 1

    cap.release()
    out_writer.release()

    # Generate a new unique id and write it to id.txt.
    new_id = str(uuid.uuid4())
    try:
        with open(os.path.join(new_dir, 'id.txt'), 'w') as f:
            f.write(new_id)
    except Exception:
        pass

    # Send the video file back to the front end and include the new id in the response headers.
    response = send_file(
        out_video_path,
        as_attachment=True,
        download_name=f'{id}_edit{version}.mp4',
        mimetype='video/mp4'
    )
    response.headers['X-New-Video-ID'] = new_id
    return response

def cam_dis(cam1, cam2):
    return np.linalg.norm(np.array(cam1['position']) - np.array(cam2['position']))

# def cam_cos(cam1, cam2):
#     rotation_cam1 = np.array(cam1['position'])
#     rotation_cam2 = np.array(cam2['position'])
#     return abs(np.dot(rotation_cam1, rotation_cam2) / (np.linalg.norm(rotation_cam1) * np.linalg.norm(rotation_cam2)))

def cam_cos(cam1, cam2):
    rotation_cam1 = np.array(cam1['direction'])
    rotation_cam2 = np.array(cam2['direction'])
    return abs(np.dot(rotation_cam1, rotation_cam2) / (np.linalg.norm(rotation_cam1) * np.linalg.norm(rotation_cam2)))

def cam_vec(cam1, cam2):
    # Get the positions of camera 1 and camera 2.
    pos1 = np.array(cam1['position'])
    pos2 = np.array(cam2['position'])
    
    # Compute the distance from camera 1 to the origin.
    dis1 = np.linalg.norm(pos1)
    
    # Compute the distance from camera 2 to the origin.
    dis2 = np.linalg.norm(pos2)
    
    # Compute the absolute difference between the two distances.
    dis_diff = abs(dis1 - dis2)
    
    return dis_diff


def cam_ang(cam1, cam2):  
    pos1 = np.array(cam1['position'])  
    pos2 = np.array(cam2['position'])  
      
    # Calculate the dot product of pos1 and pos2  
    dot_product = np.dot(pos1, pos2)  
      
    # Calculate the magnitude (length) of pos1 and pos2  
    mag_pos1 = np.linalg.norm(pos1)  
    mag_pos2 = np.linalg.norm(pos2)  
      
    # Calculate the cosine of the angle between pos1 and pos2  
    cos_angle = dot_product / (mag_pos1 * mag_pos2)  
      
    # Calculate the angle itself (in radians)  
    angle = np.arccos(cos_angle)  
      
    return angle

def zoom_dis(cam):
    return np.linalg.norm(np.array(cam))
#dec
@app.route('/api/data/<string:id>/zoom_test/<string:dif>')
def zoom_test(id, dif):
    global args
    try:
        dif = float(dif)
    except ValueError:
        abort(404)
    save_path = find_path(id)
    parent_dir = os.path.dirname(save_path)
    file_name = os.path.basename(save_path)
    model_path = os.path.join(os.path.join(parent_dir, 'models'), file_name)
    cam_json = os.path.join(model_path, 'cameras.json')
    if save_path == '' or not os.path.exists(os.path.join(save_path, 'model.mp4')) or not os.path.exists(cam_json):
        abort(404)
    with open(cam_json, 'r') as json_file:
        data = json.load(json_file)
    _, min_vals, max_vals = get_minmax(model_path)
    max_abs = np.max(np.abs([min_vals, max_vals]))
    cams = []
    for cam in data:
        direction = cam['rotation'][2]
        cam['position'] = cam['position']  / max_abs
        item = {
            'index':int(cam['img_name'][5:]),
            'position':[i for i in cam['position'].tolist()],
            'direction':[i for i in direction],
        }
        cams.append(item)
    if not cams:
        abort(404)
    cams = sorted(cams, key=lambda x: x['index'])
    
    starts = [0]
    dis_all = []
    for i in range(1, len(cams)):
        dis_all.append(cam_dis(cams[i], cams[i - 1]))
    
    average_dis = sum(dis_all) / len(dis_all)
    for i in range(1, len(cams)):
        if dif == 0:
            break
        dis = cam_dis(cams[i], cams[starts[-1]])
        cos = cam_cos(cams[i], cams[starts[-1]])
        if dis >= (1 / dif - 1) * 30 * average_dis or cos < dif:
            starts.append(i)
    relations = relation_gpu(cams, starts)

    response_data = {
        'starts': starts,
        'relations': relations
    }
    return jsonify(response_data)

@app.route('/api/data/<string:id>/zoom/<string:dif>')
def zoom(id, dif):
    global args
    try:
        dif = float(dif)
    except ValueError:
        abort(404)
    save_path = find_path(id)
    parent_dir = os.path.dirname(save_path)
    file_name = os.path.basename(save_path)
    model_path = os.path.join(os.path.join(parent_dir, 'models'), file_name)
    cam_json = os.path.join(model_path, 'cameras.json')
    if save_path == '' or not os.path.exists(os.path.join(save_path, 'model.mp4')) or not os.path.exists(cam_json):
        abort(404)
    with open(cam_json, 'r') as json_file:
        data = json.load(json_file)
    exists = {}
    for cam in data:
        exists[int(cam['img_name'][5:])] = True
    starts = process_video(video_path = os.path.join(save_path, 'model.mp4')
                  , source_path = save_path
                  , dif = dif, exists = exists)          
    
    response_data = {
        'starts': starts,
        'total_frames':len(data)
    }
    return jsonify(response_data)

@app.route('/api/data', methods=['GET'])
def get_data_status():
    global args
    res = []
    static_dir = os.path.dirname(args.source_path)
    for folder_name in os.listdir(static_dir):
        folder_path = os.path.join(static_dir, folder_name)
        if os.path.isdir(folder_path):
            id_file_path = os.path.join(folder_path, 'id.txt')
            if os.path.exists(id_file_path):
                with open(id_file_path, 'r') as id_file:
                    id = id_file.read().strip()
                status = {
                    "message": "ready",
                    "progress": 1,
                }# TODO: Refine the status decision logic.
                item = {
                    'id': id,
                    'status': status,
                    'name': folder_name,
                    'unix': int(os.path.getmtime(os.path.join(folder_path, 'model.mp4')))
                }
                cap = cv2.VideoCapture(os.path.join(folder_path, 'model.mp4'))
                _, frame = cap.read()
                _, frame = cv2.imencode('.jpg', frame)
                item['image'] = {
                    "format": 'jpg',
                    "data": base64.b64encode(frame).decode('utf-8'),
                }
                res.append(item)
    if not res:
        abort(404)
    return jsonify(res)

def find_path(id):
    global args
    static_dir = os.path.dirname(args.source_path)
    for folder_name in os.listdir(static_dir):
        folder_path = os.path.join(static_dir, folder_name)
        if os.path.isdir(folder_path):
            id_file_path = os.path.join(folder_path, 'id.txt')
            if os.path.exists(id_file_path):
                with open(id_file_path, 'r') as id_file:
                    if id_file.read().strip() == id:
                        return folder_path
    return ''

def get_minmax(save_path):
    could_path = os.path.join(save_path, 'point_cloud/SAGA_centered.ply')
    ply = o3d.io.read_point_cloud(could_path)
    points = np.asarray(ply.points)
    # Compute the minimum and maximum values across the point cloud.
    min_vals = np.min(points)
    max_vals = np.max(points)
    # cam_json = os.path.join(save_path, 'cameras.json')
    # if not os.path.exists(cam_json):
    #     return points, min_vals, max_vals
    # with open(cam_json, 'r') as json_file:
    #     data = json.load(json_file)
    # for cam in data:
    #     min_vals = np.minimum(min_vals, cam['position'])
    #     max_vals = np.maximum(max_vals, cam['position'])
    return points, min_vals, max_vals

def group(points):
    res = [[[[] for _ in range(51)] for _ in range(51)] for _ in range(51)]
    for i in range(len(points)):
        x = math.floor((points[i][0] + 1) / 0.04)
        y = math.floor((points[i][1] + 1) / 0.04)
        z = math.floor((points[i][2] + 1) / 0.04)
        res[x][y][z].append({
            'position':[float('%.5g'%_) for _ in points[i]],
            'idx':i
        })
    groups = [res[x][y][z] for x in range(51) for y in range(51) for z in range(51) if len(res[x][y][z]) > 0]
    return groups

@app.route('/api/data/<string:id>/cloud', methods=['GET'])
def get_cloud(id):
    save_path = find_path(id)
    parent_dir = os.path.dirname(save_path)
    file_name = os.path.basename(save_path)
    model_path = os.path.join(os.path.join(parent_dir, 'models'), file_name)
    could_path = os.path.join(model_path, 'point_cloud/SAGA_centered.ply')
    mask_path = os.path.join(model_path, 'segmentation_res/final_mask.pt')
    grad_path = os.path.join(save_path, 'cloud_grad.json')
    distance_path = os.path.join(save_path, 'distances.txt')
    cloud = []
    if os.path.exists(could_path) and os.path.exists(mask_path) and os.path.exists(grad_path) and os.path.exists(distance_path):
        with open(distance_path, 'r') as file:
            distance_list = [float(line.strip()) for line in file]
        points, min_vals, max_vals = get_minmax(model_path)
        max_abs = np.max(np.abs([min_vals, max_vals]))
        points = points / max_abs
        points = points.tolist()
        cloud = group(points)
        with open(grad_path, 'r') as json_file:
            grad = json.load(json_file)
        grad = normalize_with_filter(grad)
        for i in range(len(cloud)):
            for j in range(len(cloud[i])):
                cloud[i][j]['risk'] = float('%.5g'%grad[cloud[i][j]['idx']])
                cloud[i][j]['similarity'] = float('%.5g'%distance_list[cloud[i][j]['idx']])
    if not cloud:
        abort(404)
    ratio = 1.0
    # if file_name == 'bomb':
    #     ratio = 16 / 9
    return jsonify({'cloud': cloud,
                    'ratio': ratio})

@app.route('/api/data/<string:id>/gt_cloud', methods=['GET'])
def get_gt_cloud(id):
    """
    Return the ground-truth point cloud to the front end.
    """
    save_path = find_path(id)
    parent_dir = os.path.dirname(save_path)
    file_name = os.path.basename(save_path)
    model_path = os.path.join(os.path.join(parent_dir, 'models'), file_name)

    gt_path = os.path.join(save_path, 'ground_truth.ply')
    matrix_path = os.path.join(save_path, 'matrix.txt')
    SAGA_path = os.path.join(model_path, 'point_cloud/SAGA_centered.ply')

    if not os.path.exists(gt_path) or not os.path.exists(matrix_path) or not os.path.exists(SAGA_path):
        abort(404)

    try:
        import open3d as o3d

        # Load the point clouds.
        ply_gt = o3d.io.read_point_cloud(gt_path)
        ply_saga = o3d.io.read_point_cloud(SAGA_path)

        # Apply the same normalization used for SAGA so the clouds stay aligned.
        points, min_vals, max_vals = get_minmax(model_path)
        max_abs = np.max(np.abs([min_vals, max_vals]))

        # Normalize the ground-truth point cloud.
        gt_points = np.asarray(ply_gt.points) / max_abs
        gt_points = gt_points.tolist()

        # Group the points the same way as SAGA.
        gt_cloud = group(gt_points)

        print(f"[get_gt_cloud] Loaded GT cloud with {len(gt_points)} points")

        ratio = 1.0
        return jsonify({'cloud': gt_cloud, 'ratio': ratio})
    except Exception as e:
        print(f"Error loading GT cloud: {e}")
        import traceback
        traceback.print_exc()
        abort(500)

@app.route('/api/data/<string:id>/chamfer_metrics', methods=['GET'])
def get_chamfer_metrics_endpoint(id):
    """
    Get Chamfer Distance accuracy metrics.
    Prefer local files and compute them automatically only when missing.
    """
    save_path = find_path(id)
    if not save_path:
        return jsonify({"error": "Data not found"}), 404

    parent_dir = os.path.dirname(save_path)
    file_name = os.path.basename(save_path)
    model_path = os.path.join(os.path.join(parent_dir, 'models'), file_name)

    metrics_path = os.path.join(save_path, 'chamfer_metrics.json')

    # Prefer the locally cached metrics.
    if os.path.exists(metrics_path):
        with open(metrics_path, 'r') as f:
            metrics = json.load(f)
        return jsonify(metrics)

    # Otherwise check whether all required files are available.
    SAGA_path = os.path.join(model_path, 'point_cloud/SAGA.ply')
    gt_path = os.path.join(save_path, 'ground_truth.ply')
    matrix_path = os.path.join(save_path, 'matrix.txt')

    if not all(os.path.exists(p) for p in [SAGA_path, gt_path, matrix_path]):
        return jsonify({"error": "Required files not found, please run reconstruction first"}), 404

    # Compute and save the metrics.
    try:
        metrics = compute_and_save_chamfer_metrics(SAGA_path, gt_path, matrix_path, save_path)
        return jsonify(metrics)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/data/<string:id>/chamfer_metrics/recompute', methods=['POST'])
def recompute_chamfer_metrics_endpoint(id):
    """
    Force a recomputation of Chamfer Distance metrics.
    Use this when the point cloud changed and needs reevaluation.
    """
    save_path = find_path(id)
    if not save_path:
        return jsonify({"error": "Data not found"}), 404

    parent_dir = os.path.dirname(save_path)
    file_name = os.path.basename(save_path)
    model_path = os.path.join(os.path.join(parent_dir, 'models'), file_name)

    SAGA_path = os.path.join(model_path, 'point_cloud/SAGA.ply')
    gt_path = os.path.join(save_path, 'ground_truth.ply')
    matrix_path = os.path.join(save_path, 'matrix.txt')

    if not all(os.path.exists(p) for p in [SAGA_path, gt_path, matrix_path]):
        return jsonify({"error": "Required files not found"}), 404

    try:
        metrics = compute_and_save_chamfer_metrics(SAGA_path, gt_path, matrix_path, save_path, force_recompute=True)
        return jsonify(metrics)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/data/<string:id>/save_plans', methods=['POST'])
def save_plans(id):
    """
    Save plan data to a local JSON file.

    Accepted payload:
    {
        "current_plan": {
            "plan": [...],
            "risk": [...],
            "selectedIndices": [...],  # Newly added field.
            "timestamp": "2025-11-18T..."
        },
        "previous_plan": {
            "plan": [...],
            "risk": [...],
            "selectedIndices": [...],  # Newly added field.
            "timestamp": "2025-11-18T..."
        }
    }
    """
    save_path = find_path(id)
    print(save_path)
    if not save_path:
        return jsonify({"error": "Data not found"}), 404

    try:
        # Read the request payload.
        data = request.get_json()
        if not data:
            return jsonify({"error": "No data provided"}), 400

        # Tolerate missing fields by defaulting them to null.
        plans_data = {
            "current_plan": data.get("current_plan", None),
            "previous_plan": data.get("previous_plan", None)
        }

        # Save the payload to disk.
        plans_path = os.path.join(save_path, 'plans.json')
        with open(plans_path, 'w') as f:
            json.dump(plans_data, f, indent=4)

        return jsonify({
            "success": True,
            "message": "Plans saved successfully"
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/data/<string:id>/load_plans', methods=['GET'])
def load_plans(id):
    """
    Load plan data.

    Response shape:
    {
        "current_plan": {
            "plan": [...],
            "risk": [...],
            "selectedIndices": [...],  # Newly added field.
            "timestamp": "2025-11-18T..."
        } | null,
        "previous_plan": {
            "plan": [...],
            "risk": [...],
            "selectedIndices": [...],  # Newly added field.
            "timestamp": "2025-11-18T..."
        } | null
    }
    """
    save_path = find_path(id)
    if not save_path:
        return jsonify({"error": "Data not found"}), 404

    plans_path = os.path.join(save_path, 'plans.json')

    # Return an empty structure when the file does not exist.
    if not os.path.exists(plans_path):
        return jsonify({
            "current_plan": None,
            "previous_plan": None
        })

    try:
        # Read the saved file.
        with open(plans_path, 'r') as f:
            plans_data = json.load(f)

        # Normalize the return shape to guard against legacy file formats.
        result = {
            "current_plan": plans_data.get("current_plan", None),
            "previous_plan": plans_data.get("previous_plan", None)
        }

        return jsonify(result)

    except Exception as e:
        return jsonify({"error": str(e)}), 500

# @app.route('/api/data/<string:id>/seg', methods=['GET'])
# def get_seg(id):
#     save_path = find_path(id)
#     parent_dir = os.path.dirname(save_path)
#     file_name = os.path.basename(save_path)
#     model_path = os.path.join(os.path.join(parent_dir, 'models'), file_name)
#     cam_json = os.path.join(model_path, 'cameras.json')
#     if save_path == '' or not os.path.exists(cam_json):
#         abort(404)
#     with open(cam_json, 'r') as json_file:
#         data = json.load(json_file)
#     cams = [cam for cam in data]
#     cams = sorted(cams, key=lambda x: x['index'])
#     max_dis = 0
#     total_dis = 0
#     for cam1 in cams:
#         for cam2 in cams:
#             dis = cam_dis(cam1, cam2)
#             total_dis += dis
#             if dis > max_dis:
#                 max_dis = dis
#     ave_dis = total_dis / (len(cams) - 1) / (len(cams) - 1)
    
#     segs = []  # Record the ending frame of each segment.
#     a, b = 5, 0.5
#     for i in range(1, len(cams)):
#         if cam_dis(cams[i], cams[i - 1]) > a * ave_dis or cam_cos(cams[i], cams[i - 1]) < b:
#             segs.append([i - 1, i])
    
#     relations = [[0] * len(segs) for i in range(len(segs))]
#     for i in range(len(segs) - 1):
#         for j in range(i + 1, len(segs)):
#             segment1 = cams[segs[i][0]:segs[i][1]+1]
#             segment2 = cams[segs[j][0]:segs[j][1]+1]
#             count = 0  # Count camera pairs that satisfy the condition.
#             for cam1 in segment1:
#                 for cam2 in segment2:
#                     if cam_dis(cam1, cam2) < a * ave_dis and cam_cos(cam1, cam2) > b:
#                         count += 1
#             relations[i][j] = relations[j][i] = count / len(segment1) / len(segment2)
    
#     return jsonify({'segs': segs, 'relations': relations})


def relation(cams, starts, device=None):
    if device is None:
        device = getattr(args, 'data_device', None) or ("cuda" if torch.cuda.is_available() else "cpu")
    max_dis = 0
    total_dis = 0
    for cam1 in cams:
        for cam2 in cams:
            dis = cam_dis(cam1, cam2)
            total_dis += dis
            if dis > max_dis:
                max_dis = dis
    ave_dis = total_dis / (len(cams) - 1) / (len(cams) - 1)
    a, b = 5, 0.5
    relations = [[0] * len(starts) for i in range(len(starts))]
    segments = []
    for i in range(len(starts) - 1):
        end1 = starts[i + 1] if len(starts) > i + 1 else len(cams)
        segment1_indices = torch.arange(starts[i], end1, device=device)
        segments.append(segment1_indices)
    for i in range(len(starts) - 1):
        for j in range (i + 1, len(starts)):
            segment1 = segments[i]
            segment2 = segments[j]
            count = 0
            for cam1 in segment1:
                for cam2 in segment2:
                    if cam_dis(cam1, cam2) < a * ave_dis and cam_cos(cam1, cam2) > b:
                        count += 1
            relations[i][j] = relations[j][i] = count / len(segment1) / len(segment2)
    
    non_zero_relations = []  
    for i in range(len(relations)):  
        non_zero_for_i = [[j, relations[i][j]] for j in range(len(relations[i])) if relations[i][j] != 0]  
        non_zero_relations.append(non_zero_for_i)  

def relation_gpu(cams, starts, device=None):
    if device is None:
        device = getattr(args, 'data_device', None) or ("cuda" if torch.cuda.is_available() else "cpu")
    positions = torch.tensor([cam['position'] for cam in cams], dtype=torch.float32, device=device)
    directions = torch.tensor([cam['direction'] for cam in cams], dtype=torch.float32, device=device)

    n_cams = len(cams)
    indices = torch.arange(n_cams, device=device)
    idx1, idx2 = torch.meshgrid(indices, indices, indexing='ij')
    mask = idx1 < idx2
    idx1 = idx1[mask]
    idx2 = idx2[mask]

    dis_matrix = torch.norm(positions[idx1] - positions[idx2], dim=1)
    total_dis = torch.sum(dis_matrix).item()
    ave_dis = total_dis / (n_cams * (n_cams - 1) / 2)
    a, b = 0.1, 0.9

    # Preprocess segment metadata.
    segments = []
    for i in range(len(starts)):
        end1 = starts[i + 1] if len(starts) > i + 1 else len(cams)
        segment1_indices = torch.arange(starts[i], end1, device=device)
        segments.append(segment1_indices)

    # Compute the relation matrix.
    relations = torch.zeros((len(starts), len(starts)), device=device)

    print("start re")

    for i in range(len(starts) - 1):
        segment1_indices = segments[i]
        size1 = len(segment1_indices)
        segment1_matrix = positions[segment1_indices].unsqueeze(1)  # shape: (size1, 1, dim)

        for j in range(i + 1, len(starts)):
            segment2_indices = segments[j]
            size2 = len(segment2_indices)
            segment2_matrix = positions[segment2_indices].unsqueeze(0)  # shape: (1, size2, dim)

            dis_matrix = torch.norm(segment1_matrix - segment2_matrix, dim=2)
            cos_matrix = torch.mm(directions[segment1_indices], directions[segment2_indices].t())
            norm1 = torch.norm(directions[segment1_indices], dim=1).unsqueeze(1)
            norm2 = torch.norm(directions[segment2_indices], dim=1).unsqueeze(0)
            cos_matrix = cos_matrix / (norm1 * norm2)

            mask = (dis_matrix < a * ave_dis) & (cos_matrix > b)
            count = torch.sum(mask).item()

            relations[i, j] = relations[j, i] = count / (size1 * size2)

    print("end re")

    relations_cpu = relations.cpu()
    # non_zero_relations = []
    # for i in range(len(relations_cpu)):
    #     non_zero_for_i = [[j, relations_cpu[i, j].item()] for j in range(len(relations_cpu[i])) if
    #                       relations_cpu[i, j] != 0]
    #     non_zero_relations.append(non_zero_for_i)
    threshold = 0
    relations_arr = [[i, j, relations_cpu[i][j].item()] for i in range(len(relations_cpu)) for j in range(i+1, len(relations_cpu[i])) if relations_cpu[i][j].item() > threshold]  

    return relations_arr

def seg_by_cam(cams, dif):
    starts = [0]
    dis_all = []
    for i in range(1, len(cams)):
        dis_all.append(cam_dis(cams[i], cams[i - 1]))
    average_dis = sum(dis_all) / len(dis_all)
    print("dis", average_dis, (1 / dif - 1) * 30 * average_dis)
    for i in range(1, len(cams)):
        if dif == 0:
            break
        dis = cam_dis(cams[i], cams[starts[-1]])
        cos = cam_cos(cams[i], cams[starts[-1]])
        if dis >= (1 / dif - 1) * 30 * average_dis or cos < dif:
            starts.append(i) 
    return starts

def seg_by_cam_mean(cams):
    starts = [0]
    # dis_all = []
    cos_all = []
    ang_all = []
    for i in range(1, len(cams)):
        # dis_all.append(cam_dis(cams[i], cams[i - 1]))
        ang_all.append(cam_ang(cams[i], cams[i - 1]))
        cos_all.append(cam_cos(cams[i], cams[i - 1]))
        
    def save_to_txt(filename, data):  
        with open(filename, 'w') as f:  
            for item in data:  
                f.write(f"{item}\n")  
    # Save dis_all to a txt file.  
    # save_to_txt("dis_all.txt", dis_all)  
    # Save cos_all to a txt file.  
    save_to_txt("cos_all.txt", cos_all)  
    # Save ang_all to a txt file.  
    save_to_txt("ang_all.txt", ang_all)  

    # average_dis = np.mean(dis_all)    
    # std_dev_dis = np.std(dis_all)    
    average_ang = np.mean(ang_all)    
    std_dev_ang = np.std(ang_all)       
    average_cos = np.mean(cos_all)    
    std_dev_cos = np.std(cos_all)   
        
    # dis_dif = np.percentile(dis_all, 95)  
    # cos_dif = np.percentile(cos_all, 5)  
    # dis_dif = average_dis + 2 * std_dev_dis
    ang_dif = max(average_ang + 2 * std_dev_ang, 0.5)
    cos_dif = min(average_cos - 2 * std_dev_cos, 0.9) 
         
    for i in range(1, len(cams)):     
        # dis = cam_dis(cams[i], cams[starts[-1]])  
        ang = cam_ang(cams[i], cams[starts[-1]])   
        cos = cam_cos(cams[i], cams[starts[-1]])  
        if (ang >= ang_dif or cos <= cos_dif or ang_all[i - 1] >= ang_dif or cos_all[i - 1] <= cos_dif):
            starts.append(i)  
            
    save_to_txt("start.txt", starts) 
    # start i - 2 : 1
    # start i - 1 : 10
    # start i: 11
    _starts = []
    _starts.append(starts[0])
    # Compare the last frame of this segment with the last frame of the previous segment.
    for i in range(2, len(starts)):
        if starts[i] - starts[i - 1] <= 10:
            # dis_end = cam_dis(cams[starts[i - 1] - 1], cams[starts[i] - 1]) 
            ang_end = cam_ang(cams[starts[i - 1] - 1], cams[starts[i] - 1]) 
            cos_end = cam_cos(cams[starts[i - 1] - 1], cams[starts[i] - 1]) 
            print(starts[i - 1])
            if (ang_end >= ang_dif or cos_end <= cos_dif) or (ang_all[starts[i - 1] - 1] >= ang_dif or cos_all[starts[i - 1] - 1] <= cos_dif):
                _starts.append(starts[i - 1])
        else:
            _starts.append(starts[i - 1])
        if i == len(starts) - 1:
            _starts.append(starts[i])
    save_to_txt("_start.txt", _starts) 
    print("ang_dif", ang_dif, "cos_dif", cos_dif)    
    return _starts 

@app.route('/api/data/<string:id>/seg/<string:dif>')
def seg(id, dif):
    global args
    try:
        dif = float(dif)
    except ValueError:
        abort(404)
    print("loading data")
    save_path = find_path(id)
    parent_dir = os.path.dirname(save_path)
    file_name = os.path.basename(save_path)
    model_path = os.path.join(os.path.join(parent_dir, 'models'), file_name)
    cam_json = os.path.join(model_path, 'cameras.json')
    if save_path == '' or not os.path.exists(os.path.join(save_path, 'model.mp4')) or not os.path.exists(cam_json):
        abort(404)
    with open(cam_json, 'r') as json_file:
        data = json.load(json_file)
    print("done")
    exists = {}
    _, min_vals, max_vals = get_minmax(model_path)
    max_abs = np.max(np.abs([min_vals, max_vals]))
    print("loading cams")
    for cam in data:
        exists[int(cam['img_name'][5:])] = True
    cams = []
    for cam in data:
        direction = cam['rotation'][2]
        cam['position'] = cam['position']  / max_abs
        item = {
            'index':int(cam['img_name'][5:]),
            'position':[i for i in cam['position'].tolist()],
            'direction':[i for i in direction],
        }
        cams.append(item)
    if not cams:
        abort(404)
    print("done")
    print("sorting cams")
    cams = sorted(cams, key=lambda x: x['index']) 
    starts = seg_by_cam_mean(cams)
    print("done")
    print("calculating relations")
    relations = relation_gpu(cams, starts)
    # relations = []
    print("done")
    
    response_data = {
        'starts': starts,
        'total_frames':len(data),
        'relations': relations,
    }
    return jsonify(response_data)

def break_by_cam(cams):
    starts = [0]
    dis_all = []
    cos_all = []
    for i in range(1, len(cams)):
        dis_all.append(cam_dis(cams[i], cams[i - 1]))
        cos_all.append(cam_cos(cams[i], cams[i - 1]))

    average_dis = np.mean(dis_all)    
    std_dev_dis = np.std(dis_all)     
    average_cos = np.mean(cos_all)    
    std_dev_cos = np.std(cos_all)   
        
    # dis_dif = np.percentile(dis_all, 95)  
    # cos_dif = np.percentile(cos_all, 5)  
    dis_dif = max(average_dis + 2 * std_dev_dis, 1.5)
    cos_dif = min(average_cos - 2 * std_dev_cos, 0.9)
        
    print("dis_dif", dis_dif, "cos_dif", cos_dif)    
    for i in range(1, len(cams)):     
        dis = cam_dis(cams[i], cams[i - 1])  
        cos = cam_cos(cams[i], cams[i - 1])  
        if (dis >= dis_dif or cos <= cos_dif):
            starts.append(i)
    return starts 

@app.route('/api/data/<string:id>/breakpoint', methods=['GET'])
def get_breakpoint(id):
    save_path = find_path(id)
    parent_dir = os.path.dirname(save_path)
    file_name = os.path.basename(save_path)
    model_path = os.path.join(os.path.join(parent_dir, 'models'), file_name)
    cam_json = os.path.join(model_path, 'cameras.json')
    _, min_vals, max_vals = get_minmax(model_path)
    max_abs = np.max(np.abs([min_vals, max_vals]))
    if save_path == '' or not os.path.exists(cam_json):
        abort(404)
    with open(cam_json, 'r') as json_file:
        data = json.load(json_file)
    # cams = [cam for cam in data]
    cams = []
    for cam in data:
        direction = cam['rotation'][2]
        cam['position'] = cam['position']  / max_abs
        item = {
            'index':int(cam['img_name'][5:]),
            'position':[i for i in cam['position'].tolist()],
            'direction':[i for i in direction],
        }
        cams.append(item)
    cams = sorted(cams, key=lambda x: x['index'])
    breakpoints = break_by_cam(cams)
    
    return jsonify({'break_points': breakpoints})


@app.route('/api/data/<string:id>/frames')
def get_frames(id):
    res = []
    save_path = find_path(id)
    parent_dir = os.path.dirname(save_path)
    file_name = os.path.basename(save_path)
    model_path = os.path.join(os.path.join(parent_dir, 'models'), file_name)
    cam_json = os.path.join(model_path, 'cameras.json')
    grad_json = os.path.join(save_path, 'cam_grad.json')
    if os.path.exists(cam_json) and os.path.exists(os.path.join(save_path,'input')) and os.path.exists(grad_json):
        with open(cam_json, 'r') as json_file:
            data = json.load(json_file)
        with open(grad_json, 'r') as json_file:
            grad = json.load(json_file)
        grad = normalize_with_filter(grad)
        _, min_vals, max_vals = get_minmax(model_path)
        max_abs = np.max(np.abs([min_vals, max_vals]))
        f = {}
        ma = 0
        for cam in data:
            f[int(cam['img_name'][5:])] = True
            ma = max(ma, int(cam['img_name'][5:]))
        for i in range(ma + 1):
            if i in f:
                continue
            grad = grad[:i] + [-1] + grad[i:]
        for cam in data:
            direction = cam['rotation'][2]
            img_base64 = image_to_base64(os.path.join(save_path,'input/' + cam['img_name'] + '.jpg'))
            cam['position'] = cam['position']  / max_abs
            item = {
                'index':int(cam['img_name'][5:]),
                'location':[float('%.5g'%i) for i in cam['position'].tolist()],
                'direction':[float('%.5g'%i) for i in direction],
                'fovx':float('%.5g'%(focal2fov(cam['fx'], cam['width']) * 180 / math.pi)),
                'fovy':float('%.5g'%(focal2fov(cam['fy'], cam['height']) * 180 / math.pi)),
                'aspect_ratio':float('%.5g'%(cam['width'] / cam['height'])),
                'image':{
                    'data':img_base64,
                    'format':'jpg'
                },
                'risk':float('%.5g'%grad[int(cam['img_name'][5:])])
            }
            res.append(item)
    if not res:
        abort(404)
    res = sorted(res, key=lambda x: x['index'])
    for i in res:
        i.pop('index')
    return res

@app.route('/api/data/<string:id>/delete_frames', methods=['POST'])
def delete_frames(id):
    save_path = find_path(id)
    grad_json = os.path.join(save_path, 'cam_grad.json')
    if not os.path.exists(grad_json):
        abort(404)
    with open(grad_json, 'r') as json_file:
        grad = json.load(json_file)
    data = request.get_json()
    num = data['num']
    starts = data['starts']
    starts.append(len(grad))
    res = []
    for i in range(len(starts) - 1):
        idx = starts[i]
        sum = 0
        ma = 0
        for j in range(starts[i], starts[i + 1]):
            if j - starts[i] + 1 <= num[i]:
                sum += grad[j]
                ma = sum
            else:
                sum += grad[j] - grad[j - num[i]]
                if sum > ma:
                    ma = sum
                    idx = j - num[i] + 1
        res.append[idx]
    return jsonify({'starts':res})

@app.route('/api/data/<string:id>/gsplat')
def gsplat(id):
    save_path = find_path(id)
    parent_dir = os.path.dirname(save_path)
    file_name = os.path.basename(save_path)
    model_path = os.path.join(os.path.join(parent_dir, 'models'), file_name)
    ply_path = os.path.join(model_path, 'point_cloud/SAGA_centered.ply')
    if not os.path.exists(ply_path):
        abort(404)
    parent_dir = os.path.dirname(parent_dir)
    return jsonify({'url' : os.path.relpath(ply_path, parent_dir)})
# @app.route('/api/3dgsfile')  
# def send_file():  
#     response.headers["Cross-Origin-Opener-Policy"] = "same-origin"  
#     response.headers["Cross-Origin-Embedder-Policy"] = "require-corp"
#     response.headers['Access-Control-Allow-Origin'] = '*'  
#     response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'  
#     response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'   
#     return response
# from flask import make_response
# @app.route('/test')  
# def test():  
#     response = make_response("Hello, cross-origin world!")  
#     response.headers["Cross-Origin-Opener-Policy"] = "unsafe-none"
#     response.headers["Cross-Origin-Embedder-Policy"] = "require-corp"    
#     return response

@app.after_request  
def set_response_headers(response):  
    # response.headers["Cross-Origin-Opener-Policy"] = "same-origin"  
    # response.headers["Cross-Origin-Embedder-Policy"] = "require-corp"
    response.headers['Access-Control-Allow-Origin'] = '*'  
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'  
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'  
    return response 


@app.route('/api/data/<string:id>/zoom', methods=['GET'])
def get_zoom(id):
    res = []
    save_path = find_path(id)
    parent_dir = os.path.dirname(save_path)
    file_name = os.path.basename(save_path)
    model_path = os.path.join(os.path.join(parent_dir, 'models'), file_name)
    cam_json = os.path.join(model_path, 'cameras.json')
    
    if os.path.exists(cam_json) and os.path.exists(os.path.join(save_path,'input')):
        with open(cam_json, 'r') as json_file:
            data = json.load(json_file)
        _, min_vals, max_vals = get_minmax(model_path)
        max_abs = np.max(np.abs([min_vals, max_vals]))
        f = {}
        ma = 0
        maxzoom = float('-inf')
        minzoom = float('inf')
        for cam in data:
            minzoom = min(minzoom, zoom_dis(cam['position']))
            maxzoom = max(maxzoom, zoom_dis(cam['position']))
        for cam in data:
            # cam['position'] = cam['position'] / max_abs
            zoom = (zoom_dis(cam['position']) - maxzoom) * -1.0 + minzoom
            item = {
                'index':int(cam['img_name'][5:]),
                'zoom': float('%.5g' % zoom) 
            }
            res.append(item)
    if not res:
        abort(404)
    res = sorted(res, key=lambda x: x['index'])
    for i in res:
        i.pop('index')
    return res

if __name__ == '__main__': 
    app.run(
        debug=os.getenv("VIDGUARD_DEBUG", "false").lower() == "true",
        port=int(os.getenv("PORT", "6006")),
    )
