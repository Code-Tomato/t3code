import Foundation

/// Adapts the v2 read model to the native chat presentation model. Keep the
/// protocol-specific fields here so the SwiftUI views do not depend on a
/// second copy of the server's projection types.
public enum OrchestrationV2Compatibility {
    private static let emptyArray: JSONValue = .array([])

    private static func rows(_ value: JSONValue?) -> [JSONValue] {
        guard case let .array(rows)? = value else { return [] }
        return rows
    }

    private static func fields(_ value: JSONValue) -> [String: JSONValue] {
        guard case let .object(fields) = value else { return [:] }
        return fields
    }

    private static func date(_ value: JSONValue?) -> JSONValue {
        value?.stringValue.map(JSONValue.string) ?? .string(OrchestrationCommands.now())
    }

    private static func firstDate(_ values: JSONValue?...) -> JSONValue {
        for value in values {
            if let text = value?.stringValue { return .string(text) }
        }
        return date(nil)
    }

    private static func latestRun(_ runs: [JSONValue]) -> JSONValue? {
        runs.filter { $0["status"]?.stringValue != "rolled_back" }.max { left, right in
            (left["ordinal"]?.numberValue ?? 0) < (right["ordinal"]?.numberValue ?? 0)
        }
    }

    private static func turn(_ run: JSONValue?) -> JSONValue {
        guard let run, let id = run["id"] else { return .null }
        let status = run["status"]?.stringValue ?? "completed"
        let state: String
        switch status {
        case "preparing", "queued", "starting", "running", "waiting": state = "running"
        case "failed": state = "error"
        case "interrupted", "cancelled": state = "completed"
        default: state = status
        }
        return .object([
            "turnId": id,
            "state": .string(state),
            "requestedAt": date(run["requestedAt"]),
            "startedAt": run["startedAt"] ?? .null,
            "completedAt": run["completedAt"] ?? .null,
            "assistantMessageId": .null,
        ])
    }

    private static func session(
        thread: JSONValue, run: JSONValue?, pendingRequest: JSONValue? = nil
    ) -> JSONValue {
        let status = run?["status"]?.stringValue ?? "idle"
        let sessionStatus: String
        switch status {
        case "preparing", "queued", "starting": sessionStatus = "starting"
        case "waiting" where pendingRequest != nil: sessionStatus = "running"
        case "running", "waiting": sessionStatus = "running"
        case "failed": sessionStatus = "error"
        default: sessionStatus = "idle"
        }
        let active = ["preparing", "queued", "starting", "running", "waiting"].contains(status)
        return .object([
            "threadId": thread["id"] ?? .string(""),
            "status": .string(sessionStatus),
            "providerName": .null,
            "providerInstanceId": run?["providerInstanceId"] ?? thread["providerInstanceId"] ?? .null,
            "runtimeMode": thread["runtimeMode"] ?? .string("full-access"),
            "activeTurnId": active ? (run?["id"] ?? .null) : .null,
            "lastError": thread["lastError"] ?? .null,
            "updatedAt": firstDate(thread["updatedAt"], run?["completedAt"]),
        ])
    }

    private static func shellThread(_ raw: JSONValue) -> JSONValue {
        var value = fields(raw)
        let run: JSONValue? = raw["latestRunId"]?.stringValue.map { id in
            .object([
                "id": .string(id),
                "status": raw["status"] ?? .string("completed"),
                "requestedAt": raw["latestRunRequestedAt"] ?? raw["createdAt"] ?? .null,
                "startedAt": raw["latestRunStartedAt"] ?? .null,
                "completedAt": raw["latestRunCompletedAt"] ?? .null,
                "providerInstanceId": raw["providerInstanceId"] ?? .null,
            ])
        }
        let pending = raw["pendingRuntimeRequest"]
        let kind = pending?["kind"]?.stringValue
        value["latestTurn"] = turn(run)
        value["session"] = session(thread: raw, run: run, pendingRequest: pending)
        value["latestUserMessageAt"] = raw["latestUserMessageAt"] ?? .null
        value["hasPendingApprovals"] = .bool(kind != nil && kind != "user_input")
        value["hasPendingUserInput"] = .bool(kind == "user_input")
        value["hasActionableProposedPlan"] = raw["hasActionableProposedPlan"] ?? .bool(false)
        value["backgroundLiveness"] = rows(raw["pendingBackgroundTasks"]).isEmpty
            ? .null : .string("working")
        value["settledOverride"] = raw["settledOverride"] ?? .null
        value["settledAt"] = raw["settledAt"] ?? .null
        value["snoozedUntil"] = raw["snoozedUntil"] ?? .null
        value["snoozedAt"] = raw["snoozedAt"] ?? .null
        value["pinnedAt"] = raw["pinnedAt"] ?? .null
        return .object(value)
    }

