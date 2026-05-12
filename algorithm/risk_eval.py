import sys
import torch
import numpy as np
import open3d as o3d
from tqdm import tqdm
import matplotlib.pyplot as plt
from scene import Scene, GaussianModel
from utils.loss_utils import l1_loss, ssim, l1_loss_withmask, ssim_withmask
from argparse import ArgumentParser, Namespace
from gaussian_renderer import render
from arguments import ModelParams, PipelineParams, OptimizationParams
from utils.camera_utils import camera_to_JSON_other


def _set_cuda_device_if_available(device):
    if torch.cuda.is_available() and str(device).startswith("cuda"):
        torch.cuda.set_device(device)

class FrameFreeMask:  
    def __init__(self, mask_matrix=None):  
        self.mask_matrix = mask_matrix  
  
    def apply_mask(self, img): 
        mask = None
        with torch.no_grad():
            mask = self.create_mask(img.shape, img.device)
        return img * mask  
  
    def create_mask(self, shape, device): 
        if self.mask_matrix is None:
            raise ValueError("Mask matrix is not defined.")
        mask = torch.tensor(self.mask_matrix, dtype=torch.float32, device=device)  
        return mask.expand(shape[0], -1, -1) if len(shape) == 3 else mask

    def visualize_mask(self):  
        if self.mask_matrix is None:
            raise ValueError("Mask matrix is not defined.")
        mask = torch.tensor(self.mask_matrix, dtype=torch.float32)
        if mask.ndim == 2:
            mask = mask.unsqueeze(0)
        mask = mask.permute(1, 2, 0)
        plt.imshow(mask.numpy(), cmap='gray')  
        # plt.show()

class FrameMask:  
    def __init__(self, xx, xy, yx, yy):  
        self.xx = xx  
        self.yx = yx  
        self.xy = xy  
        self.yy = yy  
  
    def apply_mask(self, img): 
        mask = None
        with torch.no_grad():
            mask = self.create_mask(img.shape, img.device)
        return img * mask  
  
    def create_mask(self, shape, device): 
        mask = None
        mask = torch.zeros(shape, dtype=torch.float32, device=device)  
        mask[:, self.xx:self.yx, self.xy:self.yy] = 1  
        return mask  
    def visualize_mask(self, shape):  
        mask = self.create_mask(shape)  
        mask = mask.permute(1, 2, 0) 
        plt.imshow(mask.numpy(), cmap='gray')  
        # plt.show()  
    
class Cam_info:
    def __init__(self, mat=None, contrib=None, grad=None):
        # Heatmap values for the image.
        self.mat = mat
        # Contribution scores for the image.
        self.contrib = contrib
        self.grad = grad
    
    @staticmethod
    def visualize_grad(cam_infos):         
        # Plot per-camera gradient values.
        grad = [cam_info.grad.cpu() for cam_info in cam_infos]  
        plt.figure(figsize=(10,6))  # Set the figure size.
        plt.bar(range(len(grad)), grad)  
        plt.xlabel('Index')  
        plt.ylabel('a value')  
        plt.title('Bar plot of a values')  
        # plt.show()
        
