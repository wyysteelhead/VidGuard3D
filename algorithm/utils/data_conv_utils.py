import trimesh  
import cv2
import os
import subprocess
from pathlib import Path

def mesh2point(mesh_path, output_path=None, sample_num=10000):
    """  
    This function takes in 3 numbers, turns mesh into points and stores (if output_path is defined).
    
    Input:  
        mesh_path (str): location of the mesh file.
        output_path (str): Path where the exported point cloud should be stored, won't store if not specified.
        sample_num (int): defines how many points to generate.
    """  
    # Load the mesh from the .obj file.
    mesh = trimesh.load_mesh(mesh_path)  
    
    # Uniformly sample points from the mesh surface.
    points, _ = trimesh.sample.sample_surface_even(mesh, sample_num)  
    if output_path is not None:
        if os.path.exists(os.path.dirname(output_path)):
            cloud = trimesh.points.PointCloud(points)  
            # Export the sampled points as a .ply file.
            cloud.export(output_path)  
        else:
            print("Point cloud output path does not exist.")
    return points

def video2images(video_path, output_path):
    """  
    This function takes in 2 numbers, turns video into images and stores in a folder.
    
    Input:  
        video_path (str): location of the video
        output_path (str): Path where the exported images should be stored
    
    The images are stored in the following way:
    <output_path>
    |---input
    |   |---<image 0>
    |   |---<image 1>
    |   |---...
    """  
    # Ensure the output directory exists.
    if not os.path.exists(os.path.join(output_path, "input")):
        os.makedirs(os.path.join(output_path, "input"))
  
    # Open the video file.
    video = cv2.VideoCapture(video_path)  
  
    # Initialize the frame counter.
    frame_count = 0  
  
    while True:  
        # Read one frame from the video.
        success, frame = video.read()  
          
        # Stop once the video reaches the end.
        if not success:  
            break  
          
        img_file_path = os.path.join(os.path.join(output_path, "input"), f"frame{frame_count}.jpg")  
  
        # Write the frame to a .jpg file.
        cv2.imwrite(img_file_path, frame)  
  
        # Increment the frame counter.
        frame_count += 1  
  
    video.release()  # Release the video handle.

def convert(dataset_path: str):
    """  
    This function takes in 1 numbers, use colmap to extract features and converts dataset into colmap dataset
    
    Input:  
        dataset_path (str): dataset path, the dataset should be organized in the following way:  
        <dataset_path>
        |---input
            |---<image 0>
            |---<image 1>
            |---...
    
    The result dataset is stored here:
    <dataset_path>
    |---images
    |   |---<image 0>
    |   |---<image 1>
    |   |---...
    |---sparse
        |---0
            |---cameras.bin
            |---images.bin
            |---points3D.bin
    """  
    # Build the script path and argument list.
    script = str(Path(__file__).resolve().parents[1] / 'convert.py')
    args = ['-s', dataset_path,'--camera', "SIMPLE_PINHOLE","--resize"]  
    
    # Run the conversion script.
    process = subprocess.run(['python', script] + args, check=True)  
    if process.returncode == 0:  
        print("Colmap extraction and convertion completed successfully")
    else:  
        print("Colmap extraction and convertion failed with return code:", process.returncode)  
    return process.returncode

    
if __name__ == "__main__":
    # video2images(video_path="D:\\dataset\\3dGS\\Miku_dancing_test\\model.mp4", output_path="D:\\dataset\\3dGS\\Miku_dancing_test")
    points = mesh2point('D:\\dataset\\3dGS\\splatoon_toy\\model.obj', "D:\\dataset\\3dGS\\splatoon_toy\\splatoon_toy.ply")
    # convert("D:\\dataset\\3dGS\\Miku_dancing_test")