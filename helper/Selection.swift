import ApplicationServices
import Foundation

struct HelperFailure: Error {
    let code: String
    let message: String

    static let permission = HelperFailure(
        code: "permission-required",
        message: "Enable Accessibility access for GlossShift in System Settings."
    )
    static let unavailable = HelperFailure(
        code: "selection-unavailable",
        message: "The focused application does not expose selected text."
    )
    static let empty = HelperFailure(code: "no-selection", message: "No text is selected.")
}

struct HelperResponse: Encodable {
    let schemaVersion = 1
    let kind: String
    var granted: Bool? = nil
    var text: String? = nil
    var code: String? = nil
    var message: String? = nil
}

func captureSelection(
    trusted: () -> Bool,
    read: () throws -> String
) throws -> String {
    guard trusted() else { throw HelperFailure.permission }
    let text = try read()
    guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        throw HelperFailure.empty
    }
    guard text.utf8.count <= 1_048_576 else {
        throw HelperFailure(code: "selection-too-large", message: "The selected text is too large.")
    }
    return text
}

func readFocusedSelection() throws -> String {
    let system = AXUIElementCreateSystemWide()
    guard AXUIElementSetMessagingTimeout(system, 0.5) == .success else {
        throw HelperFailure.unavailable
    }
    var focusedValue: CFTypeRef?
    guard AXUIElementCopyAttributeValue(
        system, kAXFocusedUIElementAttribute as CFString, &focusedValue
    ) == .success,
        let focused = focusedValue,
        CFGetTypeID(focused) == AXUIElementGetTypeID()
    else { throw HelperFailure.unavailable }

    // AXUIElement's runtime type was checked before this CF bridging cast.
    let element = unsafeBitCast(focused, to: AXUIElement.self)
    guard AXUIElementSetMessagingTimeout(element, 0.5) == .success else {
        throw HelperFailure.unavailable
    }
    var selectedValue: CFTypeRef?
    guard AXUIElementCopyAttributeValue(
        element, kAXSelectedTextAttribute as CFString, &selectedValue
    ) == .success,
        let selected = selectedValue,
        CFGetTypeID(selected) == CFStringGetTypeID(),
        let text = selected as? String
    else { throw HelperFailure.unavailable }
    return text
}

func execute(
    arguments: [String],
    trusted: () -> Bool,
    read: () throws -> String
) -> (HelperResponse, Int32) {
    do {
        switch arguments {
        case ["--permission"]:
            return (HelperResponse(kind: "permission", granted: trusted()), 0)
        case ["--selection"]:
            let text = try captureSelection(trusted: trusted, read: read)
            return (HelperResponse(kind: "selection", text: text), 0)
        default:
            throw HelperFailure(
                code: "invalid-arguments",
                message: "Expected --permission or --selection."
            )
        }
    } catch let failure as HelperFailure {
        return (HelperResponse(kind: "error", code: failure.code, message: failure.message), 1)
    } catch {
        return (HelperResponse(
            kind: "error", code: HelperFailure.unavailable.code,
            message: HelperFailure.unavailable.message
        ), 1)
    }
}
