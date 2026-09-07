#!/usr/bin/env swift
// Original GlossShift vector artwork. No fonts, external assets, or runtime dependencies.
// Run from the repository root with `just generate-icons` (macOS developer tools required).
import AppKit
import Foundation

struct Shape {
    let path: CGPath
    let svg: String
    let color: String
    let width: CGFloat
}

func color(_ hex: String) -> CGColor {
    let value = UInt32(hex, radix: 16)!
    return CGColor(srgbRed: CGFloat((value >> 16) & 255) / 255,
                   green: CGFloat((value >> 8) & 255) / 255,
                   blue: CGFloat(value & 255) / 255, alpha: 1)
}

func line(_ points: [(CGFloat, CGFloat)], _ hex: String, _ width: CGFloat,
          close: Bool = false) -> Shape {
    let path = CGMutablePath()
    var commands: [String] = []
    for (index, point) in points.enumerated() {
        let p = CGPoint(x: point.0, y: point.1)
        if index == 0 { path.move(to: p) } else { path.addLine(to: p) }
        commands.append("\(index == 0 ? "M" : "L")\(point.0),\(point.1)")
    }
    if close { path.closeSubpath(); commands.append("Z") }
    return Shape(path: path, svg: "<path d=\"\(commands.joined(separator: " "))\"/>",
                 color: hex, width: width)
}

func rounded(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat,
             _ radius: CGFloat, _ hex: String) -> Shape {
    let rect = CGRect(x: x, y: y, width: w, height: h)
    return Shape(path: CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius,
                             transform: nil),
                 svg: "<rect x=\"\(x)\" y=\"\(y)\" width=\"\(w)\" height=\"\(h)\" rx=\"\(radius)\"/>",
                 color: hex, width: 0)
}

// Two offset language cards. The compact arrows express a reversible language shift.
let tile = rounded(64, 64, 896, 896, 204, "126CDB")
let app: [Shape] = [
    rounded(184, 230, 386, 350, 64, "104C98"),
    rounded(184, 212, 386, 350, 64, "FFFFFF"),
    line([(266, 546), (266, 624), (352, 546)], "FFFFFF", 0, close: true),
    rounded(444, 446, 396, 352, 64, "0B657D"),
    rounded(444, 428, 396, 352, 64, "E8FFFB"),
    line([(676, 766), (758, 842), (758, 766)], "E8FFFB", 0, close: true),
    line([(274, 474), (350, 292), (370, 292), (432, 474)], "176BD1", 30),
    line([(302, 412), (410, 412)], "176BD1", 27),
    line([(641, 497), (641, 524)], "087B89", 26),
    line([(545, 538), (739, 538)], "087B89", 26),
    line([(587, 546), (612, 605), (654, 650), (720, 694)], "087B89", 26),
    line([(699, 546), (674, 605), (632, 650), (566, 694)], "087B89", 26),
    line([(647, 276), (753, 276), (753, 345)], "AEFFF0", 22),
    line([(720, 322), (753, 355), (786, 322)], "AEFFF0", 22),
    line([(374, 749), (269, 749), (269, 682)], "AEFFF0", 22),
    line([(236, 706), (269, 673), (302, 706)], "AEFFF0", 22)
]

// A distinct small-size template: interlocking speech cards and directional text strokes.
let tray: [Shape] = [
    line([(4, 5), (20, 5), (20, 15), (11, 15), (7, 19), (7, 15), (4, 15), (4, 5)], "000000", 2),
    line([(24, 13), (28, 13), (28, 25), (25, 25), (25, 29), (21, 25), (13, 25), (13, 20)], "000000", 2),
    line([(8, 10), (16, 10), (14, 8)], "000000", 1.8),
    line([(24, 20), (17, 20), (19, 22)], "000000", 1.8)
]

let manager = FileManager.default
let root = URL(fileURLWithPath: manager.currentDirectoryPath)
let packaging = root.appendingPathComponent("packaging")
let iconset = root.appendingPathComponent("target/GlossShift.iconset")
try manager.createDirectory(at: iconset, withIntermediateDirectories: true)

