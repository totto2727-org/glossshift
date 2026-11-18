import ApplicationServices
import Foundation

let (response, status) = execute(
    arguments: Array(CommandLine.arguments.dropFirst()),
    trusted: { AXIsProcessTrusted() },
    read: readFocusedSelection
)
do {
    var data = try JSONEncoder().encode(response)
    data.append(0x0A)
    try FileHandle.standardOutput.write(contentsOf: data)
    exit(status)
} catch {
    // Never put native errors or selected text in diagnostics.
    exit(1)
}
