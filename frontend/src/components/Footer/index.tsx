const Footer = () => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 items-center justify-between p-2 gap-4">
      <p className="text-center md:text-left">Left text</p>
      <p className="text-xl text-center text-gray-800">
        Copyright &copy; 2024{' '}
      </p>
      <p className="text-center md:text-right">Right text</p>
    </div>
  );
};

export default Footer;
