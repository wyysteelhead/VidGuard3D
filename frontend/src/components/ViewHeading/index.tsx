const ViewHeading = ({
  children,
  ...props
}: {
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLHeadingElement>) => {
  return (
    <h2
      className={`inline-block -mt-1 mb-2 leading-3 text-2xl font-semibold uppercase text-gray-500 ${props.className}`}
    >
      {children}
    </h2>
  );
};

export const ViewSubHeading = ({
  children,
  ...props
}: {
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLHeadingElement>) => {
  return (
    <h3
      className={`inline-block text-xl leading-5 font-medium uppercase text-gray-400 ${props.className}`}
    >
      {children}
    </h3>
  );
};

export default ViewHeading;
