import open3d as o3d  
import numpy as np  
import matplotlib.pyplot as plt  
from plyfile import PlyData
  
def ply2o3d(path):
    ply = PlyData.read(path) 
    # Convert point and color data into NumPy arrays.
    points = np.vstack((ply['vertex']['x'], ply['vertex']['y'], ply['vertex']['z'])).T  
    
    # Attach colors when the ply file provides them.
    if 'red' in ply['vertex'].data.dtype.names:  # Check whether color information exists.
        colors = np.vstack((ply['vertex']['red'], ply['vertex']['green'], ply['vertex']['blue'])).T / 255  # Open3D expects colors in the [0, 1] range.
    else:  
        colors = None  
    
    # Create the Open3D point cloud and populate points and colors.
    pcd = o3d.geometry.PointCloud()  
    pcd.points = o3d.utility.Vector3dVector(points)  
    if colors is not None:  
        pcd.colors = o3d.utility.Vector3dVector(colors)  
    
    # # You can now run Open3D operations on the point cloud, such as visualization.
    # o3d.visualization.draw_geometries([pcd])  
    return pcd

def point_cmp(recon_path, GT_path):
    # Step 1: Load point clouds from recon_path and GT_path.
    recon_ply = ply2o3d(recon_path + "/point_cloud.ply")
    # recon_ply = o3d.io.read_point_cloud(recon_path + "/point_cloud.ply")  
    GT_ply = o3d.io.read_point_cloud(GT_path + "/point_cloud.ply")  
    # o3d.visualization.draw_geometries([GT_ply, recon_ply]) 
    
    # Step 2: Radius Outlier Removal  
    cl, ind = recon_ply.remove_radius_outlier(nb_points=16, radius=0.05)  
    recon_ply = recon_ply.select_by_index(ind)  
    
    # Step 3: Normalize both point clouds.
    # Compute the median center.
    median_center_recon = np.median(np.asarray(recon_ply.points), axis=0)  
    median_center_GT = np.median(np.asarray(GT_ply.points), axis=0)  
    
    # Translate both clouds to the origin.
    recon_ply.points = o3d.utility.Vector3dVector(np.asarray(recon_ply.points) - median_center_recon)  
    GT_ply.points = o3d.utility.Vector3dVector(np.asarray(GT_ply.points) - median_center_GT)  
    
    # Scale both clouds using the median point distance.
    median_dist_recon = np.median(np.linalg.norm(np.asarray(recon_ply.points), axis=1))  
    median_dist_GT = np.median(np.linalg.norm(np.asarray(GT_ply.points), axis=1))  
    
    recon_ply.points = o3d.utility.Vector3dVector(np.asarray(recon_ply.points) / median_dist_recon)  
    GT_ply.points = o3d.utility.Vector3dVector(np.asarray(GT_ply.points) / median_dist_GT)  
    
    # Step 4: Run ICP registration.
    trans_init = np.asarray([[1, 0, 0, 0],   
                            [0, 1, 0, 0],   
                            [0, 0, 1, 0],   
                            [0, 0, 0, 1]])  
    reg_p2p = o3d.pipelines.registration.registration_icp(  
        recon_ply, GT_ply, 0.02, trans_init,  
        o3d.pipelines.registration.TransformationEstimationPointToPoint())  
    
    # Step 5: Compute the Hausdorff distance.
    distances = recon_ply.compute_point_cloud_distance(GT_ply)  
    
    # Step 6: Recolor points based on the Hausdorff distance.
    distances = np.asarray(distances)  
    distances = np.clip(distances, 0, 0.7)
    colors = plt.get_cmap("coolwarm")(distances / np.max(distances))[:, :3]  
    recon_ply.colors = o3d.utility.Vector3dVector(colors)  
    
    # o3d.visualization.draw_geometries([GT_ply, recon_ply]) 
    # o3d.io.write_point_cloud("D:\\Repositories\\VidGuard3D\\ground_truth.ply", GT_ply) 
    
    return recon_ply

if __name__ == "__main__":
    recon_path = "D:\\dataset\\3dGS\\models\\dragon_colorful\\point_cloud\\iteration_30000"  
    GT_path = "D:\\dataset\\3dGS\\dragon_colorful\\model_obj"  
    cmp_ply = point_cmp(recon_path, GT_path)
    # # Render the point cloud.
    o3d.visualization.draw_geometries([cmp_ply]) 
    
    # Save the result.
    o3d.io.write_point_cloud("D:\\Repositories\\VidGuard3D\\result.ply", cmp_ply)  