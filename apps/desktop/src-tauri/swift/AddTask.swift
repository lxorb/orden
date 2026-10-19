// The Mac's App Intents: what Shortcuts, Spotlight and the Action button list for nib.
// Compiled by build.rs into an object linked into the app, so the intents run in the
// app's own process; the system starts nib in the background where it is not running.

import AppIntents
import Foundation

/// Appends an open task to the inbox of the space in front; see src/siri.rs.
@_silgen_name("nib_add_to_inbox")
private func nibAddToInbox(_ text: UnsafePointer<CChar>) -> Int32

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
        let added = text.withCString { nibAddToInbox($0) }
        guard added == 0 else { throw NotAdded() }
        return .result(dialog: "Added.")
    }
}

struct NibShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AddTaskIntent(),
            // A phrase may only name AppEntity or AppEnum parameters, never free text:
            // the system asks for the task through the parameter's dialog instead.
            phrases: [
                "Add a task in \(.applicationName)",
                "Add to my inbox in \(.applicationName)",
            ],
            shortTitle: "Add task",
            systemImageName: "checklist"
        )
    }
}
