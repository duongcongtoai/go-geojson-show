package show

import (
	"encoding/json"
	"net/http"
)

// LocalConfig defines application-specific configuration details.
type LocalConfig struct {
	// Cluster markers that a proximate to one another.
	ClusterMarkers bool `json:"cluster_markers"`
	// One or more URIs to load using the L.esri.featureLayer method. Required if map provider is "leaflet".
	ESRIFeatureLayers []string `json:"esri_feature_layers"`
	// The maximum zoom level for Leaflet maps and tile layers.
	MaxZoom           int      `json:"max_zoom"`
}

// LocalConfigHandler returns an `http.Handler` instance that when called will return 'cfg' as a JSON-encoded string.
func LocalConfigHandler(cfg *LocalConfig) http.Handler {

	fn := func(rsp http.ResponseWriter, req *http.Request) {

		rsp.Header().Set("Content-type", "application/json")

		enc := json.NewEncoder(rsp)
		err := enc.Encode(cfg)

		if err != nil {
			http.Error(rsp, "Internal server error", http.StatusInternalServerError)
			return
		}
	}

	return http.HandlerFunc(fn)
}
