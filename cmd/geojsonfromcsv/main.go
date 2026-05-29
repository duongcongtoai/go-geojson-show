package main

import (
	"bufio"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
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
	cleaned = strings.Trim(cleaned, `"'“”‘’`)
	// Strip \x, 0x, or 0X prefixes
	if len(cleaned) >= 2 {
		prefix := cleaned[:2]
		if prefix == "\\x" || prefix == "0x" || prefix == "0X" {
			cleaned = cleaned[2:]
		}
	}
	return cleaned
}

// cleanHeader strips spaces, quotes, and case-sensitivity from header cells
func cleanHeader(h string) string {
	cleaned := strings.TrimSpace(h)
	// Strip UTF-8 BOM if present
	cleaned = strings.TrimPrefix(cleaned, "\xef\xbb\xbf")
	cleaned = strings.TrimPrefix(cleaned, "\ufeff")
	cleaned = strings.Trim(cleaned, `"'“”‘’`) // Strip standard and curly quotes
	return strings.ToLower(cleaned)
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
	var input io.Reader = os.Stdin
	var filename = "STDIN"

	if len(os.Args) > 1 && os.Args[1] != "-" {
		file, err := os.Open(os.Args[1])
		if err != nil {
			log.Fatalf("Failed to open file %s: %v", os.Args[1], err)
		}
		defer file.Close()
		input = file
		filename = os.Args[1]
	}

	bufReader := bufio.NewReader(input)
	var customComma rune = ','

	// Peek the first ~256 bytes to check for "sep=" or "separator=" directive, or auto-detect comma/semicolon/tab
	headBytes, _ := bufReader.Peek(256)
	headStr := string(headBytes)
	if strings.HasPrefix(headStr, "sep=") || strings.HasPrefix(headStr, "separator=") {
		// Read the full sep line
		line, err := bufReader.ReadString('\n')
		if err == nil {
			parts := strings.Split(strings.TrimSpace(line), "=")
			if len(parts) == 2 && len(parts[1]) > 0 {
				sepVal := parts[1]
				if sepVal == "\\t" {
					customComma = '\t'
				} else {
					customComma = rune(sepVal[0])
				}
			}
		}
	} else {
		// Auto-detect based on first line character frequencies
		firstLine := headStr
		if idx := strings.Index(headStr, "\n"); idx != -1 {
			firstLine = headStr[:idx]
		}
		
		semis := strings.Count(firstLine, ";")
		commas := strings.Count(firstLine, ",")
		tabs := strings.Count(firstLine, "\t")
		
		if semis > commas && semis > tabs {
			customComma = ';'
		} else if tabs > commas && tabs > semis {
			customComma = '\t'
		}
	}

	reader := csv.NewReader(bufReader)
	reader.Comma = customComma
	reader.TrimLeadingSpace = true
	reader.LazyQuotes = true

	// Read all rows
	rows, err := reader.ReadAll()
	if err != nil {
		log.Fatalf("Failed to read CSV from %s: %v", filename, err)
	}

	// Filter out empty rows (often present at the end of files)
	var activeRows [][]string
	for _, r := range rows {
		hasContent := false
		for _, cell := range r {
			if strings.TrimSpace(cell) != "" {
				hasContent = true
				break
			}
		}
		if hasContent {
			activeRows = append(activeRows, r)
		}
	}

	if len(activeRows) == 0 {
		log.Fatalf("CSV input from %s is empty", filename)
	}

	startIndex := 0
	geomCol := -1
	nameCol := -1
	colorCol := -1

	// Auto-detect header column positions using cleaned strings
	firstRow := activeRows[0]
	for idx, col := range firstRow {
		cleaned := cleanHeader(col)
		if cleaned == "geometry" || cleaned == "geom" || cleaned == "wkb" {
			geomCol = idx
		} else if cleaned == "name" || cleaned == "label" {
			nameCol = idx
		} else if cleaned == "color" || cleaned == "style" {
			colorCol = idx
		}
	}

	// If no headers are found, default to positional columns (0: Geometry, 1: Name, 2: Color)
	if geomCol == -1 {
		geomCol = 0
		if len(firstRow) > 1 {
			nameCol = 1
		}
		if len(firstRow) > 2 {
			colorCol = 2
		}
	} else {
		startIndex = 1 // Skip header row
	}

	fc := struct {
		Type     string             `json:"type"`
		Features []*geojson.Feature `json:"features"`
	}{
		Type:     "FeatureCollection",
		Features: make([]*geojson.Feature, 0),
	}

	featureCount := 0
	for rowIdx, row := range activeRows[startIndex:] {
		// Ensure geomCol index exists in current row
		if len(row) <= geomCol {
			log.Printf("Warning: Skipping row %d in %s due to missing geometry column", rowIdx+startIndex+1, filename)
			continue
		}

		rawHex := row[geomCol]
		hexStr := cleanHex(rawHex)
		if len(hexStr) == 0 {
			continue
		}

		wkbBytes, err := hex.DecodeString(hexStr)
		if err != nil {
			log.Printf("Warning: Row %d: Failed to decode hex string: %v", rowIdx+startIndex+1, err)
			continue
		}

		geomVal, err := parseGeometry(wkbBytes)
		if err != nil {
			log.Printf("Warning: Row %d: %v", rowIdx+startIndex+1, err)
			continue
		}

		nameVal := fmt.Sprintf("Geometry %d", featureCount+1)
		if nameCol != -1 && len(row) > nameCol {
			nameVal = strings.Trim(row[nameCol], `"'“”‘’`)
		}

		colorVal := ""
		if colorCol != -1 && len(row) > colorCol {
			colorVal = strings.Trim(row[colorCol], `"'“”‘’`)
		}

		properties := map[string]interface{}{
			"id":            featureCount + 1,
			"name":          nameVal,
			"color":         colorVal,
			"geometry_hex":  hexStr,
			"geometry_type": fmt.Sprintf("%T", geomVal),
		}

		// Preserve other metadata columns in CSV rows if they exist
		if startIndex == 1 { // Only if headers are present
			for idx, colVal := range row {
				if idx != geomCol && idx != nameCol && idx != colorCol {
					headerName := cleanHeader(firstRow[idx])
					if headerName != "" {
						properties[headerName] = strings.Trim(colVal, `"'“”‘’`)
					}
				}
			}
		}

		feature := geojson.Feature{
			ID:         fmt.Sprintf("%d", featureCount+1),
			Geometry:   geomVal,
			Properties: properties,
		}
		fc.Features = append(fc.Features, &feature)
		featureCount++
	}

	if len(fc.Features) == 0 {
		fmt.Fprintln(os.Stderr, "Error: No valid geometries could be parsed from the CSV input.")
		os.Exit(1)
	}

	geoJSONBytes, err := json.MarshalIndent(fc, "", "  ")
	if err != nil {
		log.Fatalf("Failed to marshal FeatureCollection to JSON: %v", err)
	}

	fmt.Println(string(geoJSONBytes))
}
