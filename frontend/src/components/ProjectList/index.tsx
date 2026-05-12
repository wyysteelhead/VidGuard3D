import React, { useEffect, useState } from 'react';
import { useLoaderData } from '@modern-js/runtime/router';
import { Switch } from 'antd';
import { getProjects } from '../../routes/page.data';
import { IconHistory, IconRefresh } from '../icons';

function timeSince(unixTimestamp) {
  const seconds = Math.floor(new Date().getTime() / 1000 - unixTimestamp);
  let interval = seconds / 31536000;

  if (interval > 1) {
    return `Uploaded ${Math.floor(interval)} years ago`;
  }
  interval = seconds / 2592000;
  if (interval > 1) {
    return `Uploaded ${Math.floor(interval)} months ago`;
  }
  interval = seconds / 86400;
  if (interval > 1) {
    return `Uploaded ${Math.floor(interval)} days ago`;
  }
  interval = seconds / 3600;
  if (interval > 1) {
    return `Uploaded ${Math.floor(interval)} hours ago`;
  }
  interval = seconds / 60;
  if (interval > 1) {
    return `Uploaded ${Math.floor(interval)} minutes ago`;
  }
  return `Uploaded ${Math.floor(seconds)} seconds ago`;
}

function sortByName(projectArray) {
  return projectArray.sort((a, b) => {
    // Case-insensitive comparison (optional)
    const nameA = a.name.toLowerCase();
    const nameB = b.name.toLowerCase();

    if (nameA < nameB) {
      return -1; // a goes before b
    }
    if (nameA > nameB) {
      return 1; // b goes before a
    }
    return 0; // a and b have the same name (order unchanged)
  });
}

function sortByUploadedTime(projectArray) {
  // Sort in descending order (latest uploaded first)
  return projectArray.sort((a, b) => {
    // Projects without 'unix' go to the beginning (treated as older)
    if (!a.unix) {
      return -1;
    } // a goes before b
    if (!b.unix) {
      return 1;
    } // b goes before a

    // Compare unix timestamps for those with 'uploaded'
    return b.unix - a.unix; // Descending order
  });
}

function ProjectCard({ id, name, status, image, unix }) {
  const progress = status?.progress ?? -1; // Default to 0 if `progress` is missing

  const cardImage = (
    <>
      {image && (
        <img
          src={`data:${image.format};base64,${image.data}`}
          alt={name}
          className={`w-full h-48 object-cover rounded-t-lg ${
            progress < 1 ? 'opacity-50' : ''
          }`}
        />
      )}
      {!image && (
        <div className="w-full h-48 bg-gray-200 flex items-center justify-center rounded-t-lg">
          <p className="text-gray-700 text-lg">No thumbnail available</p>
        </div>
      )}
    </>
  );

  const cardTag = (
    <>
      {progress === 1 && (
        <span className="inline-block px-2 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800">
          Ready
        </span>
      )}
      {progress < 1 && progress >= 0 && (
        <span className="inline-block px-2 py-1 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-800">
          Processing
        </span>
      )}
      {progress < 0 && (
        <span className="inline-block px-2 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800">
          Error
        </span>
      )}
    </>
  );

  const progressBar = (
    <>
      <div className="mt-2 w-full bg-white rounded-full h-2.5">
        <div
          className="bg-blue-600 h-2.5 rounded-full"
          style={{ width: `${progress * 100}%` }}
        ></div>
      </div>
    </>
  );

  const card = (
    <>
      <div>{cardImage}</div>
      <div className="p-4">
        <div className="flex flex-row items-center justify-between">
          <h3 className="text-lg font-medium">{name}</h3>
          {cardTag}
        </div>
        {progress >= 0 && progress < 1 && <>{progressBar}</>}
        {progress === 1 && (
          <p className="text-sm text-gray-500">{timeSince(unix)}</p>
        )}
        {progress < 0 && (
          <p className="text-sm font-mono text-red-500">{status.message}</p>
        )}
      </div>
    </>
  );

  if (progress === 1) {
    return (
      <a
        href={`/${id}`}
        className="bg-white rounded-xl shadow-md hover:bg-gray-200 transition-colors"
      >
        {card}
      </a>
    );
  } else {
    return <div className="bg-gray-300 rounded-xl shadow-md">{card}</div>;
  }
}

function ProjectList() {
  const [projects, setProjects] = useState<null | any[]>(
    useLoaderData() as any,
  );
  const [time, setTime] = useState(new Date());
  const updateIntervalSeconds = 10;

  useEffect(() => {
    if (updateIntervalSeconds < 1) {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      return () => {};
    }

    const interval = setInterval(async () => {
      const newProjects = await getProjects();
      setProjects(newProjects);
      setTime(new Date());
    }, updateIntervalSeconds * 1000);

    return () => clearInterval(interval);
  }, []);

  let listBody = <></>;

  if (projects === null) {
    listBody = (
      <div className="flex justify-center items-center">
        <p className="px-4 py-2 my-12 rounded-full text-sm font-semibold font-mono bg-red-200 text-red-800">
          Error retrieving projects - check console
        </p>
      </div>
    );
  } else if (projects.length === 0) {
    listBody = (
      <div className="flex justify-center items-center">
        <p className="px-4 py-2 my-12 rounded-full text-sm font-semibold bg-gray-300 text-gray-900">
          No projects found
        </p>
      </div>
    );
  } else if (projects.length > 0) {
    const sortedProjects = sortByUploadedTime(projects);
    listBody = (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sortedProjects.map(project => (
          <ProjectCard key={project.id} {...project} />
        ))}
      </div>
    );
  }

  return (
    <div className="container mx-auto bg-gray-200 rounded-xl p-4">
      <div className="flex flex-row items-center text-xl mb-4">
        <div className="flex flex-row items-center">
          <IconHistory />
          <h2 className="ml-2">Previous projects</h2>
        </div>
        <div className="flex flex-row items-center ml-auto text-md text-gray-500 bg-white px-4 py-2 rounded-xl">
          <p className="text-xs">
            Updates every {updateIntervalSeconds} seconds
          </p>
          <span className="animate-spin ml-2">
            <IconRefresh />
          </span>
        </div>
      </div>
      {listBody}
    </div>
  );
}

export default ProjectList;
