import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Request, Response } from "express";
import * as z from "zod/v4";
import { loadConfig, type ServerConfig } from "./config.js";
import {
  editFileTool,
  findFilesTool,
  grepFilesTool,
  listDirectoryTool,
  readFileTool,
  runShellTool,
  writeFileTool,
} from "./pi-tools.js";

type Transport = StreamableHTTPServerTransport;

interface RunningServer {
  app: ReturnType<typeof createMcpExpressApp>;
  config: ServerConfig;
}

function isAuthorized(req: Request, config: ServerConfig): boolean {
  if (!config.authToken) return true;

  const authorization = req.header("authorization");
  return authorization === `Bearer ${config.authToken}`;
}

function sendJsonRpcError(res: Response, status: number, code: number, message: string): void {
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code, message },
    id: null,
  });
}

function createMcpServer(config: ServerConfig): McpServer {
  const server = new McpServer({
    name: "pi-on-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "server_info",
    {
      title: "Server info",
      description: "Return basic information about this local pi-on-mcp server.",
      inputSchema: {},
    },
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              name: "pi-on-mcp",
              allowedRoots: config.allowedRoots,
              mutationToolsEnabled: true,
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.registerTool(
    "read_file",
    {
      title: "Read file",
      description: "Read a file from an allowed local root.",
      inputSchema: {
        path: z.string().describe("File path to read, relative to cwd or absolute within an allowed root."),
        cwd: z.string().optional().describe("Working directory within an allowed root."),
        offset: z.number().int().positive().optional().describe("1-indexed line number to start reading from."),
        limit: z.number().int().positive().optional().describe("Maximum number of lines to read."),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) => readFileTool(input, config),
  );

  server.registerTool(
    "write_file",
    {
      title: "Write file",
      description: "Write a complete file under an allowed local root.",
      inputSchema: {
        path: z.string().describe("File path to write, relative to cwd or absolute within an allowed root."),
        cwd: z.string().optional().describe("Working directory within an allowed root."),
        content: z.string().describe("Complete new file content."),
      },
      annotations: { destructiveHint: true },
    },
    async (input) => writeFileTool(input, config),
  );

  server.registerTool(
    "edit_file",
    {
      title: "Edit file",
      description: "Edit one file by replacing exact text blocks under an allowed local root.",
      inputSchema: {
        path: z.string().describe("File path to edit, relative to cwd or absolute within an allowed root."),
        cwd: z.string().optional().describe("Working directory within an allowed root."),
        edits: z
          .array(
            z.object({
              oldText: z.string().describe("Exact text to replace. Must match uniquely in the original file."),
              newText: z.string().describe("Replacement text."),
            }),
          )
          .min(1),
      },
      annotations: { destructiveHint: true },
    },
    async (input) => editFileTool(input, config),
  );

  server.registerTool(
    "grep_files",
    {
      title: "Grep files",
      description: "Search file contents under an allowed local root.",
      inputSchema: {
        pattern: z.string().describe("Search pattern."),
        cwd: z.string().optional().describe("Working directory within an allowed root."),
        path: z.string().optional().describe("Optional path or glob scope relative to cwd."),
        include: z.string().optional().describe("Optional include glob."),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) => grepFilesTool(input, config),
  );

  server.registerTool(
    "find_files",
    {
      title: "Find files",
      description: "Find files by glob pattern under an allowed local root.",
      inputSchema: {
        pattern: z.string().describe("File glob pattern."),
        cwd: z.string().optional().describe("Working directory within an allowed root."),
        path: z.string().optional().describe("Optional path scope relative to cwd."),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) => findFilesTool(input, config),
  );

  server.registerTool(
    "list_directory",
    {
      title: "List directory",
      description: "List a directory under an allowed local root.",
      inputSchema: {
        path: z.string().describe("Directory path to list, relative to cwd or absolute within an allowed root."),
        cwd: z.string().optional().describe("Working directory within an allowed root."),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) => listDirectoryTool(input, config),
  );

  server.registerTool(
    "run_shell",
    {
      title: "Run shell",
      description:
        "Run a shell command in an allowed working directory. This is powerful local execution and should only be exposed behind strong authentication.",
      inputSchema: {
        command: z.string().describe("Shell command to run."),
        cwd: z.string().optional().describe("Working directory within an allowed root."),
        timeout: z.number().positive().max(300).optional().describe("Timeout in seconds. Defaults to 30, max 300."),
      },
      annotations: { destructiveHint: true },
    },
    async (input) => runShellTool(input, config),
  );

  return server;
}

export function createServer(config = loadConfig()): RunningServer {
  const app = createMcpExpressApp({
    host: config.host,
    allowedHosts: [config.host, "localhost", "127.0.0.1"],
  });
  const transports = new Map<string, Transport>();

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, name: "pi-on-mcp" });
  });

  app.all("/mcp", async (req, res) => {
    if (!isAuthorized(req, config)) {
      sendJsonRpcError(res, 401, -32001, "Unauthorized");
      return;
    }

    try {
      const sessionId = req.header("mcp-session-id");
      let transport: Transport | undefined;

      if (sessionId) {
        transport = transports.get(sessionId);
        if (!transport) {
          sendJsonRpcError(res, 404, -32000, "Unknown MCP session");
          return;
        }
      } else if (req.method === "POST" && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            if (transport) transports.set(newSessionId, transport);
          },
        });

        transport.onclose = () => {
          const closedSessionId = transport?.sessionId;
          if (closedSessionId) transports.delete(closedSessionId);
        };

        const server = createMcpServer(config);
        await server.connect(transport);
      } else {
        sendJsonRpcError(res, 400, -32000, "No valid MCP session");
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("Error handling MCP request", error);
      if (!res.headersSent) {
        sendJsonRpcError(res, 500, -32603, "Internal server error");
      }
    }
  });

  return { app, config };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { app, config } = createServer();
  app.listen(config.port, config.host, () => {
    console.log(`pi-on-mcp listening on http://${config.host}:${config.port}/mcp`);
    console.log(`allowed roots: ${config.allowedRoots.join(", ")}`);
    console.log(config.authToken ? "auth: bearer token required" : "auth: disabled");
  });
}