    public static func shell(_ raw: JSONValue) throws -> OrchestrationShellSnapshot {
        if raw["updatedAt"] != nil {
            return try raw.decode(OrchestrationShellSnapshot.self)
        }
        var projects = rows(raw["projects"])
        projects = projects.map { project in
            var value = fields(project)
            value["deletedAt"] = .null
            return .object(value)
        }
        let threads = rows(raw["threads"]).map(shellThread)
        return try JSONValue.object([
            "snapshotSequence": raw["snapshotSequence"] ?? .number(0),
            "projects": .array(projects),
            "threads": .array(threads),
            "updatedAt": date(projects.last?["updatedAt"] ?? threads.last?["updatedAt"]),
        ]).decode(OrchestrationShellSnapshot.self)
    }

    public static func archivedShell(_ raw: JSONValue) throws -> OrchestrationShellSnapshot {
        try shell(raw)
    }

    public static func shellThreadValue(_ raw: JSONValue) throws -> OrchestrationThreadShell {
        try shellThread(raw).decode(OrchestrationThreadShell.self)
    }

    public static func projectValue(_ raw: JSONValue) throws -> OrchestrationProject {
        var value = fields(raw)
        value["deletedAt"] = .null
        return try JSONValue.object(value).decode(OrchestrationProject.self)
    }

    private static func message(_ item: JSONValue) -> JSONValue? {
        guard let type = item["type"]?.stringValue,
              type == "user_message" || type == "assistant_message" else { return nil }
        return .object([
            "id": item["messageId"] ?? item["id"] ?? .string(""),
            "role": .string(type == "user_message" ? "user" : "assistant"),
            "text": item["text"] ?? .string(""),
            "attachments": item["attachments"] ?? emptyArray,
            "turnId": item["runId"] ?? .null,
            "streaming": item["streaming"] ?? .bool(false),
            "createdAt": firstDate(item["startedAt"], item["updatedAt"]),
            "updatedAt": date(item["updatedAt"]),
            "context": item["context"] ?? .null,
        ])
    }

    private static func activity(_ item: JSONValue, pending: Set<String>) -> JSONValue? {
        guard let type = item["type"]?.stringValue,
              type != "user_message", type != "assistant_message" else { return nil }
        let id = item["id"] ?? .string(UUID().uuidString)
        let status = item["status"]?.stringValue ?? "completed"
        let requestID = item["requestId"]?.stringValue
        let active = requestID.map { pending.contains($0) } ?? false
        let kind: String
        let tone: String
        switch type {
        case "approval_request":
            kind = active ? "approval.requested" : "approval.resolved"
            tone = "info"
        case "user_input_request":
            kind = active ? "user-input.requested" : "user-input.resolved"
            tone = "info"
        case "error":
            kind = "runtime.warning"
            tone = "error"
        case "compaction":
            kind = "context-compaction"
            tone = "info"
        default:
            kind = status == "completed" || status == "failed" ? "tool.completed" : "tool.updated"
            tone = status == "failed" ? "error" : "info"
        }
        let summary = item["title"]?.stringValue ?? item["prompt"]?.stringValue
            ?? item["input"]?.stringValue ?? item["message"]?.stringValue
            ?? item["failure"]?["message"]?.stringValue ?? type.replacingOccurrences(of: "_", with: " ")
        var payload = fields(item)
        payload["title"] = .string(summary)
        payload["detail"] = item["output"] ?? item["text"] ?? item["message"] ?? .string(summary)
        payload["requestType"] = item["requestKind"] ?? .string(type == "user_input_request" ? "tool_user_input" : "command")
        return .object([
            "id": id,
            "tone": .string(tone),
            "kind": .string(kind),
            "summary": .string(summary),
            "payload": .object(payload),
            "turnId": item["runId"] ?? .null,
            "sequence": item["ordinal"] ?? .null,
            "createdAt": firstDate(item["startedAt"], item["updatedAt"]),
        ])
    }