class Gaussians_info:
    def __init__(self, shape, device="cuda"):
        self.radii_contrib = torch.full((shape,), 1, dtype=torch.float, device=device)
        self.grad = torch.full((shape,), 0., dtype=torch.float, device=device)
        self.labels = None
            
    def normalize(self, contrib, threshold = 2.0):
        # Compute the mean and standard deviation.
        mean = contrib.mean()  
        std = contrib.std()  
        # Mark values outside the thresholded range as outliers.
        outliers = (contrib < mean - threshold * std) | (contrib > mean + threshold * std)  
        # Find the largest non-outlier value.
        max_normal = contrib[~outliers].max()  
        # Clamp outliers to the largest in-range value.
        contrib = torch.where(outliers, max_normal, contrib)  
        # TODO: Replace this trimmed normalization with a full-range variant.
        # Normalize the contribution values.
        contrib_min = contrib.min()  
        contrib_max = contrib.max()  
        normalized_contrib = (contrib - contrib_min) / (contrib_max - contrib_min)
        return normalized_contrib
        
    def add(self, radii = None, grad = None):
        if radii is not None:
            self.radii_contrib += radii.detach()
        if grad is not None:
            self.grad += grad.detach()
            
    def visualize_radii(self, gaussians):
        pcd = o3d.geometry.PointCloud()
        pcd.points = o3d.utility.Vector3dVector(gaussians.get_xyz.detach().cpu().numpy())
        contrib = self.normalize(torch.log(self.radii_contrib + 1))
        # Create the color map.
        cmap = plt.get_cmap('coolwarm')  
        # Convert the normalized values into colors.
        color_array = cmap(contrib.detach().cpu())  
        pcd.colors = o3d.utility.Vector3dVector(color_array[:, :3])
        o3d.visualization.draw_geometries([pcd])
        
    def visualize_grad(self, gaussians, selected_gaussians):
        pcd = o3d.geometry.PointCloud()
        pcd.points = o3d.utility.Vector3dVector(gaussians.get_xyz.detach().cpu().numpy())
        self.grad *= selected_gaussians.float()
        threshold = np.percentile(self.grad.detach().cpu().numpy(), 90)  
        grad = torch.clamp(self.grad, max=threshold)
        contrib = self.normalize(torch.log(grad + 1))
        # Create the color map.
        cmap = plt.get_cmap('Reds')  
        # Convert the normalized values into colors.
        color_array = cmap(contrib.detach().cpu())
        pcd.colors = o3d.utility.Vector3dVector(color_array[:, :3])
        o3d.visualization.draw_geometries([pcd])
        
    def visualize_grad_kmeans(self, gaussians, n_clusters=10):
        pcd = o3d.geometry.PointCloud()
        pcd.points = o3d.utility.Vector3dVector(gaussians.get_xyz.detach().cpu().numpy())
        threshold = np.percentile(self.grad.detach().cpu().numpy(), 97)  
        grad = torch.clamp(self.grad, max=threshold)
        contrib = self.normalize(torch.log(grad + 1))

        from sklearn.cluster import KMeans
    # Cluster the values into a fixed number of bins with k-means.
        kmeans = KMeans(n_clusters=n_clusters)  
        labels = kmeans.fit_predict(contrib.detach().cpu().numpy().reshape(-1, 1))  
    
    # Create the color map.
        cmap = plt.get_cmap('Reds')  
    
    # Assign colors according to the cluster labels.
        color_array = cmap(labels / (n_clusters - 1))  
    
        pcd.colors = o3d.utility.Vector3dVector(color_array[:, :3]) 
    
        # # Print the value range associated with each color.
        # for i in range(n_clusters):  
        #     print(f"Color {i}: {contrib[labels == i].min()} - {contrib[labels == i].max()}")  
        o3d.visualization.draw_geometries([pcd])  
        
        self.labels = labels
        
def visualize(gaussians, contrib):
    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(gaussians.get_xyz.detach().cpu().numpy())
    # Create the color map.
    cmap = plt.get_cmap('coolwarm')
    # Convert the normalized values into colors.
    color_array = cmap(contrib * 0.8)  
    pcd.colors = o3d.utility.Vector3dVector(color_array[:, :3])
    o3d.visualization.draw_geometries([pcd])

# Given the selected Gaussians, compute the image heatmap and return a Cam_info instance.
def cal_cam_contrib(gauss_grad_contrib, selected_gaussians, imgState=None, W=None, H=None):
    selected_gauss_grad_contrib = gauss_grad_contrib[selected_gaussians]
    selected_count = (selected_gauss_grad_contrib > 1e-8).sum().float()
    if imgState is not None:
        n_contrib = imgState['n_contrib'].detach()
        contrib = n_contrib.sum()
        # Reshape the 1D tensor into a 2D map.
        n_contrib_2d = n_contrib.view(H, W)  
        return Cam_info(n_contrib_2d, contrib, selected_gauss_grad_contrib.sum())
    # return Cam_info(grad=selected_count)
    return Cam_info(grad=selected_gauss_grad_contrib.sum())

