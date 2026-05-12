import React, { useState, useRef } from 'react';
import {
  IconCloudTick,
  IconUpload,
  IconUpCircle,
  IconWarning,
  IconAddCircle,
} from '../icons';

const baseApiUrl = process.env.CONFIG.BACKEND_API_BASE_URL;
const NAME_MAX_LENGTH = 20;

function VideoUpload() {
  const [videoFile, setVideoFile] = useState(null);
  const [videoName, setVideoName] = useState('');
  const [uploadedId, setUploadedId] = useState(null);
  const [formStatus, setFormStatus] = useState('ready'); // ready, uploading, error, success
  const fileInputRef = useRef(null);

  const handleFileChange = event => {
    const file = event.target.files[0];
    if (file && file.type === 'video/mp4') {
      setVideoFile(file);
    } else {
      setVideoFile(null);
      event.target.value = null;
    }
  };

  const handleNameChange = event => {
    setVideoName(event.target.value.substring(0, NAME_MAX_LENGTH)); // Limit to 20 chars
  };

  const handleClear = () => {
    setVideoName('');
    setVideoFile(null);
  };

  const handleSubmit = event => {
    event.preventDefault();
    async function upload(formData) {
      setFormStatus('uploading');
      fetch(`${baseApiUrl}upload`, {
        method: 'POST',
        body: formData,
      })
        .then(res => {
          return res.json();
        })
        .then(data => {
          setUploadedId(data.id);
          setFormStatus('success');
        })
        .catch(() => {
          setFormStatus('error');
        });
    }

    // video file required
    if (!videoFile) {
      return;
    }

    // video name required
    if (!videoName) {
      return;
    }

    const formData = new FormData();
    formData.append('name', videoName);
    formData.append('video', videoFile);

    upload(formData);
  };

  let body: React.ReactElement | null = null;
  if (formStatus === 'ready') {
    body = (
      <>
        <div className="flex flex-row justify-center items-center text-xl mb-4">
          <IconAddCircle />
          <h2 className="ml-2">Start new project</h2>
        </div>
        <form
          className="grid grid-cols-1 md:grid-cols-2 items-baseline md:items-center justify-start gap-2"
          onSubmit={handleSubmit}
        >
          <input
            type="file"
            className="col-span-2 py-2 px-4 rounded-xl border border-gray-300 bg-white"
            id="video_file"
            accept="video/mp4"
            ref={fileInputRef}
            onChange={handleFileChange}
            multiple={false}
            required
          />
          <input
            type="text"
            className="col-span-2 py-2 px-4 rounded-xl border border-gray-300"
            id="video_name"
            value={videoName}
            onChange={handleNameChange}
            placeholder="Project name"
            maxLength={20}
            required
          />
          <button
            type="reset"
            onClick={handleClear}
            className="py-2 px-4 text-xl uppercase rounded-xl flex flex-grow justify-center items-center gap-2 bg-gray-400 hover:bg-gray-500 text-white"
          >
            Reset
          </button>
          <button
            type="submit"
            className="py-2 px-4 text-xl uppercase rounded-xl flex flex-grow justify-center items-center gap-2 bg-primary select-dark hover:bg-primary-dark text-white"
          >
            Upload
            <span className="text-xl">
              <IconUpload />
            </span>
          </button>
        </form>
      </>
    );
  } else if (formStatus === 'success') {
    body = (
      <div className="flex flex-col justify-center items-center text-xl">
        <span className="text-5xl">
          <IconCloudTick />
        </span>
        <h2 className="mt-4">Upload successful</h2>
        {uploadedId && <p className="mt-2">ID: {uploadedId}</p>}
      </div>
    );
  } else if (formStatus === 'uploading') {
    body = (
      <div className="flex flex-col justify-center items-center text-xl">
        <span className="text-5xl motion-safe:mt-4 motion-safe:animate-bounce">
          <IconUpCircle />
        </span>
        <h2 className="mt-4">Uploading...</h2>
      </div>
    );
  } else {
    // status === 'error' or something else
    body = (
      <div className="flex flex-col justify-center items-center text-xl">
        <span className="text-5xl">
          <IconWarning />
        </span>
        <h2 className="mt-4">Upload failed, check console</h2>
      </div>
    );
  }

  return (
    <div className="container max-w-3xl mx-auto bg-primary-lightest rounded-xl p-4">
      {body}
    </div>
  );
}

export default VideoUpload;
