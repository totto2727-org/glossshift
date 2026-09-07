#!/usr/bin/env swift
import AppKit
import Foundation

func require(_ condition: Bool, _ message: String) {
    guard condition else {
        fputs("Icon validation failed: \(message)\n", stderr)
        exit(1)
    }
}

func checkPNG(_ path: String, size: Int) throws {
    let data = try Data(contentsOf: URL(fileURLWithPath: path))
    guard let image = NSBitmapImageRep(data: data) else {
        require(false, "Cannot decode \(path)")
        return
    }
    require(image.pixelsWide == size && image.pixelsHigh == size, "\(path) must be \(size)×\(size)")
    require(image.hasAlpha, "\(path) must retain transparency")
}

try checkPNG("packaging/app-icon.png", size: 1024)
try checkPNG("packaging/tray-icon.png", size: 32)
let raw = try Data(contentsOf: URL(fileURLWithPath: "packaging/tray-icon.rgba"))
require(raw.count == 32 * 32 * 4, "Tray must be exactly 4096 RGBA bytes without a header")
var alphas: Set<UInt8> = []
let preview = NSBitmapImageRep(data: try Data(contentsOf: URL(fileURLWithPath: "packaging/tray-icon.png")))!
for pixel in 0..<(32 * 32) {
    let offset = pixel * 4
    require(raw[offset] == 0 && raw[offset + 1] == 0 && raw[offset + 2] == 0,
            "Tray RGB must be black, including transparent pixels")
    alphas.insert(raw[offset + 3])
    let alpha = preview.colorAt(x: pixel % 32, y: pixel / 32)!.alphaComponent
    require(abs(alpha * 255 - CGFloat(raw[offset + 3])) < 1,
            "Tray raw bytes must match top-to-bottom PNG alpha")
}
require(alphas.contains(0) && alphas.contains(255), "Tray needs transparent and opaque pixels")
require(alphas.count > 2, "Tray silhouette should retain antialiased edges")
let directory = URL(fileURLWithPath: "target/IconValidation-\(UUID().uuidString).iconset")
try FileManager.default.createDirectory(at: directory.deletingLastPathComponent(),
                                       withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: directory) }
let process = Process()
process.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
process.arguments = ["--convert", "iconset", "--output", directory.path, "packaging/GlossShift.icns"]
try process.run()
process.waitUntilExit()
require(process.terminationStatus == 0, "ICNS must decode through iconutil")
for points in [16, 32, 128, 256, 512] {
    for density in [1, 2] {
        let name = "icon_\(points)x\(points)\(density == 2 ? "@2x" : "").png"
        try checkPNG(directory.appendingPathComponent(name).path, size: points * density)
    }
}
let plist = try PropertyListSerialization.propertyList(
    from: Data(contentsOf: URL(fileURLWithPath: "packaging/Info.plist")), format: nil) as! [String: Any]
require(plist["CFBundleIconFile"] as? String == "GlossShift.icns", "Bundle icon reference must match asset")
print("Validated all 10 ICNS representations (16–1024 px), PNG dimensions/alpha, plist, and 32×32 black RGBA template.")