# Compute Gaussian contribution gradients for sensitivity analysis and return the gradient tensor.
def cal_gaussian_contrib(gaussians, selected_gaussians, device="cuda"):
    total_grad_abs = torch.zeros(gaussians.get_xyz.shape[0], dtype=torch.float, device=device)
    # Take the absolute value of the gradients.
    grad_features_dc = gaussians._features_dc.grad[selected_gaussians].abs().sum(dim=[1, 2])
    grad_features_rest = gaussians._features_rest.grad[selected_gaussians].abs().sum(dim=[1, 2])
    # print(gaussians._features_rest.grad.shape, gaussians._features_rest.grad.shape)
    # grad_opacity = gaussians._opacity.grad[selected_gaussians].abs().sum(dim=1)
    
    # Compute the sum of all gradients.
    total_grad_abs[selected_gaussians] = 0.7* grad_features_dc + 0.3 * grad_features_rest
    # total_grad_abs *= selected_gaussians.float().cuda()

    selected_count = (total_grad_abs[selected_gaussians] > 1e-8).sum().float()
    total_selected = selected_gaussians.sum().float()
    # Compute the scaling ratio.
    ratio = selected_count / total_selected.to(selected_count.device)
    # # Scale all values by the computed ratio.
    # total_grad_abs *= ratio

    return total_grad_abs, ratio

def cam_dis(cam1, cam2):
    return np.linalg.norm(np.array(cam1['location']) - np.array(cam2['location']))

def cam_cos(cam1, cam2):
    rotation_cam1 = np.array(cam1['direction'])
    rotation_cam2 = np.array(cam2['direction'])
    return abs(np.dot(rotation_cam1, rotation_cam2) / (np.linalg.norm(rotation_cam1) * np.linalg.norm(rotation_cam2)))

