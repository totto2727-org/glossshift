# GlossShift icon assets

The original artwork uses offset language cards, hand-drawn `A` and `文` glyphs, and reversible shift arrows on a blue-to-teal macOS tile.
No fonts, downloaded artwork, or runtime rendering dependencies are required.

## Reproduction

Run these commands from the repository root on macOS with the Swift developer tools installed:

```bash
just generate-icons
just package-app
```

`just generate-icons` runs `scripts/generateIcons.swift` using AppKit/Core Graphics and the system `iconutil`.
The Swift file is the canonical vector geometry and palette source, and it also exports editable SVG artwork.
All generated assets live in `app/desktop/packaging/` and are checked in so ordinary application builds do not regenerate icons.
The separate Accessibility helper has its own Swift build.
Generation is byte-for-byte repeatable on the same macOS toolchain, although Apple renderer or PNG encoder changes may change binary output across OS versions.
Intermediate iconset PNGs are written under the ignored `target/GlossShift.iconset` directory.

## Files and integration

- `GlossShift.icns` contains all ten standard macOS iconset representations, from 16×16 through 512×512@2x (1024×1024 pixels).
- `app-icon.svg` and `app-icon.png` provide the original vector artwork and a 1024×1024 raster preview.
- `tray-icon.svg` and `tray-icon.png` provide the simplified monochrome small-size artwork and a 32×32 raster preview.
- `tray-icon.rgba` is exactly 4096 bytes: 32×32 pixels in top-to-bottom row-major RGBA8 order with no header or row padding.

Every tray RGB component is black, including transparent pixels, and its alpha channel contains transparent, opaque, and antialiased edge pixels.
The black-only pixels make premultiplied and straight RGBA representations equivalent.
The raw RGBA asset remains an artwork export, but the desktop does not embed it as a native pixel buffer.
`app/desktop/src/desktopControls.ts` imports `tray-icon.svg` and installs it through NSH's standard `Tray` API.
The tray silhouette is deliberately simpler than the application icon for legibility in the menu bar.

`app/desktop/nsh.json` selects `packaging/app-icon.png`, relative to the desktop package, for official NSH packaging through `vp run package` or its `just package-app` alias.
The Nix desktop package additionally copies `app/desktop/packaging/GlossShift.icns` to `GlossShift.app/Contents/Resources/GlossShift.icns` and sets `CFBundleIconFile` before ad-hoc signing.
`app/desktop/packaging/Info.plist` retains the icon metadata.
