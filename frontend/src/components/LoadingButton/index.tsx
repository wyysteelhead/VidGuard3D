import Spinner from '../spinners';

const LoadingButton = ({ isLoading, children, className, ...props }) => {
  return (
    <button
      className={`flex flex-row justify-center items-center gap-1 ${className}`}
      {...props}
      disabled={isLoading}
    >
      {children}
      {isLoading && (
        <>
          <span className="ml-2 text-white text-opacity-50 fill-white">
            <Spinner />
          </span>
        </>
      )}
    </button>
  );
};

export default LoadingButton;