def RiskEval(opt, pipe, bg_color, viewpoint_cams, gaussians, selected_cams=None, selected_gaussians=None, selected_frame=None, framemask=None,device="cuda", distance = None):
    """  
    This function takes in 8 numbers, returns a list of Cam_info instances and an entity of Gaussians_info
    
    Input:  
        opt (GroupParams): Read from model training arguments, contains information about training.  
        pipe (GroupParams): Read from model training arguments, necessary for rendering process.  
        bg_color (List[int]): Background color.  
        viewpoint_cams (List[scene.cameras.Camera]): Cameras for evaluation.  
        gaussians (scene.gaussian_model.GaussianModel): Reconstructed gaussians.  
        selected_gaussians (torch.Tensor(dtype=torch.bool)): A tensor describing if the corresponding gaussian is selected for evaluation.  
        selected_cams (torch.Tensor(dtype=torch.bool)): A tensor describing if the corresponding camera is selected for evaluation.
        selected_frame(torch.Tensor(dtype=torch.bool)):A tensor describing if the corresponding frame is selected to put on mask.
        framemask(FrameMask):information about corners of mask
        device (str, optional): The device to run on. Defaults to 'cuda'.      
    Output:  
        cam_infos (Cam_Info): every camera's risk value, calculated based on gradient.  
        gaussians_info (Gaussians_Info): every gaussian's risk value, calculated based on gradient.
    """  
    _set_cuda_device_if_available(device)
    if selected_gaussians == None:
        selected_gaussians = torch.full((gaussians.get_xyz.shape[0],), True, dtype=torch.bool)
    if selected_cams == None:
        selected_cams = torch.full((len(viewpoint_cams),), True, dtype=torch.bool)
    cam_infos = []
    iter_start = torch.cuda.Event(enable_timing = True)
    iter_end = torch.cuda.Event(enable_timing = True)
    gaussians_info = Gaussians_info(gaussians.get_xyz.shape[0], device=device)
    background = torch.tensor(bg_color, dtype=torch.float32, device=device)
    torch.autograd.set_detect_anomaly(True)
    progress_bar = tqdm(range(0, len(viewpoint_cams)), desc="Evaluating progress")
    similarity = torch.full((gaussians.get_xyz.shape[0],), 1.0, dtype=torch.float, device=device)
    if distance is not None:
        cnt = 0
        eps = 1e-6
        for i in range(selected_gaussians.shape[0]):
            if selected_gaussians[i]:
                similarity[i] = 1 / (distance[cnt] + eps)
                cnt += 1
    cams = []
    viewpoint_cams = sorted(viewpoint_cams, key=lambda x: int(x.image_name[5:]))
    for i, cam in enumerate(viewpoint_cams):
        cam_i = camera_to_JSON_other(i, cam)
        cams.append({
            'location':cam_i['position'],
            'direction':cam_i['rotation'][2]
        })

    dis = []
    cos = []
    for i in range(len(cams)):
        dis.append([cam_dis(cams[i], cams[j]) for j in range(len(cams))])
        cos.append([cam_cos(cams[i], cams[j]) for j in range(len(cams))])
    
    average_dis = sum(sum(i) for i in dis) / (len(cams) * len(cams))
    for i, viewpoint_cam in enumerate(viewpoint_cams):
        if selected_frame is not None and selected_frame[i] == False:
            cam_infos.append(Cam_info(grad=torch.tensor(0., device=device)))
            progress_bar.update(1)
            continue
        if selected_cams[i] == False:
            progress_bar.update(1)
            continue
        iter_start.record()
        # bg = torch.rand((3), device=device) if opt.random_background else background
        bg = background
        # forward rendering
        render_pkg = render(viewpoint_cam, gaussians, pipe, bg)

        # render_pkg = render(viewpoint_cam, gaussians, pipe, bg, eval=True)
        # geomState, imgState, binningState  = render_pkg["geomState"], render_pkg["imgState"], render_pkg["binningState"]
        
        #gradient calculation
        if selected_frame is not None:
            gaussians.optimizer.zero_grad(set_to_none = True)        
            render_pkg = render(viewpoint_cam, gaussians, pipe, bg)
            image= render_pkg["render"]
            gt_image = viewpoint_cam.original_image.to(device)
            Ll1 = l1_loss_withmask(image, gt_image, framemask)
            loss = (1.0 - opt.lambda_dssim) * Ll1 + opt.lambda_dssim * (1.0 - ssim_withmask(image, gt_image, framemask))
            loss.backward()
            with torch.no_grad():
                iter_end.record()
        else:
            gaussians.optimizer.zero_grad(set_to_none = True)        
            render_pkg = render(viewpoint_cam, gaussians, pipe, bg)
            image = render_pkg["render"]
            gt_image = viewpoint_cam.original_image.to(device)
            Ll1 = l1_loss(image, gt_image)
            loss = (1.0 - opt.lambda_dssim) * Ll1 + opt.lambda_dssim * (1.0 - ssim(image, gt_image))
            loss.backward()
            with torch.no_grad():
                iter_end.record()
        
        # gaussian contribution evaluate through radii and grad
        grad_contrib, ratio= cal_gaussian_contrib(gaussians, selected_gaussians, device)
        grad_contrib *= similarity
        # camera contribution evaluate through render infos
        cam_infos.append(cal_cam_contrib(grad_contrib.clone() * ratio, selected_gaussians))

        cnt = sum(1 for i in range(len(cams)) for j in range(len(cams)) if dis[i][j] < 0.5 * average_dis and cos[i][j] > 0.5)

        gaussians_info.add(grad=grad_contrib * len(cams)/ cnt)
        # gaussians_info.add(radii=radii, grad=grad_contrib)
        progress_bar.update(1)
        
    return cam_infos, gaussians_info

