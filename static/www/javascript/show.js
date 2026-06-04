window.addEventListener("load", function load(event){

    // Null Island
    const map = L.map('map').setView([0.0, 0.0], 12);

    // Global scope variables for bidirectional map highlights
    var idToLayerMap = {};
    var activeHighlightedLayer = null;
    var originalStyle = null;
    var markerClusterGroup = null;

    // New Global State Variables for Stateful UI
    let initialFeatures = [];
    let allFeatures = [];
    let overlapHandlingEnabled = true;
    let currentGeojsonLayer = null;
    let mapInitialized = false;
    let local_cfg_global = null;
    let map_cfg_global = null;

    const applyCustomStyles = function(feature, style){

	if (feature && feature.properties) {
	    if (feature.properties.color) {
		style.color = feature.properties.color;
		style.fillColor = feature.properties.color;
	    }
	    if (feature.properties.fillColor) {
		style.fillColor = feature.properties.fillColor;
	    }
	    if (feature.properties.weight) {
		style.weight = feature.properties.weight;
	    }
	    if (feature.properties.opacity) {
		style.opacity = feature.properties.opacity;
	    }
	    if (feature.properties.offset !== undefined) {
		style.offset = Number(feature.properties.offset);
	    }
	}

	if (!style || !("custom" in style) || !style.custom){
	    return style;
	}
	
	if ("color_map" in style.custom){
	    
	    const color_map = style.custom.color_map;
	    const prop = color_map.property;
	    
	    if (prop in feature.properties){
		
		const v = feature.properties[prop];
		const str_v = String(v);
		
		if (str_v in color_map.key){
		    
		    if ("color" in color_map.key[str_v]){
			style.color = color_map.key[str_v]["color"];
		    }
		    
		    if ("opacity" in color_map.key[v]){
			style.opacity = color_map.key[v]["opacity"];
		    }				    
		}
	    }
	}
	
	if ("fill_map" in style.custom){
	    
	    const fill_map = style.custom.fill_map;
	    const prop = fill_map.property;
	    
	    if (feature.properties[prop]){
		
		const v = feature.properties[prop];
		const str_v = String(v);
		
		if (str_v in fill_map.key){

		    if ("color" in fill_map.key[v]){ 
			style.fillColor = fill_map.key[v]["color"];
		    }
		    
		    if ("opacity" in fill_map.key[v]){ 
			style.fillOpacity = fill_map.key[v]["opacity"];
		    }
		    
		}
	    }
	    
	}
	
	if ("pane_map" in style.custom){

	    const pane_map = style.custom.pane_map;
	    const prop = pane_map.property;

	    if (prop in feature.properties){

		const v = feature.properties[prop];
		const str_v = String(v);

		if (str_v in pane_map.key){
		    
		    const label = pane_map.key[str_v];
		    
		    if (map.getPane(label)){
			// console.log("YES Assign feature to pane", label);			
			style.pane = label;
		    }
		    
		} else if ("*" in pane_map.key){

		    const label = pane_map.key["*"];
		    
		    if (map.getPane(label)){
			// console.log("YES Assign feature to pane", label);			
			style.pane = label;
		    }
		} else {
		    // pass
		}
	    }
	}
	    
	return style;
    };
    
    const select = function(show_id){

	unselect();
	
	var el = document.getElementById(show_id);
	
	if (el){
	    el.setAttribute("class", "selected");
	    // el.scrollIntoView();
	}
	
    };
    
    const unselect = function(){
	
	var current = document.querySelector(".selected");
	
	if (current){
	    current.classList.remove("selected");
	}
    };

    const clearMapHighlights = function() {
        if (activeHighlightedLayer && originalStyle) {
            if (typeof activeHighlightedLayer.setStyle === "function") {
                activeHighlightedLayer.setStyle(originalStyle);
            } else if (typeof activeHighlightedLayer.setOpacity === "function") {
                activeHighlightedLayer.setOpacity(originalStyle.opacity);
            }
            activeHighlightedLayer = null;
            originalStyle = null;
        }
    };

    const highlightMapElement = function(show_id) {
        // 1. Clear any previous highlights
        clearMapHighlights();

        var layer = idToLayerMap[show_id];
        if (!layer) return;

        // 2. Select corresponding JSON block visually
        select(show_id);

        // 3. Keep track of original style and apply Bold Contrast Style
        if (typeof layer.setStyle === "function") {
            originalStyle = {
                color: layer.options.color,
                fillColor: layer.options.fillColor,
                weight: layer.options.weight,
                opacity: layer.options.opacity,
                radius: layer.options.radius
            };

            if (layer instanceof L.CircleMarker) {
                layer.setStyle({
                    color: originalStyle.color,
                    fillColor: originalStyle.fillColor,
                    radius: 14,
                    weight: 3
                });
            } else {
                layer.setStyle({
                    color: originalStyle.color,
                    weight: 8,
                    opacity: 1.0
                });
            }
            activeHighlightedLayer = layer;
        } else if (typeof layer.setOpacity === "function") {
            originalStyle = { opacity: layer.options.opacity || 1.0 };
            layer.setOpacity(1.0);
            activeHighlightedLayer = layer;
        }

        // 4. Bring Vector to the Front (so it is not hidden behind other overlapping lines)
        if (typeof layer.bringToFront === "function") {
            layer.bringToFront();
        }

        // 5. Dynamic Map Zoom/Center and Cluster Spiderfying
        if (markerClusterGroup && typeof markerClusterGroup.zoomToShowLayer === "function") {
            markerClusterGroup.zoomToShowLayer(layer, function() {
                layer.openPopup();
            });
        } else {
            if (typeof layer.getBounds === "function") {
                map.fitBounds(layer.getBounds(), { maxZoom: 24, padding: [30, 30] });
            } else if (typeof layer.getLatLng === "function") {
                map.setView(layer.getLatLng(), Math.max(map.getZoom(), 22));
                layer.openPopup();
            }
        }
    };

    map.on("click", function(e){
	clearMapHighlights();
	unselect();
    });
    
    const renderData = function(local_cfg, map_cfg) {
		// Clean up existing map elements
		if (currentGeojsonLayer) {
			map.removeLayer(currentGeojsonLayer);
		}
		if (markerClusterGroup) {
			map.removeLayer(markerClusterGroup);
			markerClusterGroup = null;
		}
		idToLayerMap = {};
		activeHighlightedLayer = null;
		originalStyle = null;

		var raw_el = document.querySelector("#raw");
		if (raw_el) {
			raw_el.innerHTML = '';
		}

		// Create a deep copy to process (so we can toggle offsets on/off without permanently modifying features)
		const f = {
			type: "FeatureCollection",
			features: structuredClone(allFeatures)
		};

		var features = f.features;
		var count = features.length;
		
		for (var i=0; i < count; i++){
		    var show_id = "show-" + (i+1);
		    f.features[i]["properties"]["show:id"] = show_id;
		}

		if (overlapHandlingEnabled) {
			// Auto-detect overlapping polylines and assign staggered offsets
			var lineGroups = {};
			var pointGroups = {};
			
			for (var i = 0; i < count; i++) {
				var feat = f.features[i];
				if (feat.geometry) {
					if (feat.geometry.type === 'LineString' || feat.geometry.type === 'MultiLineString') {
						var coordKey = JSON.stringify(feat.geometry.coordinates);
						if (!lineGroups[coordKey]) {
							lineGroups[coordKey] = [];
						}
						lineGroups[coordKey].push(feat);
					} else if (feat.geometry.type === 'Point') {
						var coordKey = JSON.stringify(feat.geometry.coordinates);
						if (!pointGroups[coordKey]) {
							pointGroups[coordKey] = [];
						}
						pointGroups[coordKey].push(feat);
					}
				}
			}

			// Stagger offsets for overlapping line groups (using Leaflet.PolylineOffset spacing)
			var lineSpacing = 6; // pixels spacing between parallel lines
			for (var key in lineGroups) {
				var group = lineGroups[key];
				if (group.length > 1) {
					for (var j = 0; j < group.length; j++) {
						var multiplier = Math.floor((j + 1) / 2);
						var sign = (j % 2 === 0) ? 1 : -1;
						if (j === 0) {
							group[j].properties.offset = 0;
						} else {
							group[j].properties.offset = sign * multiplier * lineSpacing;
						}
					}
				}
			}

			// Symmetrically fan out overlapping points around their shared coordinate
			var pointRadius = 12; // pixel radius offset
			for (var key in pointGroups) {
				var group = pointGroups[key];
				if (group.length > 1) {
					for (var j = 0; j < group.length; j++) {
						var angle = (j * 2 * Math.PI) / group.length;
						group[j].properties.offset_x = Math.round(pointRadius * Math.cos(angle));
						group[j].properties.offset_y = Math.round(pointRadius * Math.sin(angle));
					}
				}
			}
		}

		var format = function(show_id, str){
		    
		    // Remember: wof_format is defined by the /wasm/wof_format.wasm binary.
			// Details below.
			
			wof_format(str).then((rsp) => {
			    append(show_id, rsp);
			}).catch((err) => {
			    console.warn("Unable to format feature", err, str);
			    append(show_id, str);
			});
		};
		
		var append = function(show_id, str) {
		    var pre = document.createElement("pre");
		    pre.setAttribute("id", show_id);
		    pre.appendChild(document.createTextNode(str));		    
		    
		    // Click JSON text to highlight the corresponding map geometry
		    pre.addEventListener("click", function() {
		        highlightMapElement(show_id);
		    });

		    raw_el.appendChild(pre);
		};
		
		if (raw_el){
		    
		    // Remember: Both sfomuseum.wasm.fetch and the WASM binary are imported and registered
		    // in show.go. For details see: https://github.com/whosonfirst/go-whosonfirst-format-wasm
		    
		    sfomuseum.golang.wasm.fetch("/wasm/wof_format.wasm").then(rsp => {
			
			var features = f.features;
			var count = features.length;
			
			for (var i=0; i < count; i++){
			    
			    var show_id = features[i]["properties"]["show:id"];
			    var this_f = structuredClone(features[i]);
			    
			    delete(this_f["properties"]["show:id"]);
			    var str_f = JSON.stringify(this_f);
			    
			    format(show_id, str_f);
			}
			
		    }).catch((err) => {
			console.warn("Unable to load wof_format.wasm", err);
			var str_f = JSON.stringify(f, "", " ");		    
			append(0, str_f);
		    });
		    
		}

		var geojson_args = {
		    
		    onEachFeature: function (feature, layer) {
			var show_id = feature["properties"]["show:id"];
			idToLayerMap[show_id] = layer;

			layer.on("click", function(e){			    
			    clearMapHighlights();
			    select(show_id);
			});

			if (map_cfg.leaflet) {
			    
			    var label_props = map_cfg.leaflet.label_properties;
			    
			    if (label_props){
				var count_props = label_props.length;
				
				if (count_props > 0) {
				    
				    var label_text = [];
				    
				    for (var i=0; i < count_props; i++){
					
					var prop = label_props[i];
					var value = feature.properties[ prop ];
					
					label_text.push("<strong>" + prop + "</strong> " + value);
				    }
				    
				    if (label_text.length > 0){ 
					layer.bindPopup(label_text.join("<br />"));
				    }

				    const first = label_props[0];
				    
				    if ((first in feature.properties) && (feature.properties[first] != "")){
					layer.bindTooltip(feature.properties[first]).openTooltip();
				    }
				}
				
			    }
			    
			}			
		    }
		};

		// Always define geojson style to support dynamic feature color overrides natively
		geojson_args.style = function(feature) {
			const base_style = (map_cfg.leaflet && map_cfg.leaflet.style) ? 
				structuredClone(map_cfg.leaflet.style) : 
				{ "weight": 3, "opacity": 0.8 };
			return applyCustomStyles(feature, base_style);
		};

		// Always define pointToLayer to support dynamic vector circle colors for points
		geojson_args.pointToLayer = function (feature, latlng) {
			const base_style = (map_cfg.leaflet && map_cfg.leaflet.point_style) ? 
				structuredClone(map_cfg.leaflet.point_style) : 
				{ "radius": 8, "weight": 1, "opacity": 1, "fillOpacity": 0.8 };
				
			const final_style = applyCustomStyles(feature, base_style);
			
			// Detect custom offsets for points (pixel translations)
			let offsetX = 0;
			let offsetY = 0;
			if (feature.properties) {
				if (feature.properties.offset_x !== undefined) {
					offsetX = Number(feature.properties.offset_x);
				}
				if (feature.properties.offset_y !== undefined) {
					offsetY = Number(feature.properties.offset_y);
				}
				// Simple fallback if only 'offset' is defined (offset horizontally)
				if (feature.properties.offset !== undefined && offsetX === 0 && offsetY === 0) {
					offsetX = Number(feature.properties.offset);
				}
			}

			// If color/styles are overridden, render as circular points
			if ((feature.properties && feature.properties.color) || (map_cfg.leaflet && map_cfg.leaflet.point_style)) {
				// Dynamic offset rendering using L.divIcon & standard CSS
				if (offsetX !== 0 || offsetY !== 0) {
					const size = (final_style.radius || 8) * 2;
					const color = final_style.fillColor || final_style.color || "blue";
					const border_color = final_style.color || "#ffffff";
					const border_weight = final_style.weight || 1;
					const op = final_style.fillOpacity || 0.8;

					const divIcon = L.divIcon({
						className: 'custom-offset-circle',
						iconSize: [size, size],
						iconAnchor: [(size / 2) - offsetX, (size / 2) - offsetY],
						popupAnchor: [offsetX, - (size / 2) + offsetY],
						html: `<div style="
							width: ${size}px; 
							height: ${size}px; 
							background-color: ${color}; 
							border: ${border_weight}px solid ${border_color}; 
							border-radius: 50%; 
							opacity: ${op};">
						</div>`
					});
					return L.marker(latlng, { icon: divIcon });
				}
				return L.circleMarker(latlng, final_style);
			}

			// For standard markers, apply offset if defined
			if (offsetX !== 0 || offsetY !== 0) {
				const defaultIcon = new L.Icon.Default();
				const shiftedIcon = L.icon({
					iconUrl: defaultIcon.options.iconUrl,
					iconRetinaUrl: defaultIcon.options.iconRetinaUrl,
					shadowUrl: defaultIcon.options.shadowUrl,
					iconSize: defaultIcon.options.iconSize,
					iconAnchor: [
						defaultIcon.options.iconAnchor[0] - offsetX,
						defaultIcon.options.iconAnchor[1] - offsetY
					],
					popupAnchor: [
						defaultIcon.options.popupAnchor[0] - offsetX,
						defaultIcon.options.popupAnchor[1] - offsetY
					],
					shadowSize: defaultIcon.options.shadowSize,
					shadowAnchor: defaultIcon.options.shadowAnchor ? [
						defaultIcon.options.shadowAnchor[0] - offsetX,
						defaultIcon.options.shadowAnchor[1] - offsetY
					] : undefined
				});
				return L.marker(latlng, { icon: shiftedIcon });
			}

			return L.marker(latlng);
		};

		var geojson_layer = L.geoJSON(f, geojson_args);
		currentGeojsonLayer = geojson_layer;

		if (local_cfg.cluster_markers){
		    const markers = L.markerClusterGroup();
		    markers.addLayer(geojson_layer);
		    markers.addTo(map);
		    markerClusterGroup = markers;
		} else {
		    geojson_layer.addTo(map);
		}
		
		if (count > 0) {
			var bounds = whosonfirst.spelunker.geojson.derive_bounds(f);
			
			var sw = bounds[0];
			var ne = bounds[1];
			
			if ((sw[0] == ne[0]) && (sw[1] == ne[1])){
				map.setView(sw, local_cfg.max_zoom || 19);
			} else {
				map.fitBounds(bounds);
			}
		}
    };

    const init = function(local_cfg, map_cfg) {
		local_cfg_global = local_cfg;
		map_cfg_global = map_cfg;
		mapInitialized = true;

		fetch("/features.geojson")
			.then((rsp) => rsp.json())
			.then((f) => {
				initialFeatures = structuredClone(f.features || []);
				allFeatures = structuredClone(initialFeatures);
				renderData(local_cfg, map_cfg);
			}).catch((err) => {
				console.error("Failed to fetch features", err);
			});
	};

    fetch("/config.json").then(rsp =>
	rsp.json()
    ).then((local_cfg) => {
	
	fetch("/map.json")
	    .then((rsp) => rsp.json())
	    .then((map_cfg) => {
		
		switch (map_cfg.provider) {
		    case "leaflet":
			
			var tile_url = map_cfg.tile_url;
			
			var tile_layer = L.tileLayer(tile_url, {
			    maxZoom: local_cfg.max_zoom || 19,
			    maxNativeZoom: 19,
			});
			
			tile_layer.addTo(map);
			break;

		    case "esri":

			if ("esri_feature_layers" in local_cfg){
			    
			    const layers = local_cfg.esri_feature_layers;
			    const count_layers = layers.length;
			    
			    for (var i=0; i < count_layers; i++){
				
				var tile_uri = layers[i];
				
				var tile_style = {
				    color: '#000',
				    weight: 1,
				    opacity: 1,
				    fillColor: '#fff',
				    fillOpacity: 0,
				};
				
				const tile_u = new URL(tile_uri);
				const tile_q = tile_u.searchParams;
				
				for (k in tile_style){
				    
				    var q_key = "_" + k;
				    
				    if (tile_q.has(q_key)){
					tile_style[k] = tile_q.get(q_key);
					tile_q.delete(q_key);
				    }
				}
				
				tile_u.searchParams = tile_q;
				tile_uri = tile_u.toString();
				
				var tile_args = {
				    url: tile_uri,
				    style: tile_style,
				    /*
				       pointToLayer: function(feature, latlng) {
				       return L.circleMarker(latlng, {
				       radius: 8,
				       fillColor: "#ff0000",
				       color: "#fff",
				       weight: 1,
				       opacity: 1,
				       fillOpacity: 0.1
				       });
				       }
				     */
				};
				
				var tile_layer = L.esri.featureLayer(tile_args);
				tile_layer.addTo(map);
			    }
			}
			
			break;
			
		    case "protomaps":		    
			
			var tile_url = map_cfg.tile_url;		

			var pm_args = {
			    url: tile_url,
			    theme: map_cfg.protomaps.theme,
			    flavor: map_cfg.protomaps.theme,
			};
			
			if ("max_data_zoom" in map_cfg.protomaps){
			    pm_args.maxDataZoom = map_cfg.protomaps.max_data_zoom;
			}

			var tile_layer = protomapsL.leafletLayer(pm_args);
			
			tile_layer.addTo(map);
			break;
			
		    default:
			console.error("Uknown or unsupported map provider");
			return;
		}
		
		if (("leaflet" in map_cfg) && ("panes" in map_cfg.leaflet)){
		    
		    for (label in map_cfg.leaflet.panes){
			const p = map.createPane(label);
			p.style.zIndex = map_cfg.leaflet.panes.label;
			console.debug("Created pane", label, map_cfg.leaflet.panes.label);
		    }
		}

		map.setMaxZoom(local_cfg.max_zoom || 19);
		init(local_cfg, map_cfg);
		
	    }).catch((err) => {
		console.error("Failed to retrieve map config", err);
	    });
	
    }).catch((err) => {
	console.error("Failed to retrieve local cfg", err);
    });
    
    // Toggle Overlap Engine On/Off
    const toggleEl = document.getElementById("toggle-overlap");
    if (toggleEl) {
        toggleEl.addEventListener("change", function(e) {
            overlapHandlingEnabled = e.target.checked;
            if (allFeatures.length > 0 && mapInitialized) {
                renderData(local_cfg_global, map_cfg_global); // Trigger a full re-render
            }
        });
    }

    // Parse Pasted GeoJSON
    const btnEl = document.getElementById("add-geojson");
    if (btnEl) {
        btnEl.addEventListener("click", function() {
            const idInput = document.getElementById("feature-id").value.trim();
            const nameInput = document.getElementById("feature-name").value.trim();
            const colorInput = document.getElementById("feature-color").value.trim();
            const textArea = document.getElementById("paste-geojson");

            if (!idInput) {
                alert("Please provide an ID for the new feature.");
                return;
            }

            if (!textArea.value.trim()) return;
            try {
                const pasted = JSON.parse(textArea.value);
                
                let featsToAdd = [];
                if (pasted.type === "FeatureCollection") {
                    featsToAdd = pasted.features;
                } else if (pasted.type === "Feature") {
                    featsToAdd = [pasted];
                } else {
                    alert("Invalid GeoJSON: Must be a Feature or FeatureCollection."); return;
                }

                featsToAdd.forEach(f => {
                    f.properties = f.properties || {};
                    f.properties.id = idInput;
                    if (nameInput) f.properties.name = nameInput;
                    if (colorInput) f.properties.color = colorInput;
                });

                allFeatures = allFeatures.concat(featsToAdd);
                textArea.value = ""; // Clear input
                if (mapInitialized) renderData(local_cfg_global, map_cfg_global); // Trigger re-render
            } catch (e) {
                alert("Invalid JSON data pasted.");
            }
        });
    }

    // Delete Pasted GeoJSON by ID
    const delEl = document.getElementById("delete-geojson");
    if (delEl) {
        delEl.addEventListener("click", function() {
            const idInput = document.getElementById("feature-id").value.trim();
            if (!idInput) {
                alert("Please provide an ID to delete.");
                return;
            }
            
            const beforeCount = allFeatures.length;
            // Remove features that have the matching ID
            allFeatures = allFeatures.filter(f => {
                if (f.properties && f.properties.id !== undefined) {
                    return String(f.properties.id) !== idInput;
                }
                return true;
            });
            
            if (allFeatures.length < beforeCount) {
                if (mapInitialized) renderData(local_cfg_global, map_cfg_global);
            } else {
                alert("No feature found with ID: " + idInput);
            }
        });
    }
});
