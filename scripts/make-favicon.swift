import AppKit

let width = 64
let height = 64
guard let bitmap = NSBitmapImageRep(
  bitmapDataPlanes: nil,
  pixelsWide: width,
  pixelsHigh: height,
  bitsPerSample: 8,
  samplesPerPixel: 4,
  hasAlpha: true,
  isPlanar: false,
  colorSpaceName: .deviceRGB,
  bytesPerRow: 0,
  bitsPerPixel: 0
) else {
  fatalError("Could not create favicon bitmap")
}

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)

NSColor(calibratedRed: 244.0 / 255.0, green: 243.0 / 255.0, blue: 239.0 / 255.0, alpha: 1).setFill()
NSBezierPath(rect: NSRect(x: 0, y: 0, width: width, height: height)).fill()

NSColor(calibratedRed: 23.0 / 255.0, green: 23.0 / 255.0, blue: 21.0 / 255.0, alpha: 1).setFill()
NSBezierPath(ovalIn: NSRect(x: 10, y: 22, width: 20, height: 20)).fill()

NSColor(calibratedRed: 49.0 / 255.0, green: 92.0 / 255.0, blue: 1, alpha: 1).setFill()
NSBezierPath(ovalIn: NSRect(x: 34, y: 22, width: 20, height: 20)).fill()

NSGraphicsContext.restoreGraphicsState()

guard let png = bitmap.representation(using: .png, properties: [:]) else {
  fatalError("Could not render favicon")
}

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
try png.write(to: root.appendingPathComponent("favicon.png"))
