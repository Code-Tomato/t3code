import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { HttpClient } from "effect/unstable/http";
import {
  HostProcessArchitecture,
  HostProcessEnvironment,
  HostProcessExecutablePath,
  HostProcessInvokedAs,
  HostProcessPlatform,
  HostProcessWorkingDirectory,
} from "@t3tools/shared/hostProcess";

import * as BootService from "../cloud/bootService.ts";
import * as ProcessRunner from "../processRunner.ts";
import {
  repointLauncher,
  resolveLauncherPath,
  resolvePackageManagedInstall,
  runUpdate,
} from "./update.ts";

it.layer(NodeServices.layer)("t3 update package-managed install", (it) => {
  it.effect("reads the package-type marker beside the executable behind the launcher", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-update-" });
      const exe = path.join(root, "opt/t3code-cli/t3");
      const launcher = path.join(root, "usr/bin/t3");
      yield* fs.makeDirectory(path.dirname(exe), { recursive: true });
      yield* fs.writeFileString(exe, "");
      yield* fs.makeDirectory(path.dirname(launcher), { recursive: true });
      yield* fs.symlink(exe, launcher);
      const marker = path.join(path.dirname(exe), "package-type");
      const detect = (executablePath: string) =>
        resolvePackageManagedInstall.pipe(
          Effect.provideService(HostProcessExecutablePath, executablePath),
        );

      assert.equal(yield* detect(launcher), undefined, "no marker");
      yield* fs.writeFileString(marker, "deb\n");
      assert.equal(yield* detect(launcher), "deb");
      assert.equal(yield* detect(exe), "deb");
      yield* fs.writeFileString(marker, "rpm\n");
      assert.equal(yield* detect(launcher), "rpm");
      yield* fs.writeFileString(marker, "snap\n");
      assert.equal(yield* detect(launcher), "unknown");
      yield* fs.writeFileString(marker, "\n");
      assert.equal(yield* detect(launcher), undefined, "empty marker");
    }).pipe(Effect.scoped),
  );

  it.effect("refuses to update a package-managed install before touching anything", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-update-" });
      const exe = path.join(root, "opt/t3code-cli/t3");
      yield* fs.makeDirectory(path.dirname(exe), { recursive: true });
      yield* fs.writeFileString(exe, "");
      yield* fs.writeFileString(path.join(path.dirname(exe), "package-type"), "deb\n");
      const touched: string[] = [];
      const update = runUpdate({
        baseDir: path.join(root, "home"),
        logsDir: path.join(root, "home/logs"),
        serverRuntimeStatePath: path.join(root, "home/runtime/server.json"),
        channel: undefined,
        requestedVersion: "9.9.9",
        allowDowngrade: false,
        assumeYes: true,
      }).pipe(
        Effect.provideService(HostProcessExecutablePath, exe),
        Effect.provideService(HostProcessPlatform, "linux"),
        Effect.provideService(HostProcessArchitecture, "x64"),
        Effect.provideService(HostProcessEnvironment, {}),
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make((request) => {
            touched.push(`fetch ${request.url}`);
            return Effect.die("unexpected network request");
          }),
        ),
        Effect.provideService(ProcessRunner.ProcessRunner, {
          run: (input) => {
            touched.push(`run ${input.command}`);
            return Effect.die("unexpected process");
          },
        }),
        Effect.provideService(BootService.BootService, {
          status: Effect.sync(() => {
            touched.push("service status");
            return {
              supported: false,
              installed: false,
              current: false,
              unitPath: "",
              logPath: "",
            };
          }),
          install: () => Effect.die("unexpected service install"),
          restart: Effect.die("unexpected service restart"),
          uninstall: Effect.die("unexpected service uninstall"),
        }),
      );

      const error = yield* Effect.flip(update);
      assert.equal(error._tag, "CliUpdateError");
      assert.equal(
        error.message,
        "t3 is installed with apt. Update it with: sudo apt update && sudo apt upgrade",
      );
      assert.deepStrictEqual(touched, []);
      assert.isFalse(yield* fs.exists(path.join(root, "home")));
    }).pipe(Effect.scoped),
  );
});

