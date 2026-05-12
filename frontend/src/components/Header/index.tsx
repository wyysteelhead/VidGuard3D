import { useParams, useRouteLoaderData } from '@modern-js/runtime/router';
import { useEffect, useState } from 'react';
import { IconFolder } from '../icons';

const Header = () => {
  const { id } = useParams();
  const data = useRouteLoaderData('[id]/page') as any;
  const [projectName, setProjectName] = useState<string>('');

  const title = (
    <a href="/" className="">
      <h1 className="text-5xl font-bold my-1 text-center text-gray-800 tracking-widest">
        VidGuard3D
      </h1>
    </a>
  );

  if (id === undefined) {
    return (
      <div
        className={`flex justify-center items-center bg-primary-light px-4 py-1`}
      >
        {title}
      </div>
    );
  }

  // Access project data defensively because the loader may still be pending.
  if (data?.project) {
    data.project
      .then(result => {
        setProjectName(result.name);
      })
      .catch(err => {
        setProjectName('');
      });
  }

  return (
    <div
      className={`grid ${
        id ? 'grid-cols-3' : 'grid-cols-1'
      } items-center justify-between bg-primary-light px-4 py-1`}
    >
      <div className="flex flex-row text-2xl gap-4">
        {(projectName && (
          <p className="text-gray-800">
            Project name:{' '}
            <span className="font-mono text-gray-950">{projectName}</span>
          </p>
        )) || (
          <p className="text-gray-800">
            Project ID: <span className="font-mono text-gray-950">{id}</span>
          </p>
        )}
      </div>
      {title}
      <a href="/" className="ml-4 flex justify-end items-center">
        <div className="flex flex-row items-center justify-end py-2 px-4 rounded-xl text-xl bg-primary-darker hover:bg-primary-darkest text-black">
          <h2 className="mr-4 uppercase">View projects</h2>
          <span className="text-2xl">
            <IconFolder />
          </span>
        </div>
      </a>
    </div>
  );
};

export default Header;
