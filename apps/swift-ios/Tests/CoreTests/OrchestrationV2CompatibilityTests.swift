import Foundation
import XCTest
@testable import T3Code

final class OrchestrationV2CompatibilityTests: XCTestCase {
    func testLiveV2ShellFixtureKeepsInterruptedThreadVisible() throws {
        let raw = try fixture("v2-shell-snapshot")
        let shell = try OrchestrationV2Compatibility.shell(raw)

        XCTAssertEqual(shell.projects.map(\.title), ["Swift v2 test"])
        XCTAssertEqual(shell.threads.count, 1)
        XCTAssertEqual(shell.threads[0].title, "Reply with READY only.")
        XCTAssertEqual(shell.threads[0].latestTurn?.state, "completed")
        XCTAssertEqual(shell.threads[0].session?.status, "idle")
    }

    func testProjectEnrichmentFrameDoesNotReplaceTheThreadList() throws {
        let raw = try fixture("v2-shell-snapshot")
        let frame: JSONValue = .object([
            "kind": .string("snapshot"),
            "snapshot": .object([
                "snapshotSequence": raw["snapshotSequence"] ?? .number(0),
                "projects": raw["projects"] ?? .array([]),
                "threads": .array([]),
            ]),
            "resolvedRepositoryIdentityRoots": .array([.string("/test/project")]),
        ])
        guard case let .projectMetadata(projects) = try frame.decode(ShellStreamItem.self) else {
            return XCTFail("Expected a project metadata frame")
        }
        XCTAssertEqual(projects.map(\.title), ["Swift v2 test"])
    }

    func testLiveV2ProjectionFixtureMapsVisibleMessagesAndHistory() throws {
        let raw = try fixture("v2-thread-detail-snapshot")
        let snapshot = try OrchestrationV2Compatibility.detail(raw)

        XCTAssertEqual(snapshot.thread.messages.map(\.role), ["user", "assistant", "user", "assistant"])
        XCTAssertEqual(snapshot.thread.messages.first?.text, "Reply with READY only.")
        XCTAssertEqual(snapshot.thread.messages[1].text, "READY")
        XCTAssertEqual(snapshot.thread.messages[3].text, "SECOND")
        XCTAssertFalse(snapshot.thread.checkpoints.isEmpty)
        XCTAssertEqual(snapshot.page?.hasMore, false)
    }

    func testV2CommandsCarryRequiredFields() throws {
        let command = try OrchestrationCommands.sendTurn(
            threadID: "thread-1", text: "Hello", runtimeMode: .fullAccess,
            commandID: "command-1", messageID: "message-1"
        )
        XCTAssertEqual(command["type"], .string("message.dispatch"))
        XCTAssertEqual(command["messageId"], .string("message-1"))
        XCTAssertEqual(command["createdBy"], .string("user"))
        XCTAssertEqual(command["dispatchMode"]?["type"], .string("start_immediately"))
        XCTAssertEqual(command["deliveryIntent"], .string("auto"))

        let response = OrchestrationCommands.respondToApproval(
            threadID: "thread-1", requestID: "request-1", decision: "accept"
        )
        XCTAssertEqual(response["type"], .string("runtime-request.respond"))

        let rollback = OrchestrationCommands.rollback(
            threadID: "thread-1", scopeID: "scope-1", checkpointID: "checkpoint-1",
            restoreFiles: false
        )
        XCTAssertEqual(rollback["scopeId"], .string("scope-1"))
        XCTAssertEqual(rollback["checkpointId"], .string("checkpoint-1"))
    }

    private func fixture(_ name: String) throws -> JSONValue {
        let directory = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
        return try JSONDecoder.t3.decode(
            JSONValue.self,
            from: Data(contentsOf: directory.appendingPathComponent("Fixtures/Wire/\(name).json"))
        )
    }
}
