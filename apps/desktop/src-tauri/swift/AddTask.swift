import AppIntents
import Foundation

@_silgen_name("orden_add_to_inbox")
private func ordenAddToInbox(_ text: UnsafePointer<CChar>) -> Int32

private struct NotAdded: Error, CustomLocalizedStringResourceConvertible {
    var localizedStringResource: LocalizedStringResource { "The task could not be added." }
}

struct AddTaskIntent: AppIntent {
    static let title: LocalizedStringResource = "Add task"
    static let description = IntentDescription("Adds a task to the inbox.")
    static let openAppWhenRun = false

    @Parameter(title: "Task", requestValueDialog: "What's the task?")
    var text: String

    static var parameterSummary: some ParameterSummary {
        Summary("Add \(\.$text) to the inbox")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let added = text.withCString { ordenAddToInbox($0) }
        guard added == 0 else { throw NotAdded() }
        return .result(dialog: "Added.")
    }
}

struct OrdenShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AddTaskIntent(),
            phrases: [
                "Add a task in \(.applicationName)",
                "Add to my inbox in \(.applicationName)",
            ],
            shortTitle: "Add task",
            systemImageName: "checklist"
        )
    }
}