def RiskEval_test(opt, pipe, bg_color, viewpoint_cams, gaussians, selected_cams=None, selected_gaussians=None, selected_frame=None, framemasks=None,device="cuda", distance = None):
    """  
    This function takes in 8 numbers, returns a list of Cam_info instances and an entity of Gaussians_info
    
    Input:  
        opt (GroupParams): Read from model training arguments, contains information about training.  
        pipe (GroupParams): Read from model training arguments, necessary for rendering process.  
        bg_color (List[int]): Background color.  
        viewpoint_cams (List[scene.cameras.Camera]): Cameras for evaluation.  
        gaussians (scene.gaussian_model.GaussianModel): Reconstructed gaussians.  
        selected_gaussians (torch.Tensor(dtype=torch.bool)): A tensor describing if the corresponding gaussian is selected for evaluation.  
        selected_cams (torch.Tensor(dtype=torch.bool)): A tensor describing if the corresponding camera is selected for evaluation.
        selected_frame(torch.Tensor(dtype=torch.bool)):A tensor describing if the corresponding frame is selected to put on mask.
        framemasks(list[FrameMask/FrameFreeMask]):information about corners of mask
        device (str, optional): The device to run on. Defaults to 'cuda'.      
    Output:  
        cam_infos (Cam_Info): every camera's risk value, calculated based on gradient.  
        gaussians_info (Gaussians_Info): every gaussian's risk value, calculated based on gradient.
    """  
    _set_cuda_device_if_available(device)
    if selected_gaussians == None:
        selected_gaussians = torch.full((gaussians.get_xyz.shape[0],), True, dtype=torch.bool)
    if selected_cams == None:
        selected_cams = torch.full((len(viewpoint_cams),), True, dtype=torch.bool)
    cam_infos = []
    iter_start = torch.cuda.Event(enable_timing = True)
    iter_end = torch.cuda.Event(enable_timing = True)
    gaussians_info = Gaussians_info(gaussians.get_xyz.shape[0], device=device)
    background = torch.tensor(bg_color, dtype=torch.float32, device=device)
    torch.autograd.set_detect_anomaly(True)
    progress_bar = tqdm(range(0, len(viewpoint_cams)), desc="Evaluating progress")
    similarity = torch.full((gaussians.get_xyz.shape[0],), 1.0, dtype=torch.float, device=device)
    if distance is not None:
        cnt = 0
        eps = 1e-6
        for i in range(selected_gaussians.shape[0]):
            if selected_gaussians[i]:
                similarity[i] = 1 / (distance[cnt] + eps)
                cnt += 1
    cams = []
    viewpoint_cams = sorted(viewpoint_cams, key=lambda x: int(x.image_name[5:]))
    for i, cam in enumerate(viewpoint_cams):
        cam_i = camera_to_JSON_other(i, cam)
        cams.append({
            'location':cam_i['position'],
            'direction':cam_i['rotation'][2]
        })

    dis = []
    cos = []
    for i in range(len(cams)):
        dis.append([cam_dis(cams[i], cams[j]) for j in range(len(cams))])
        cos.append([cam_cos(cams[i], cams[j]) for j in range(len(cams))])
    
    average_dis = sum(sum(i) for i in dis) / (len(cams) * len(cams))
    for i, viewpoint_cam in enumerate(viewpoint_cams):
        if selected_frame is not None and selected_frame[i] == False:
            cam_infos.append(Cam_info(grad=torch.tensor(0., device=device)))
            progress_bar.update(1)
            continue
        if selected_cams[i] == False:
            progress_bar.update(1)
            continue
        iter_start.record()
        # bg = torch.rand((3), device=device) if opt.random_background else background
        bg = background
        # forward rendering
        render_pkg = render(viewpoint_cam, gaussians, pipe, bg)

        # render_pkg = render(viewpoint_cam, gaussians, pipe, bg, eval=True)
        # geomState, imgState, binningState  = render_pkg["geomState"], render_pkg["imgState"], render_pkg["binningState"]

        #gradient calculation
        if selected_frame is not None:
            # Add debug output for the first frame that has a mask.
            if i == 0 or (i > 0 and selected_frame[i-1] == False):
                print(f"[风险计算-图像信息] 帧{i} - original_image shape: {viewpoint_cam.original_image.shape}")
                if framemasks is not None and i < len(framemasks):
                    mask_matrix = framemasks[i].mask_matrix
                    if mask_matrix is not None:
                        print(f"[风险计算-图像信息] 帧{i} - mask_matrix shape: {np.array(mask_matrix).shape if hasattr(mask_matrix, '__len__') else 'scalar'}")

            gaussians.optimizer.zero_grad(set_to_none = True)
            render_pkg = render(viewpoint_cam, gaussians, pipe, bg)
            image= render_pkg["render"]
            gt_image = viewpoint_cam.original_image.to(device)
            Ll1 = l1_loss_withmask(image, gt_image, framemasks[i])
            loss = (1.0 - opt.lambda_dssim) * Ll1 + opt.lambda_dssim * (1.0 - ssim_withmask(image, gt_image, framemasks[i]))
            loss.backward()
            with torch.no_grad():
                iter_end.record()
        else:
            gaussians.optimizer.zero_grad(set_to_none = True)        
            render_pkg = render(viewpoint_cam, gaussians, pipe, bg)
            image = render_pkg["render"]
            gt_image = viewpoint_cam.original_image.to(device)
            Ll1 = l1_loss(image, gt_image)
            loss = (1.0 - opt.lambda_dssim) * Ll1 + opt.lambda_dssim * (1.0 - ssim(image, gt_image))
            loss.backward()
            with torch.no_grad():
                iter_end.record()
        
        # gaussian contribution evaluate through radii and grad
        grad_contrib, ratio= cal_gaussian_contrib(gaussians, selected_gaussians, device)
        grad_contrib *= similarity
        # camera contribution evaluate through render infos
        cam_infos.append(cal_cam_contrib(grad_contrib.clone() * ratio, selected_gaussians))

        cnt = sum(1 for i in range(len(cams)) for j in range(len(cams)) if dis[i][j] < 0.5 * average_dis and cos[i][j] > 0.5)

        gaussians_info.add(grad=grad_contrib * len(cams)/ cnt)
        # gaussians_info.add(radii=radii, grad=grad_contrib)
        progress_bar.update(1)
        
    return cam_infos, gaussians_info

