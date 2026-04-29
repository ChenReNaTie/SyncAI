import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  CodexWorkingDirectoryError,
  requireCodexWorkingDirectory,
  resolvePersistedCodexThreadId,
  resolveCodexExecutablePath,
} from "../../server/dist/lib/codex-agent-adapter.js";

test("codex path resolver prefers an explicit manual override", () => {
  assert.equal(
    resolveCodexExecutablePath("D:/custom/codex.exe"),
    "D:/custom/codex.exe",
  );
});

test("working directory validator rejects missing working directories", () => {
  assert.throws(
    () => requireCodexWorkingDirectory(),
    CodexWorkingDirectoryError,
  );
});

test("working directory validator rejects file paths", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "syncai-codex-test-"));
  const filePath = join(tempRoot, "not-a-directory.txt");
  writeFileSync(filePath, "hello", "utf8");

  try {
    assert.throws(
      () => requireCodexWorkingDirectory(filePath),
      CodexWorkingDirectoryError,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("working directory validator accepts existing directories", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "syncai-codex-test-"));

  try {
    assert.equal(requireCodexWorkingDirectory(tempRoot), tempRoot);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("persisted codex thread resolver ignores local placeholder refs", () => {
  const sessionId = "2f078e5d-4a6e-45f7-a694-6d510a5604f2";

  assert.equal(resolvePersistedCodexThreadId(sessionId), undefined);
  assert.equal(resolvePersistedCodexThreadId(sessionId, sessionId), undefined);
  assert.equal(
    resolvePersistedCodexThreadId(sessionId, `syncai-session:${sessionId}`),
    undefined,
  );
});

test("persisted codex thread resolver keeps real codex thread refs", () => {
  const sessionId = "2f078e5d-4a6e-45f7-a694-6d510a5604f2";
  const threadId = "thread_abc123";

  assert.equal(resolvePersistedCodexThreadId(sessionId, threadId), threadId);
});

test("windows codex resolution prefers the real codex.exe over codex.cmd shims", () => {
  if (process.platform !== "win32") {
    return;
  }

  const tempRoot = mkdtempSync(join(tmpdir(), "syncai-codex-path-"));
  const originalPath = process.env.PATH;
  const vendorExe = join(
    tempRoot,
    "node_modules",
    "@openai",
    "codex",
    "node_modules",
    "@openai",
    "codex-win32-x64",
    "vendor",
    "x86_64-pc-windows-msvc",
    "codex",
    "codex.exe",
  );

  try {
    writeFileSync(join(tempRoot, "codex.cmd"), "@echo off\r\n", "utf8");
    mkdirSync(join(vendorExe, ".."), { recursive: true });
    writeFileSync(vendorExe, "", "utf8");

    process.env.PATH = tempRoot;
    assert.equal(resolveCodexExecutablePath(), vendorExe);
  } finally {
    process.env.PATH = originalPath;
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
