import React from 'react';
import { create, UseBoundStore, StoreApi } from 'zustand';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls';
import THREE from 'three';
import EditElement from '@/components/FrameVisualization/Edit';

export interface ImageData {
  data: string;
  format: string;
}
export interface Frame {
  aspect_ratio: number;
  direction: number[];
  fovx: number;
  fovy: number;
  image: ImageData;
  location: number[];
  risk: number;
  isDeleted: boolean | undefined;
}

const SceneContext = React.createContext({
  rotation: { x: 0, y: 0, z: 0 },
  scale: 1,

  setRotation: () => {},

  setScale: () => {},
});

export const HeatmapFramesContext: React.Context<{
  heatmapFrames: Frame[];
}> = React.createContext({
  heatmapFrames: [] as Frame[],
});

export const useStore: UseBoundStore<
  StoreApi<{
    riskRange: [number, number];
    setRiskRange: (riskRange: [number, number]) => void;
    updateRiskRange: (
      update: (riskRange: [number, number]) => [number, number],
    ) => void;
    original3DController: TrackballControls | null;
    setOriginal3DController: (
      original3DController: TrackballControls | null,
    ) => void;
    updateOriginal3DController: (
      update: (
        controller: TrackballControls | null,
      ) => TrackballControls | null,
    ) => void;
    original3DCamera: THREE.Camera | null;
    setOriginal3DCamera: (original3DCamera: THREE.Camera | null) => void;
    updateOriginal3DCamera: (
      update: (camera: THREE.Camera | null) => THREE.Camera | null,
    ) => void;
    editsForComparisons: EditElement[];
    setEditsForComparisons: (editsForComparisons: EditElement[]) => void;
    updateEditsForComparisons: (
      update: (editsForComparisons: EditElement[]) => EditElement[],
    ) => void;
    editsPlans: { plan: EditElement[]; risk: Frame[] }[];
    setEditsPlans: (
      editsPlans: { plan: EditElement[]; risk: Frame[] }[],
    ) => void;
    updateEditsPlans: (
      update: (
        editsPlans: { plan: EditElement[]; risk: Frame[] }[],
      ) => { plan: EditElement[]; risk: any }[],
    ) => void;
  frameWidth: number | null;
  setFrameWidth: (frameWidth: number | null) => void;
  frameHeight: number | null;
  setFrameHeight: (frameHeight: number | null) => void;
    originalRisk: Frame[];
    setOriginalRisk: (originalRisk: Frame[]) => void;
    updateOriginalRisk: (update: (originalRisk: Frame[]) => Frame[]) => void;
    selectedIndices: number[];
    setSelectedIndices: (selectedIndices: number[]) => void;
  }>
> = create(set => ({
  riskRange: [0, 1],
  setRiskRange: riskRange => set({ riskRange }),
  updateRiskRange: update => {
    set(state => ({ riskRange: update(state.riskRange) }));
  },
  original3DController: null,
  setOriginal3DController: original3DController =>
    set({ original3DController }),
  updateOriginal3DController: update => {
    set(state => ({
      original3DController: update(state.original3DController),
    }));
  },
  original3DCamera: null,
  setOriginal3DCamera: original3DCamera => set({ original3DCamera }),
  updateOriginal3DCamera: update => {
    set(state => ({ original3DCamera: update(state.original3DCamera) }));
  },
  editsForComparisons: [],
  setEditsForComparisons: editsForComparisons => set({ editsForComparisons }),
  updateEditsForComparisons: update => {
    set(state => ({ editsForComparisons: update(state.editsForComparisons) }));
  },
  editsPlans: [],
  setEditsPlans: editsPlans => set({ editsPlans }),
  updateEditsPlans: update => {
    set(state => ({ editsPlans: update(state.editsPlans) }));
  },
  frameWidth: null,
  setFrameWidth: frameWidth => set({ frameWidth }),
  frameHeight: null,
  setFrameHeight: frameHeight => set({ frameHeight }),
  originalRisk: [],
  setOriginalRisk: originalRisk => set({ originalRisk }),
  updateOriginalRisk: update => {
    set(state => ({ originalRisk: update(state.originalRisk) }));
  },
  selectedIndices: [],
  setSelectedIndices: selectedIndices => set({ selectedIndices }),
}));

export default SceneContext;
