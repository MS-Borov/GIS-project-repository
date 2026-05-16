import type Feature from "ol/Feature";
import type { Geometry } from "ol/geom";

export type SelectedLayerFeature = {
  assetId: number;
  featureIndex: number;
} | null;

export type ZoomSelectionTarget = {
  sourceKeys?: Set<string>;
  sourceFeature?: SelectedLayerFeature;
  draftFeatures?: Feature<Geometry>[];
};

export function featureSelectionKey(assetId: number, featureIndex: number) {
  return `${assetId}:${featureIndex}`;
}