it.layer(NodeServices.layer)("t3 update launcher", (it) => {
  it.effect("repoints a symlink that lives in a runtime versions tree", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-update-" });
      const oldExe = path.join(root, "runtime/versions/1.0.0/t3");
      const newExe = path.join(root, "runtime/versions/2.0.0/t3");
      const launcher = path.join(root, "bin/t3");
      for (const file of [oldExe, newExe]) {
        yield* fs.makeDirectory(path.dirname(file), { recursive: true });
        yield* fs.writeFileString(file, "");
      }
      yield* fs.makeDirectory(path.dirname(launcher), { recursive: true });
      yield* fs.symlink(oldExe, launcher);

      const repointed = yield* repointLauncher({
        launchedAs: launcher,
        versionsDir: path.join(root, "runtime/versions"),
        targetEntryPath: newExe,
      });

      assert.deepStrictEqual(Option.getOrUndefined(repointed), launcher);
      assert.equal(yield* fs.readLink(launcher), newExe);
    }).pipe(Effect.scoped, Effect.provideService(HostProcessPlatform, "linux")),
  );

  it.effect("leaves a plain copy or a foreign symlink alone", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-update-" });
      const newExe = path.join(root, "runtime/versions/2.0.0/t3");
      const copy = path.join(root, "copy/t3");
      const foreign = path.join(root, "foreign/t3");
      const elsewhere = path.join(root, "elsewhere/t3");
      // Another install's versions tree: same shape, different home.
      const otherHome = path.join(root, "other/runtime/versions/1.0.0/t3");
      const otherLauncher = path.join(root, "other/bin/t3");
      for (const file of [newExe, copy, elsewhere, otherHome]) {
        yield* fs.makeDirectory(path.dirname(file), { recursive: true });
        yield* fs.writeFileString(file, "");
      }
      yield* fs.makeDirectory(path.dirname(foreign), { recursive: true });
      yield* fs.symlink(elsewhere, foreign);
      yield* fs.makeDirectory(path.dirname(otherLauncher), { recursive: true });
      yield* fs.symlink(otherHome, otherLauncher);

      for (const launchedAs of [copy, foreign, otherLauncher, undefined]) {
        const repointed = yield* repointLauncher({
          launchedAs,
          versionsDir: path.join(root, "runtime/versions"),
          targetEntryPath: newExe,
        });
        assert.equal(repointed._tag, "None", launchedAs ?? "undefined");
      }
      assert.equal(yield* fs.readLink(foreign), elsewhere);
      assert.equal(yield* fs.readLink(otherLauncher), otherHome);
    }).pipe(Effect.scoped, Effect.provideService(HostProcessPlatform, "linux")),
  );

  it.effect("finds the launcher a bare command name resolved to on PATH", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-update-" });
      const launcher = path.join(root, "bin/t3");
      yield* fs.makeDirectory(path.dirname(launcher), { recursive: true });
      yield* fs.writeFileString(launcher, "");

      const bare = yield* resolveLauncherPath.pipe(
        Effect.provideService(HostProcessInvokedAs, "t3"),
        Effect.provideService(HostProcessEnvironment, {
          PATH: `${path.join(root, "missing")}:${path.join(root, "bin")}`,
        }),
        Effect.provideService(HostProcessWorkingDirectory, root),
      );
      const relative = yield* resolveLauncherPath.pipe(
        Effect.provideService(HostProcessInvokedAs, "./bin/t3"),
        Effect.provideService(HostProcessEnvironment, { PATH: "" }),
        Effect.provideService(HostProcessWorkingDirectory, root),
      );
      const absent = yield* resolveLauncherPath.pipe(
        Effect.provideService(HostProcessInvokedAs, "t3"),
        Effect.provideService(HostProcessEnvironment, { PATH: path.join(root, "missing") }),
        Effect.provideService(HostProcessWorkingDirectory, root),
      );

      assert.equal(bare, launcher);
      assert.equal(relative, launcher);
      assert.equal(absent, undefined);
    }).pipe(Effect.scoped, Effect.provideService(HostProcessPlatform, "linux")),
  );
});
