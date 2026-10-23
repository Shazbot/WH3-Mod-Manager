import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { normalizePackFilePath } from "../utility/packFilePathUtils";
import { AutomationError } from "./errors";

export interface FilesystemPolicyOptions {
  /** Omitted means local CLI access to any readable path. */
  readRoots?: readonly string[];
  /** Omitted means local CLI access to any writable path. */
  writeRoots?: readonly string[];
}

const containsPath = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
};

const realpathWithExistingParent = async (requestedPath: string): Promise<string> => {
  const absolutePath = path.resolve(requestedPath);
  let cursor = absolutePath;
  const suffix: string[] = [];
  for (;;) {
    try {
      const existing = await fs.promises.realpath(cursor);
      return path.join(existing, ...suffix.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      suffix.push(path.basename(cursor));
      cursor = parent;
    }
  }
};

const ensureWithinRoots = (candidate: string, roots: readonly string[] | undefined, description: string): void => {
  if (!roots) return;
  if (!roots.some((root) => containsPath(root, candidate))) {
    throw new AutomationError("IO_ACCESS", `${description} is outside the allowed filesystem roots`, { path: candidate });
  }
};

export class FilesystemPolicy {
  private readonly configuredReadRoots?: readonly string[];
  private readonly configuredWriteRoots?: readonly string[];
  private readRootsPromise?: Promise<string[]>;
  private writeRootsPromise?: Promise<string[]>;

  constructor(options: FilesystemPolicyOptions = {}) {
    this.configuredReadRoots = options.readRoots;
    this.configuredWriteRoots = options.writeRoots;
  }

  private async getRoots(kind: "read" | "write"): Promise<string[] | undefined> {
    const configured = kind === "read" ? this.configuredReadRoots : this.configuredWriteRoots;
    if (!configured) return undefined;
    let promise = kind === "read" ? this.readRootsPromise : this.writeRootsPromise;
    if (!promise) {
      promise = Promise.all(configured.map((root) => fs.promises.realpath(path.resolve(root))));
      if (kind === "read") this.readRootsPromise = promise;
      else this.writeRootsPromise = promise;
    }
    return promise;
  }

  async assertReadPath(requestedPath: string): Promise<string> {
    if (!requestedPath || requestedPath.includes("\0")) {
      throw new AutomationError("INVALID_ARGUMENT", "A non-empty filesystem path is required");
    }
    const canonicalPath = await fs.promises.realpath(path.resolve(requestedPath));
    ensureWithinRoots(canonicalPath, await this.getRoots("read"), "Read path");
    return canonicalPath;
  }

  async readFile(requestedPath: string): Promise<{ path: string; bytes: Buffer }> {
    const canonicalPath = await this.assertReadPath(requestedPath);
    const stats = await fs.promises.stat(canonicalPath);
    if (!stats.isFile()) throw new AutomationError("IO_ACCESS", `Path is not a regular file: ${requestedPath}`);
    return { path: canonicalPath, bytes: await fs.promises.readFile(canonicalPath) };
  }

  async assertWritePath(requestedPath: string): Promise<string> {
    if (!requestedPath || requestedPath.includes("\0")) {
      throw new AutomationError("INVALID_ARGUMENT", "A non-empty output path is required");
    }
    const absolutePath = path.resolve(requestedPath);
    try {
      const linkStats = await fs.promises.lstat(absolutePath);
      if (linkStats.isSymbolicLink()) {
        throw new AutomationError("IO_ACCESS", "Writing through a symbolic-link output path is not allowed", {
          path: absolutePath,
        });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const canonicalPath = await realpathWithExistingParent(absolutePath);
    ensureWithinRoots(canonicalPath, await this.getRoots("write"), "Write path");
    return canonicalPath;
  }

  async assertOutputDistinctFromSources(outputPath: string, sourcePaths: readonly string[]): Promise<string> {
    const canonicalOutput = await this.assertWritePath(outputPath);
    let outputStats: fs.Stats | undefined;
    try {
      outputStats = await fs.promises.stat(canonicalOutput);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    for (const sourcePath of sourcePaths) {
      const canonicalSource = await this.assertReadPath(sourcePath);
      if (canonicalSource === canonicalOutput) {
        throw new AutomationError("CONFLICT", "Output path aliases a source file", { outputPath, sourcePath });
      }
      if (outputStats) {
        const sourceStats = await fs.promises.stat(canonicalSource);
        if (outputStats.dev === sourceStats.dev && outputStats.ino === sourceStats.ino) {
          throw new AutomationError("CONFLICT", "Output path is a hard-link alias of a source file", {
            outputPath,
            sourcePath,
          });
        }
      }
    }
    return canonicalOutput;
  }

  async assertOutputsDistinct(outputPaths: readonly string[]): Promise<void> {
    const canonicalPaths = await Promise.all(outputPaths.map((outputPath) => this.assertWritePath(outputPath)));
    for (let firstIndex = 0; firstIndex < canonicalPaths.length; firstIndex += 1) {
      const firstPath = canonicalPaths[firstIndex];
      for (let secondIndex = firstIndex + 1; secondIndex < canonicalPaths.length; secondIndex += 1) {
        const secondPath = canonicalPaths[secondIndex];
        const samePath = process.platform === "win32" ? firstPath.toLowerCase() === secondPath.toLowerCase() : firstPath === secondPath;
        if (samePath) {
          throw new AutomationError("CONFLICT", "Output paths must be distinct", { paths: [outputPaths[firstIndex], outputPaths[secondIndex]] });
        }
        const [firstStats, secondStats] = await Promise.all([
          fs.promises.stat(firstPath).catch((error: NodeJS.ErrnoException) => (error.code === "ENOENT" ? undefined : Promise.reject(error))),
          fs.promises.stat(secondPath).catch((error: NodeJS.ErrnoException) => (error.code === "ENOENT" ? undefined : Promise.reject(error))),
        ]);
        if (firstStats && secondStats && firstStats.dev === secondStats.dev && firstStats.ino === secondStats.ino) {
          throw new AutomationError("CONFLICT", "Output paths are hard-link aliases", { paths: [outputPaths[firstIndex], outputPaths[secondIndex]] });
        }
      }
    }
  }

  async withAtomicOutput<T>(options: {
    outputPath: string;
    overwrite?: boolean;
    sourcePaths?: readonly string[];
    produce: (temporaryPath: string) => Promise<void>;
    validate?: (temporaryPath: string) => Promise<void>;
  }): Promise<{ path: string; value?: T }> {
    const overwrite = options.overwrite ?? false;
    const sourcePaths = options.sourcePaths ?? [];
    const canonicalOutput = await this.assertOutputDistinctFromSources(options.outputPath, sourcePaths);
    await fs.promises.mkdir(path.dirname(canonicalOutput), { recursive: true });
    await this.assertWritePath(canonicalOutput);
    const outputStats = await fs.promises.stat(canonicalOutput).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (outputStats && !overwrite) {
      throw new AutomationError("CONFLICT", `Output already exists: ${options.outputPath}`, { path: options.outputPath });
    }
    if (outputStats && !outputStats.isFile()) {
      throw new AutomationError("IO_ACCESS", `Output is not a regular file: ${options.outputPath}`);
    }

    const temporaryPath = path.join(
      path.dirname(canonicalOutput),
      `.${path.basename(canonicalOutput)}.${process.pid}.${randomUUID()}.tmp`,
    );
    let temporaryCreated = false;
    try {
      const handle = await fs.promises.open(temporaryPath, "wx", 0o600);
      temporaryCreated = true;
      await handle.close();
      await options.produce(temporaryPath);
      await options.validate?.(temporaryPath);

      await this.assertOutputDistinctFromSources(canonicalOutput, sourcePaths);
      if (overwrite) {
        await fs.promises.rename(temporaryPath, canonicalOutput);
      } else {
        // Hard-link publication is atomic and fails if another process created the destination.
        await fs.promises.link(temporaryPath, canonicalOutput);
        await fs.promises.unlink(temporaryPath);
      }
      temporaryCreated = false;
      return { path: canonicalOutput };
    } finally {
      if (temporaryCreated) await fs.promises.unlink(temporaryPath).catch(() => undefined);
    }
  }
}

/** Validates and canonicalizes a packed-file path, independent of the host OS separator. */
export const normalizeInternalPackPath = (value: string): string => {
  if (!value || value.includes("\0") || path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || /^[a-zA-Z]:/.test(value)) {
    throw new AutomationError("INVALID_ARGUMENT", `Invalid packed-file path: ${JSON.stringify(value)}`);
  }
  const normalized = normalizePackFilePath(value);
  const segments = normalized.split("\\");
  if (segments.some((segment) => segment === "..")) {
    throw new AutomationError("INVALID_ARGUMENT", `Packed-file path cannot contain parent segments: ${value}`);
  }
  const safeSegments = segments.filter((segment) => segment !== "" && segment !== ".");
  if (safeSegments.length === 0) throw new AutomationError("INVALID_ARGUMENT", "Packed-file path cannot be empty");
  return safeSegments.join("\\");
};