func draw(_ shape: Shape, in context: CGContext) {
    context.addPath(shape.path)
    if shape.width == 0 {
        context.setFillColor(color(shape.color))
        context.fillPath()
    } else {
        context.setStrokeColor(color(shape.color))
        context.setLineWidth(shape.width)
        context.setLineCap(.round)
        context.setLineJoin(.round)
        context.strokePath()
    }
}

func render(size: Int, template: Bool = false) throws -> (Data, Data) {
    let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8,
                            bytesPerRow: size * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                                | CGBitmapInfo.byteOrder32Big.rawValue)!
    context.translateBy(x: 0, y: CGFloat(size))
    let scale = CGFloat(size) / (template ? 32 : 1024)
    context.scaleBy(x: scale, y: -scale)
    if template {
        tray.forEach { draw($0, in: context) }
    } else {
        context.saveGState()
        context.setShadow(offset: CGSize(width: 0, height: -12), blur: 20,
                          color: CGColor(srgbRed: 0.04, green: 0.12, blue: 0.24, alpha: 0.25))
        draw(tile, in: context)
        context.restoreGState()
        context.saveGState()
        context.addPath(tile.path)
        context.clip()
        let gradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB),
                                  colors: [color("246EF1"), color("009C9B")] as CFArray,
                                  locations: [0, 1])!
        context.drawLinearGradient(gradient, start: CGPoint(x: 164, y: 80),
                                   end: CGPoint(x: 872, y: 960), options: [])
        context.restoreGState()
        app.forEach { draw($0, in: context) }
    }
    let raw = Data(bytes: context.data!, count: size * size * 4)
    let bitmap = NSBitmapImageRep(cgImage: context.makeImage()!)
    return (bitmap.representation(using: .png, properties: [:])!, raw)
}

func svg(shapes: [Shape], size: Int, background: Bool) -> String {
    let header = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"\(size)\" height=\"\(size)\" viewBox=\"0 0 \(size) \(size)\">"
    let backdrop = """
    <defs>
      <linearGradient id="tile" x1="0.12" y1="0" x2="0.9" y2="1"><stop stop-color="#246EF1"/><stop offset="1" stop-color="#009C9B"/></linearGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="12" stdDeviation="10" flood-color="#0A1F3D" flood-opacity="0.25"/></filter>
    </defs>
    <g fill="url(#tile)" filter="url(#shadow)">\(tile.svg)</g>
    """
    let body = shapes.map { shape in
        let style = shape.width == 0 ? "fill=\"#\(shape.color)\""
            : "fill=\"none\" stroke=\"#\(shape.color)\" stroke-width=\"\(shape.width)\" stroke-linecap=\"round\" stroke-linejoin=\"round\""
        return "<g \(style)>\(shape.svg)</g>"
    }.joined(separator: "\n")
    return "\(header)\n<!-- Original GlossShift artwork. Regenerate with just generate-icons. -->\n\(background ? backdrop : "")\n\(body)\n</svg>\n"
}

for points in [16, 32, 128, 256, 512] {
    for density in [1, 2] {
        let name = "icon_\(points)x\(points)\(density == 2 ? "@2x" : "").png"
        try render(size: points * density).0.write(to: iconset.appendingPathComponent(name))
    }
}
try render(size: 1024).0.write(to: packaging.appendingPathComponent("app-icon.png"))
let (trayPNG, trayRGBA) = try render(size: 32, template: true)
try trayPNG.write(to: packaging.appendingPathComponent("tray-icon.png"))
try trayRGBA.write(to: packaging.appendingPathComponent("tray-icon.rgba"))
try svg(shapes: app, size: 1024, background: true).write(
    to: packaging.appendingPathComponent("app-icon.svg"), atomically: true, encoding: .utf8)
try svg(shapes: tray, size: 32, background: false).write(
    to: packaging.appendingPathComponent("tray-icon.svg"), atomically: true, encoding: .utf8)
let process = Process()
process.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
process.arguments = ["--convert", "icns", "--output", packaging.appendingPathComponent("GlossShift.icns").path, iconset.path]
try process.run()
process.waitUntilExit()
guard process.terminationStatus == 0 else { exit(process.terminationStatus) }
print("Generated GlossShift.icns, app/tray SVG and PNG previews, and 32×32 RGBA template.")
