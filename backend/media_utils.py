import base64
import io
import hashlib
from PIL import Image
import os


# convert single image to base64 using the image's filepath
# return a str
def image_to_base64(image_path):
    # base64_list = []
    with open(image_path, "rb") as image_file:
        # Read the image file as raw bytes.
        image_binary = image_file.read()
        # Convert the bytes to a Base64-encoded string.
        base64_encoded = base64.b64encode(image_binary).decode("utf-8")
        return base64_encoded

# convert images under one certain directory to base64 encoding
# return encoding list and name list
def images_to_base64_from_dir(dir_path):
    base64_list = []
    name_list = []
    for image_name in os.listdir(dir_path):
        if image_name.endswith(".jpg"):
            image_path = os.path.join(dir_path, image_name)
            with open(image_path, "rb") as image_file:
                # Read the image file as raw bytes.
                image_binary = image_file.read()
                # Convert the bytes to a Base64-encoded string.
                base64_encoded = base64.b64encode(image_binary).decode("utf-8")
                # Append the encoded data and filename to the return lists.
                name_list.append(image_name)
                base64_list.append(base64_encoded)
    return base64_list, name_list

def show_base64_image(base64_encoding:str):
    image = Image.open(io.BytesIO(base64_encoding))
    image.show()
    return


# get one file's md5
# return a str
def file_md5(file_path, hash_algorithm='md5', block_size=65536):
    hash_value = hashlib.new(hash_algorithm)
    with open(file_path, 'rb') as f:
        for block in iter(lambda: f.read(block_size), b''):
            hash_value.update(block)
    return hash_value.hexdigest()

if __name__ == '__main__':
    print('Provide a real image directory path before running this module directly.')
