## 0.1.2 - 2026-10-24

- Detect and reject animated PNG (APNG) files before browser decoding so an animated image is not silently reduced to one frame.

## 0.1.1 - 2026-10-13

- Keep same-named images from different folders as separate queue items.
- Lock queue and format controls while processing and while results are ready, preventing stale download links and queue races.
- Make the image picker keyboard-accessible with a visible focus indicator.

# Changelog

## 0.1.0 - 2026-10-11

- Initial release: re-encode JPEG and PNG images in-browser to omit embedded metadata from downloaded copies.
- Process a bounded batch locally, preserve source files, and limit decoded pixel counts.