def get_selected_gaussians(bool_path, plypath, gaussians, batch_size=1000, data_device="cuda"):  
    import os  
    if os.path.exists(bool_path):  
        return torch.load(bool_path, map_location=data_device)  
  
    def cmp(x, y, tolerance=1e-6):    
        return torch.abs(x - y) <= tolerance   
  
    selected_gaussians = GaussianModel(3)  
    selected_gaussians.load_ply(plypath, map_location=data_device)  
  
    a = gaussians.get_xyz  
    b = selected_gaussians.get_xyz  
  
    result = torch.zeros(a.shape[0], dtype=torch.bool, device=a.device)  
  
    # calculate number of batches  
    num_batches = (a.shape[0] + batch_size - 1) // batch_size  
  
    for i in range(num_batches):  
        start = i * batch_size  
        end = min((i + 1) * batch_size, a.shape[0])  
        a_batch = a[start:end].unsqueeze(1)  # shape becomes (batch_size, 1, 3)  
        result[start:end] = cmp(a_batch, b.unsqueeze(0)).all(dim=-1).any(dim=-1)  
  
    torch.save(result, bool_path)  
    return result  

def RiskEvalFromFile(eval_checkpoint, dataset, opt, pipe, bg_color, selected_cams=None, selected_gaussians=None, selected_frame=None, frame_mask=None, distance= None):
    _set_cuda_device_if_available(dataset.data_device)
    if not eval_checkpoint:
        print("no available model for cam evaluation")
        return
    gaussians = GaussianModel(dataset.sh_degree)
    scene = Scene(dataset, gaussians, shuffle=False)
    gaussians.training_setup(opt)
    (model_params, first_iter) = torch.load(eval_checkpoint, map_location=dataset.data_device)
    gaussians.restore(model_params, opt)
    bg_color = [1, 1, 1] if dataset.white_background else [0, 0, 0]
    
    viewpoint_cams = scene.getTrainCameras().copy()
    
    cam_infos, gaussians_info = RiskEval(
        opt=opt, pipe=pipe, bg_color=bg_color, 
        viewpoint_cams=viewpoint_cams, 
        gaussians=gaussians, 
        selected_cams=selected_cams,
        selected_gaussians=selected_gaussians, 
        selected_frame=selected_frame,
        framemask=frame_mask,
        device=dataset.data_device,
        distance = distance)
    Cam_info.visualize_grad(cam_infos)
    return cam_infos, gaussians_info

