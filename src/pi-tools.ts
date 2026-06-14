import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
  type BashToolInput,
  type EditToolInput,
  type FindToolInput,
  type GrepToolInput,
  type LsToolInput,
  type ReadToolInput,
  type WriteToolInput,
  type AgentToolResult,
} from "@earendil-works/pi-coding-agent";
import type { ServerConfig } from "./config.js";
import { assertAllowedPath, resolveAllowedPath } from "./roots.js";

type McpContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

function toMcpContent(result: AgentToolResult<unknown>): McpContent[] {
  return result.content.map((content) => {
    if (content.type === "text") {
      return { type: "text", text: content.text };
    }

    return {
      type: "image",
      data: content.data,
      mimeType: content.mimeType,
    };
  });
}

function formatToolError(error: unknown): McpContent[] {
  const message = error instanceof Error ? error.message : String(error);
  return [{ type: "text", text: message }];
}

async function runTool<TInput>(
  execute: (input: TInput) => Promise<AgentToolResult<unknown>>,
  input: TInput,
): Promise<{ content: McpContent[]; isError?: boolean }> {
  try {
    const result = await execute(input);
    return { content: toMcpContent(result) };
  } catch (error) {
    return { content: formatToolError(error), isError: true };
  }
}

function defaultCwd(config: ServerConfig): string {
  return config.allowedRoots[0] ?? process.cwd();
}

function resolveToolCwd(cwd: string | undefined, config: ServerConfig): string {
  return assertAllowedPath(cwd ?? defaultCwd(config), config.allowedRoots);
}

export async function readFileTool(
  input: ReadToolInput & { cwd?: string },
  config: ServerConfig,
): Promise<{ content: McpContent[]; isError?: boolean }> {
  const cwd = resolveToolCwd(input.cwd, config);
  const path = resolveAllowedPath(input.path, cwd, config.allowedRoots);
  const tool = createReadTool(cwd);

  return runTool((params) => tool.execute("read_file", params), {
    path,
    offset: input.offset,
    limit: input.limit,
  });
}

export async function writeFileTool(
  input: WriteToolInput & { cwd?: string },
  config: ServerConfig,
): Promise<{ content: McpContent[]; isError?: boolean }> {
  const cwd = resolveToolCwd(input.cwd, config);
  const path = resolveAllowedPath(input.path, cwd, config.allowedRoots);
  const tool = createWriteTool(cwd);

  return runTool((params) => tool.execute("write_file", params), {
    path,
    content: input.content,
  });
}

export async function editFileTool(
  input: EditToolInput & { cwd?: string },
  config: ServerConfig,
): Promise<{ content: McpContent[]; isError?: boolean }> {
  const cwd = resolveToolCwd(input.cwd, config);
  const path = resolveAllowedPath(input.path, cwd, config.allowedRoots);
  const tool = createEditTool(cwd);

  return runTool((params) => tool.execute("edit_file", params), {
    path,
    edits: input.edits,
  });
}

export async function grepFilesTool(
  input: GrepToolInput & { cwd?: string },
  config: ServerConfig,
): Promise<{ content: McpContent[]; isError?: boolean }> {
  const cwd = resolveToolCwd(input.cwd, config);
  if (input.path) resolveAllowedPath(input.path, cwd, config.allowedRoots);
  const tool = createGrepTool(cwd);

  return runTool((params) => tool.execute("grep_files", params), input);
}

export async function findFilesTool(
  input: FindToolInput & { cwd?: string },
  config: ServerConfig,
): Promise<{ content: McpContent[]; isError?: boolean }> {
  const cwd = resolveToolCwd(input.cwd, config);
  if (input.path) resolveAllowedPath(input.path, cwd, config.allowedRoots);
  const tool = createFindTool(cwd);

  return runTool((params) => tool.execute("find_files", params), input);
}

export async function listDirectoryTool(
  input: LsToolInput & { cwd?: string },
  config: ServerConfig,
): Promise<{ content: McpContent[]; isError?: boolean }> {
  const cwd = resolveToolCwd(input.cwd, config);
  if (input.path) resolveAllowedPath(input.path, cwd, config.allowedRoots);
  const tool = createLsTool(cwd);

  return runTool((params) => tool.execute("list_directory", params), input);
}

export async function runShellTool(
  input: BashToolInput & { cwd?: string },
  config: ServerConfig,
): Promise<{ content: McpContent[]; isError?: boolean }> {
  const cwd = resolveToolCwd(input.cwd, config);
  const tool = createBashTool(cwd);
  const timeout = input.timeout === undefined ? 30 : Math.min(input.timeout, 300);

  return runTool((params) => tool.execute("run_shell", params), {
    command: input.command,
    timeout,
  });
}
