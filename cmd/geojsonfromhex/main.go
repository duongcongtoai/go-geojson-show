package main

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/twpayne/go-geom"
	"github.com/twpayne/go-geom/encoding/ewkb"
	"github.com/twpayne/go-geom/encoding/geojson"
	"github.com/twpayne/go-geom/encoding/wkb"
)

// cleanHex normalizes the hex string by stripping quotes, whitespace, and common db prefixes
func cleanHex(hexStr string) string {
	cleaned := strings.TrimSpace(hexStr)
	// Strip surrounding quotes
	if len(cleaned) >= 2 {
		if (cleaned[0] == '\'' && cleaned[len(cleaned)-1] == '\'') ||
			(cleaned[0] == '"' && cleaned[len(cleaned)-1] == '"') {
			cleaned = cleaned[1 : len(cleaned)-1]
		}
	}
	// Strip \x, 0x, or 0X prefixes
	if len(cleaned) >= 2 {
		prefix := cleaned[:2]
		if prefix == "\\x" || prefix == "0x" || prefix == "0X" {
			cleaned = cleaned[2:]
		}
	}
	return cleaned
}

// parseGeometry attempts to unmarshal the bytes first as EWKB, falling back to standard WKB
func parseGeometry(wkbBytes []byte) (geom.T, error) {
	if g, err := ewkb.Unmarshal(wkbBytes); err == nil {
		return g, nil
	}
	if g, err := wkb.Unmarshal(wkbBytes); err == nil {
		return g, nil
	}
	return nil, fmt.Errorf("unsupported or invalid geometry format (neither EWKB nor WKB)")
}

func main() {
	if len(os.Args) < 2 {
		log.Fatalf("Usage: %s <wkb_hex_string_1> [wkb_hex_string_2 ...]", os.Args[0])
	}

	fc := struct {
		Type     string             `json:"type"`
		Features []*geojson.Feature `json:"features"`
	}{
		Type:     "FeatureCollection",
		Features: make([]*geojson.Feature, 0),
	}

	// Process each hex string argument
	for i, rawHexStr := range os.Args[1:] {
		hexStr := cleanHex(rawHexStr)
		if len(hexStr) == 0 {
			continue
		}

		wkbBytes, err := hex.DecodeString(hexStr)
		if err != nil {
			log.Printf("Error processing argument %d: Failed to decode hex string: %v", i+1, err)
			continue
		}

		geom, err := parseGeometry(wkbBytes)
		if err != nil {
			log.Printf("Error processing argument %d: %v", i+1, err)
			continue
		}

		// Inject properties to satisfy geojson-show requirements and populate sidebar
		properties := map[string]interface{}{
			"id":            i + 1,
			"name":          fmt.Sprintf("Geometry %d", i+1),
			"geometry_hex":  hexStr,
			"geometry_type": fmt.Sprintf("%T", geom),
		}

		feature := geojson.Feature{
			ID:         fmt.Sprintf("%d", i+1),
			Geometry:   geom,
			Properties: properties,
		}
		fc.Features = append(fc.Features, &feature)
	}

	// Fail fast to prevent silent browser crashes
	if len(fc.Features) == 0 {
		fmt.Fprintln(os.Stderr, "Error: No valid geometries could be parsed from the provided hex string(s).")
		os.Exit(1)
	}

	geoJSONBytes, err := json.MarshalIndent(fc, "", "  ")
	if err != nil {
		log.Fatalf("Failed to marshal FeatureCollection to JSON: %v", err)
	}

	fmt.Println(string(geoJSONBytes))
}
