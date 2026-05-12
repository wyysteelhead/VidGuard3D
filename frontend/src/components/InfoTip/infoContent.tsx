export const InfoPointCloud = () => {
  return <p>interaction: zoom, rotate and select</p>;
};

export const InfoGaussianSplat = () => {
  return (
    <p>
      interaction: zoom
      <br />
      note: rotation follows loss visualization
    </p>
  );
};

export const InfoMeshViewer = () => {
  return <p>Use the file input to select a .mtl, .obj and .jpg file</p>;
};

export const InfoFrameMask = () => {
  return <p>interaction: draw mask, resize mask, move mask</p>;
};

export const InfoFrameSelection = () => {
  return (
    <p>Identify frames of high risk and select them using the upper-most row</p>
  );
};

export const InfoCharts = () => {
  return (
    <p>
      A handful of visual representations of the data in the project. More data
      is collected and shown here as you use the system.
    </p>
  );
};

export const InfoChartsPie = () => {
  return (
    <>
      <p>Outer ring breaks down risks pre-edit</p>
      <p>Inner ring is the risks after edits</p>
    </>
  );
};

export const InfoChartsLine = () => {
  return (
    <>
      <p>Outer ring breaks down risks pre-edit</p>
      <p>Inner ring is the risks after edits</p>
    </>
  );
};