def RiskEvalFromFile_test(eval_checkpoint, dataset, opt, pipe, bg_color, selected_cams=None, selected_gaussians=None, selected_frame=None, frame_masks=None, distance= None):
    _set_cuda_device_if_available(dataset.data_device)
    if not eval_checkpoint:
        print("no available model for cam evaluation")
        return
    gaussians = GaussianModel(dataset.sh_degree)
    scene = Scene(dataset, gaussians, shuffle=False)
    gaussians.training_setup(opt)
    (model_params, first_iter) = torch.load(eval_checkpoint, map_location=dataset.data_device)
    gaussians.restore(model_params, opt)
    bg_color = [1, 1, 1] if dataset.white_background else [0, 0, 0]
    
    viewpoint_cams = scene.getTrainCameras().copy()
    
    cam_infos, gaussians_info = RiskEval_test(
        opt=opt, pipe=pipe, bg_color=bg_color, 
        viewpoint_cams=viewpoint_cams, 
        gaussians=gaussians, 
        selected_cams=selected_cams,
        selected_gaussians=selected_gaussians, 
        selected_frame=selected_frame,
        framemasks=frame_masks,
        device=dataset.data_device,
        distance = distance)
    Cam_info.visualize_grad(cam_infos)
    return cam_infos, gaussians_info

def MainTest(start_checkpoint, source_path, model_path, selected_cam_path=None):
    # Load gaussians and cameras
    parser = ArgumentParser(description="Cam evaluation script parameters")
    lp = ModelParams(parser)
    op = OptimizationParams(parser)
    pp = PipelineParams(parser)
    args = parser.parse_args(sys.argv[1:])
    dataset = lp.extract(args)
    dataset.source_path = source_path
    dataset.model_path = model_path
    opt = op.extract(args)
    pipe = pp.extract(args)
    _set_cuda_device_if_available(dataset.data_device)
    
    if not start_checkpoint:
        print("no available model for cam evaluation")
        return
    gaussians = GaussianModel(dataset.sh_degree)
    scene = Scene(dataset, gaussians, shuffle=False)
    gaussians.training_setup(opt)
    (model_params, first_iter) = torch.load(start_checkpoint, map_location=dataset.data_device)
    gaussians.restore(model_params, opt)
    bg_color = [1, 1, 1] if dataset.white_background else [0, 0, 0]
    
    viewpoint_cams = scene.getTrainCameras().copy()  
    # TODO: This is temporary. Selection is not implemented yet, so a manually cropped .ply is used and the point-cloud intersection determines true or false.
    # selected_gaussians=get_selected_gaussians(selected_cam_path + ".pt", selected_cam_path + ".ply", gaussians, dataset.data_device)
    # TODO: Camera selection is not implemented yet, so this path fabricates the data.
    selected_cams = torch.full((len(viewpoint_cams),), True, dtype=torch.bool)
    selected_cams[:100] = True
    # TODO: Masking is not implemented yet, so this path fabricates the data.
    selected_frame = torch.full((len(viewpoint_cams),), False, dtype=torch.bool)
    selected_frame[:100] = True
    frame_mask = FrameMask(130, 211, 200, 300)
    # frame_mask.visualize_mask(viewpoint_cams[0].original_image.shape)
    
    print("mock data complete")
    
    cam_infos, gaussians_info = RiskEval(
        opt=opt, pipe=pipe, bg_color=bg_color, 
        viewpoint_cams=viewpoint_cams, 
        gaussians=gaussians, 
        selected_cams=selected_cams,
        # selected_gaussians=selected_gaussians, 
        # selected_frame=selected_frame,
        # framemask=frame_mask,
        device=dataset.data_device)
    Cam_info.visualize_grad(cam_infos)
    return cam_infos, gaussians_info

if __name__ == "__main__":
    raise SystemExit("Import this module and call MainTest with explicit project-specific paths.")