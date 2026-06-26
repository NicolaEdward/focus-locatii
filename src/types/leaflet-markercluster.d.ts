import "leaflet";

declare module "leaflet.markercluster" {
  const markercluster: unknown;
  export default markercluster;
}

declare module "leaflet" {
  interface MarkerClusterGroupOptions {
    spiderfyOnMaxZoom?: boolean;
    showCoverageOnHover?: boolean;
    zoomToBoundsOnClick?: boolean;
    disableClusteringAtZoom?: number;
    maxClusterRadius?: number | ((zoom: number) => number);
    spiderfyOnEveryZoom?: boolean;
    spiderfyDistanceMultiplier?: number;
    iconCreateFunction?: (cluster: { getAllChildMarkers?: () => Marker[]; getChildCount: () => number }) => DivIcon;
  }

  class MarkerClusterGroup extends FeatureGroup {
    constructor(options?: MarkerClusterGroupOptions);
  }

  function markerClusterGroup(options?: MarkerClusterGroupOptions): MarkerClusterGroup;
}
