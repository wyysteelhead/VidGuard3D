# Example script. Override GPU_ID or CUDA_VISIBLE_DEVICES for your environment.
GPU_ID="${GPU_ID:-${CUDA_VISIBLE_DEVICES:-0}}"
CUDA_VISIBLE_DEVICES="${GPU_ID}" python train_contrastive_feature.py --model_path ./output/3dovs-bed --iterations 10000 --feature_lr 0.0025 --num_sampled_ray 1000
CUDA_VISIBLE_DEVICES="${GPU_ID}" python train_contrastive_feature.py --model_path ./output/3dovs-bench --iterations 10000 --feature_lr 0.0025 --num_sampled_ray 1000
CUDA_VISIBLE_DEVICES="${GPU_ID}" python train_contrastive_feature.py --model_path ./output/3dovs-room --iterations 10000 --feature_lr 0.0025 --num_sampled_ray 1000
CUDA_VISIBLE_DEVICES="${GPU_ID}" python train_contrastive_feature.py --model_path ./output/3dovs-sofa --iterations 10000 --feature_lr 0.0025 --num_sampled_ray 1000
CUDA_VISIBLE_DEVICES="${GPU_ID}" python train_contrastive_feature.py --model_path ./output/3dovs-lawn --iterations 10000 --feature_lr 0.0025 --num_sampled_ray 1000