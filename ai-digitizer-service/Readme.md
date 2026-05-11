# AI digitizer service

Prototype service for AI-assisted digitizing in the GIS education platform.

The API is intentionally model-agnostic: the frontend/backend can keep calling the
same endpoint while the implementation changes from this classical CV prototype
to SAM, SamGeo, or a university-trained segmentation model.

## Endpoints

- `GET /health`
- `POST /segment-box`

`POST /segment-box` accepts:

```json
{
  "image_data": "base64 image or data URL",
  "bbox_pixels": [10, 10, 120, 120],
  "image_extent": [minx, miny, maxx, maxy],
  "target_geometry_type": "polygon"
}
```

The response contains a suggested GeoJSON geometry:

```json
{
  "status": "passed",
  "geometry": {
    "type": "Polygon",
    "coordinates": []
  },
  "confidence": 0.6,
  "message": "Prototype contour generated. Review and edit it before submitting.",
  "meta": {
    "backend": "classical-cv"
  }
}
```

## Current implementation

This first version uses OpenCV GrabCut inside the selected bbox. If no reliable
contour is found, it returns the bbox as a polygon. That is useful for wiring the
workflow end to end before adding a heavier model.

## Next model upgrade

Recommended path:

1. Keep this HTTP contract.
2. Add a model backend setting: `classical-cv`, `sam2`, `mobilesam`, `custom`.
3. Implement SAM/SamGeo inference behind `/segment-box`.
4. Later replace or supplement it with a trained building/road segmentation
   model without changing the main backend or frontend API.
