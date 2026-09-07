# GlossShift icon assets

The original artwork uses offset language cards, hand-drawn `A` and `文` glyphs, and reversible shift arrows on a blue-to-teal macOS tile.
No fonts, downloaded artwork, or runtime rendering dependencies are required.

## Reproduction

Run these commands from the repository root on macOS with the Swift developer tools installed:

```bash
just generate-icons
just check-icons
just package-app
```

`just generate-icons` runs `scripts/generate-icons.swift` using AppKit/Core Graphics and the system `iconutil`.
The Swift file is the canonical vector geometry and palette source, and it also exports editable SVG artwork.
All generated assets are checked in so ordinary Cargo and Nix builds do not need Swift or regenerate icons.
Generation is byte-for-byte repeatable on the same macOS toolchain, although Apple renderer or PNG encoder changes may change binary output across OS versions.
Intermediate iconset PNGs are written under the ignored `target/GlossShift.iconset` directory.

## Files and integration

- `GlossShift.icns` contains all ten standard macOS iconset representations, from 16×16 through 512×512@2x (1024×1024 pixels).
- `app-icon.svg` and `app-icon.png` provide the original vector artwork and a 1024×1024 raster preview.
- `tray-icon.svg` and `tray-icon.png` provide the simplified monochrome small-size artwork and a 32×32 raster preview.
- `tray-icon.rgba` is exactly 4096 bytes: 32×32 pixels in top-to-bottom row-major RGBA8 order with no header or row padding.

Every tray RGB component is black, including transparent pixels, and its alpha channel contains transparent, opaque, and antialiased edge pixels.
The black-only pixels make premultiplied and straight RGBA representations equivalent.
Embed the raw tray file at compile time, use dimensions `(32, 32)`, and mark the native menu-bar image as a template so macOS supplies the correct appearance color.
The tray silhouette is deliberately simpler than the application icon for legibility in the menu bar.

Both `just package-app` and the Nix package's `postInstall` copy `GlossShift.icns` to `GlossShift.app/Contents/Resources/GlossShift.icns`.
`Info.plist` references it through `CFBundleIconFile`.
The local recipe copies resources before ad-hoc signing and verifies the bundle without launching it.
`just check-icons` decodes all ICNS representations and checks dimensions, alpha, the plist reference, and the tray raw-byte/PNG contract.