    public static func detail(_ raw: JSONValue) throws -> OrchestrationThreadDetailSnapshot {
        if raw["projection"] == nil, raw["thread"] != nil {
            return try raw.decode(OrchestrationThreadDetailSnapshot.self)
        }
        let projection = raw["projection"] ?? raw
        let source = projection["thread"] ?? .null
        let runs = rows(projection["runs"])
        let latest = latestRun(runs)
        let requests = rows(projection["runtimeRequests"])
        let pending = Set(requests.compactMap { request -> String? in
            request["status"]?.stringValue == "pending" ? request["id"]?.stringValue : nil
        })
        let items = rows(projection["visibleTurnItems"]).compactMap { $0["item"] }
        let assistantByRun = Dictionary(
            items.compactMap { item -> (String, JSONValue)? in
                guard item["type"]?.stringValue == "assistant_message",
                      let runID = item["runId"]?.stringValue,
                      let messageID = item["messageId"] else { return nil }
                return (runID, messageID)
            },
            uniquingKeysWith: { _, latest in latest }
        )
        let checkpoints = rows(projection["checkpoints"]).filter {
            $0["status"]?.stringValue == "ready"
        }.map { checkpoint -> JSONValue in
            let runID = checkpoint["runId"]?.stringValue
            return .object([
                "turnId": runID.map(JSONValue.string) ?? .string("thread-start"),
                "checkpointTurnCount": checkpoint["appRunOrdinal"] ?? .number(0),
                "checkpointRef": checkpoint["ref"] ?? .string(""),
                "status": checkpoint["status"] ?? .string("ready"),
                "files": checkpoint["files"] ?? emptyArray,
                "assistantMessageId": runID.flatMap { assistantByRun[$0] } ?? .null,
                "completedAt": date(checkpoint["capturedAt"]),
            ])
        }
        var thread = fields(source)
        thread["latestTurn"] = turn(latest)
        thread["session"] = session(thread: source, run: latest)
        thread["messages"] = .array(items.compactMap(message))
        thread["activities"] = .array(items.compactMap { activity($0, pending: pending) })
        thread["checkpoints"] = .array(checkpoints)
        thread["settledOverride"] = source["settledOverride"] ?? .null
        thread["settledAt"] = source["settledAt"] ?? .null
        thread["snoozedUntil"] = source["snoozedUntil"] ?? .null
        thread["snoozedAt"] = source["snoozedAt"] ?? .null
        thread["pinnedAt"] = source["pinnedAt"] ?? .null
        let page: JSONValue = .object([
            "beforeCursor": raw["historyCursor"] ?? .null,
            "hasMore": raw["hasMoreHistory"] ?? .bool(false),
            "snapshotSequence": raw["snapshotSequence"] ?? .number(0),
            "threadSequence": raw["snapshotSequence"] ?? .number(0),
        ])
        return try JSONValue.object([
            "snapshotSequence": raw["snapshotSequence"] ?? .number(0),
            "thread": .object(thread),
            "page": page,
        ]).decode(OrchestrationThreadDetailSnapshot.self)
    }

    public static func historyPage(
        _ raw: JSONValue, thread: OrchestrationThread
    ) throws -> OrchestrationThreadDetailSnapshot {
        if raw["thread"] != nil {
            return try raw.decode(OrchestrationThreadDetailSnapshot.self)
        }
        let items = rows(raw["items"]).compactMap { $0["item"] }
        var value = try JSONValue.encode(thread)
        var fields = fields(value)
        fields["messages"] = .array(items.compactMap(message))
        fields["activities"] = .array(items.compactMap { activity($0, pending: []) })
        value = .object(fields)
        return try JSONValue.object([
            "snapshotSequence": raw["snapshotSequence"] ?? .number(0),
            "thread": value,
            "page": .object([
                "beforeCursor": raw["nextCursor"] ?? .null,
                "hasMore": raw["hasMoreHistory"] ?? .bool(false),
                "snapshotSequence": raw["snapshotSequence"] ?? .number(0),
                "threadSequence": raw["snapshotSequence"] ?? .number(0),
            ]),
        ]).decode(OrchestrationThreadDetailSnapshot.self)
    }

    public static func messageValue(_ item: JSONValue) throws -> OrchestrationMessage? {
        try message(item)?.decode(OrchestrationMessage.self)
    }

    public static func activityValue(_ item: JSONValue, pending: Bool) throws -> OrchestrationActivity? {
        let requestID = item["requestId"]?.stringValue
        return try activity(item, pending: pending ? Set(requestID.map { [$0] } ?? []) : [])?
            .decode(OrchestrationActivity.self)
    }

    public static func updateRun(
        _ run: JSONValue, in thread: OrchestrationThread, occurredAt: String
    ) throws -> OrchestrationThread {
        var value = fields(try JSONValue.encode(thread))
        value["latestTurn"] = turn(run)
        value["session"] = session(thread: .object(value), run: run)
        value["updatedAt"] = .string(occurredAt)
        return try JSONValue.object(value).decode(OrchestrationThread.self)
    }

    public static func updateMetadata(
        _ source: JSONValue, in thread: OrchestrationThread
    ) throws -> OrchestrationThread {
        var value = fields(try JSONValue.encode(thread))
        for key in ["title", "modelSelection", "runtimeMode", "interactionMode", "branch",
                    "worktreePath", "linkedPullRequest", "pullRequests", "branchPullRequest",
                    "updatedAt", "archivedAt", "settledOverride", "settledAt", "unsettledAt",
                    "activeOrderKey", "snoozedUntil", "snoozedAt", "pinnedAt", "pinOrderKey",
                    "titleRegeneration"] {
            if let updated = source[key] { value[key] = updated }
        }
        return try JSONValue.object(value).decode(OrchestrationThread.self)
    }
}

private extension JSONValue {
    var numberValue: Double? {
        switch self {
        case let .number(value): value
        case let .integer(value): Double(value)
        case let .unsignedInteger(value): Double(value)
        default: nil
        }
    }
}
