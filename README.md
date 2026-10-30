# CleanMetaTags

**Clean images before you share them.** CleanMetaTags removes common image metadata and recognized AI/provenance tags directly in your browser. No upload, account, dependency, or build step is required.

Open [`index.html`](index.html), choose or drop images, and download the cleaned results individually or together as a ZIP.

## Why CleanMetaTags?

- **Private by design:** Processing happens on your device. The page does not upload your images or call a cleaning API.
- **AI-tag removal is not optional:** Recognized C2PA/Content Credentials and XMP-based provenance metadata are stripped by default, with no toggle to keep them. This also removes authenticity credentials from non-AI images.
- **More than EXIF:** Targets GPS, timestamps, camera and author fields, embedded thumbnails, comments, IPTC/XMP, color profiles, PNG text and ancillary metadata, and common container-specific provenance carriers.
- **No needless re-encoding for core formats:** JPEG, PNG, WebP, and GIF cleaning preserves their compressed image data while rewriting/removing metadata structures. An orientation tag may be retained where needed to display a photo upright.
- **Checks the result:** Re-scans cleaned files for recognized leftover metadata and blocks downloads when that check fails. PNG chunk checksums are validated before cleaning.
- **Easy batch export:** Up to 25 images, 50 MiB per file and 200 MiB per queue; download individually or as a ZIP. Exported files use generic names instead of potentially revealing original filenames.

## Use it

1. Download or clone this repository.
2. Open **`index.html`** in a modern browser. It also works when served as a static site.
3. Drop images onto the page, use **Choose images**, or paste an image from your clipboard.
4. Download each cleaned image or use **Download all as ZIP** for two or more results.

There is no installation or server-side component. To publish with **GitHub Pages**, place `index.html` at the repository root and enable Pages for your chosen branch/root folder.

## Format support

| Input | Cleaning approach | Notes |
| --- | --- | --- |
| JPEG / JPG | Marker-level removal and selective EXIF rebuilding | Includes APP11/JUMBF C2PA, XMP, IPTC, comments, thumbnails, ICC and trailing data; compressed scan data is copied. |
| PNG | Chunk-level removal | Includes `caBX` C2PA, `eXIf`, text/XMP, time, ICC and other nonessential ancillary chunks; checks chunk CRCs. |
| WebP | RIFF chunk-level removal | Includes `C2PA`/`JUMB`, EXIF, XMP, ICC and unrecognized auxiliary chunks; rewrites RIFF size. |
| GIF | Extension-level removal | Removes comments and non-looping application extensions while retaining image frames and animation looping. |
| SVG | XML sanitization | Removes metadata, comments, editor namespaces, scripts, external content and unsafe elements; visual output can change. |
| Other browser-decodable images (for example BMP, TIFF, AVIF or HEIC) | Decode and export as PNG | Availability depends on browser support. Re-encoding can change appearance and may not preserve multiple frames or pages. |

## Important limitations

CleanMetaTags removes **recognized file metadata**, not information visibly embedded in pixels, steganographic content, every proprietary tag, or any external record of an image's history. Removing C2PA credentials does **not** establish whether an image is or is not AI-generated. For sensitive images, review the exported file before sharing it.

Color profiles are removed for stronger metadata minimization, so colors may look different in some viewers. For browser-re-encoded formats, byte- or pixel-identical output is not guaranteed. GIF plain-text graphic blocks and JPEG Adobe color-transform information may be preserved where needed for rendering.

The GitHub link in the footer is a voluntary external link; **image processing itself makes no network requests**.

## Tests

The byte-engine test suite covers EXIF rebuilding, JPEG inter-scan and trailing metadata, PNG integrity and metadata chunks, WebP RIFF/C2PA handling, GIF comments, mandatory AI-tag removal, output checks, and ZIP creation.

```bash
node tests/engine.test.cjs
```

Node.js is only needed to run the tests—not to use or host the tool.

## Project files

```text
index.html             Self-contained application (HTML, CSS and JavaScript)
tests/engine.test.cjs  Engine regression tests
README.md              Project documentation
```

## Credit

© [Abdullah Al Noman Neion](https://github.com/aanneion) — 2026

If you want others to reuse or modify the code, add a `LICENSE` file with the terms you choose; none is included by default.
