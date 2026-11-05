# CleanMetaTags

**Clean images before you share them.** CleanMetaTags removes common image metadata and recognized AI/provenance tags directly in your browser. No upload, account, dependency, or build step is required.

Open [`index.html`](index.html), choose or drop images, and download the cleaned results individually or together as a ZIP.

## Why CleanMetaTags?

- **Private by design:** Processing happens on your device. The page does not upload your images or call a cleaning API.
- **AI-tag removal is not optional:** Recognized C2PA/Content Credentials and XMP-based provenance metadata are stripped by default, with no toggle to keep them. This also removes authenticity credentials from non-AI images.
- **More than EXIF:** Targets GPS, timestamps, camera and author fields, embedded thumbnails, comments, IPTC/XMP, color profiles, PNG text and ancillary metadata, and the container-specific provenance carriers — C2PA in JPEG, PNG, WebP, GIF, TIFF/DNG (tag `0xCD41`), AVIF/HEIC (the BMFF `uuid` box) and JPEG XL (the `jumb` box).
- **No needless re-encoding, in any supported format:** JPEG, PNG, WebP, GIF, TIFF/DNG, AVIF, HEIC/HEIF, JPEG XL and BMP are all cleaned by rewriting or removing metadata structures while the compressed image data is copied byte for byte. An orientation tag may be retained where needed to display a photo upright.
- **Checks the result:** Re-scans cleaned files for recognized leftover metadata and blocks downloads when that check fails. PNG chunk checksums are validated before cleaning.
- **Easy batch export:** Up to 25 images, 50 MiB per file and 200 MiB per queue; download individually or as a ZIP. Exported files use generic names instead of potentially revealing original filenames.
- **The list is transient:** A file leaves the queue the moment it is downloaded successfully — its row animates out, its blob URL is revoked and its decoded bytes are released. **Download all as ZIP** clears every file it saved the same way, and **Clear all** does it on demand. Nothing you have already saved stays on the page.

## Use it

1. Download or clone this repository.
2. Open **`index.html`** in a modern browser. It also works when served as a static site.
3. Drop images anywhere on the page, use **Choose images**, or paste an image from your clipboard.
4. Download each cleaned image or use **Download all as ZIP** for two or more results. Saved files drop off the list automatically.

Motion is intentionally light — staggered row entrances, a one-shot acknowledgement when a file verifies clean, and soft hover feedback — and all of it is disabled under `prefers-reduced-motion`.

There is no installation or server-side component. To publish with **GitHub Pages**, place `index.html` at the repository root and enable Pages for your chosen branch/root folder.

## Social sharing

`index.html` includes Open Graph and Twitter/X preview metadata pointing to the [public 1200 × 630 banner](https://i.ibb.co.com/HfysPW1L/og-banner.png). A local copy is included as [`og-banner.png`](og-banner.png). The banner is metadata for social crawlers; it is **not** used to process images.

Share your **deployed site's URL** (for example, your GitHub Pages URL) to show this preview. Sharing the GitHub **repository page** uses GitHub's own preview metadata, not the tags in `index.html`. If you move the banner to another host, update the `og:image` and `twitter:image` URLs in the page's `<head>`.

## Format support

| Input | Cleaning approach | Notes |
| --- | --- | --- |
| JPEG / JPG | Marker-level removal and selective EXIF rebuilding | Includes APP11/JUMBF C2PA, XMP, IPTC, comments, thumbnails, ICC and trailing data; compressed scan data is copied. |
| PNG | Chunk-level removal | Includes `caBX` C2PA, `eXIf`, text/XMP, time, ICC and other nonessential ancillary chunks; checks chunk CRCs. |
| WebP | RIFF chunk-level removal | Includes `C2PA`/`JUMB`, EXIF, XMP, ICC and unrecognized auxiliary chunks; rewrites RIFF size. |
| GIF | Extension-level removal | Removes comments and non-looping application extensions while retaining image frames and animation looping. |
| TIFF / TIF / DNG | In-place directory editing | Removes Exif/GPS/Interop sub-trees, XMP, IPTC-NAA, C2PA (`0xCD41`), Photoshop IRB, PrintIM, XP* strings and optionally ICC. Strip and tile data never move, so no offset is patched; a metadata-only or thumbnail directory is dropped whole, and multi-page files keep every page. BigTIFF is refused by name. |
| AVIF / HEIC / HEIF | Item-table rewrite | Removes the Exif and XMP items, C2PA `uuid` boxes and their payload bytes. The encoded image item is untouched and the container length is unchanged. |
| JPEG XL | Box removal | Removes `Exif`, `xml ` (XMP) and `jumb` (C2PA) boxes, including Brotli-wrapped (`brob`) ones, and keeps the codestream byte-identical. |
| BMP | V5 header profile removal | A bitmap's only metadata carrier is its embedded ICC profile, which is removed with both offsets corrected. No EXIF/XMP/C2PA exist in BMP. |
| SVG | XML sanitization | Removes metadata, comments, editor namespaces, scripts, external content and unsafe elements; visual output can change. |
| Other browser-decodable images | Decode and export as PNG | Last resort only. Re-encoding can change appearance and may not preserve multiple frames or pages. |

A JPEG XL *codestream* with no surrounding container, and BigTIFF, cannot be edited safely. Those are refused with an explanation instead of being re-encoded.

## Important limitations

CleanMetaTags removes **recognized file metadata**, not information visibly embedded in pixels, steganographic content, every proprietary tag, or any external record of an image's history. Removing C2PA credentials does **not** establish whether an image is or is not AI-generated. For sensitive images, review the exported file before sharing it.

Color profiles are removed for stronger metadata minimization, so colors may look different in some viewers. Every supported format is cleaned losslessly; only formats that reach the final decode-and-export fallback are re-encoded, and then pixel-identical output is not guaranteed. GIF plain-text graphic blocks and JPEG Adobe color-transform information may be preserved where needed for rendering.

The GitHub link in the footer is a voluntary external link; **image processing itself makes no network requests**.

## Tests

The byte-engine test suite covers EXIF rebuilding, JPEG inter-scan and trailing metadata, PNG integrity and metadata chunks, WebP RIFF/C2PA handling, GIF comments, TIFF/DNG directory editing (both byte orders, compressed variants, multi-page, thumbnail and metadata-only directories, BigTIFF refusal), AVIF/HEIC item-table rewrites, JPEG XL box removal, BMP profile removal, mandatory AI-tag removal, output checks, and ZIP creation. It has **no dependencies**:

```bash
node tests/engine.test.cjs
```

An optional UI suite covers the render layer and the transient queue — that a successful download removes exactly that file, that ZIP and **Clear all** release their blob URLs, that export ordinals stay stable so removals cannot cause filename collisions, and that the animation layer is fully covered by `prefers-reduced-motion`. It needs [jsdom](https://github.com/jsdom/jsdom) and skips itself cleanly when jsdom is absent, so the engine suite remains the zero-dependency default:

```bash
npm install --no-save jsdom
node tests/ui.test.cjs
```

Node.js is only needed to run the tests—not to use or host the tool. The application itself loads no dependencies at runtime.

## Project files

```text
index.html             Self-contained application (HTML, CSS and JavaScript)
og-banner.png          Social preview banner (local copy)
tests/engine.test.cjs  Engine regression tests (no dependencies)
tests/ui.test.cjs      Optional UI regression tests (needs jsdom)
README.md              Project documentation
```

## Credit

© [Abdullah Al Noman Neion](https://github.com/aanneion) — 2026
