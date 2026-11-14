import Foundation

@main
struct SelectionTests {
    static func main() throws {
        var reads = 0
        let permission = execute(arguments: ["--permission"], trusted: { false }, read: {
            reads += 1
            return "must not read"
        })
        precondition(permission.0.kind == "permission" && permission.0.granted == false)
        precondition(permission.1 == 0 && reads == 0)

        let denied = execute(arguments: ["--selection"], trusted: { false }, read: {
            reads += 1
            return "must not read"
        })
        precondition(denied.0.code == "permission-required" && denied.1 == 1 && reads == 0)

        let source = "  Synthetic 日本語\nwith \"quotes\"\n"
        let selected = execute(arguments: ["--selection"], trusted: { true }, read: { source })
        precondition(selected.1 == 0 && selected.0.text == source)
        let encoded = try JSONEncoder().encode(selected.0)
        let object = try JSONSerialization.jsonObject(with: encoded) as! [String: Any]
        precondition(object["text"] as? String == source)
        precondition(!encoded.contains(0x0A))

        let empty = execute(arguments: ["--selection"], trusted: { true }, read: { " \n\t" })
        precondition(empty.0.code == "no-selection" && empty.1 == 1)
        let large = execute(arguments: ["--selection"], trusted: { true }, read: {
            String(repeating: "a", count: 1_048_577)
        })
        precondition(large.0.code == "selection-too-large" && large.1 == 1)
        struct PrivateError: Error {}
        let failed = execute(arguments: ["--selection"], trusted: { true }, read: { throw PrivateError() })
        precondition(failed.0.code == "selection-unavailable" && failed.0.text == nil)
        let invalid = execute(arguments: [], trusted: { preconditionFailure("unexpected trust query") }, read: {
            preconditionFailure("unexpected selection query")
        })
        precondition(invalid.0.code == "invalid-arguments" && invalid.1 == 1)
        print("8 helper contract cases passed with synthetic input; no native AX access")
    }
}
