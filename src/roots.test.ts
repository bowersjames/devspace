import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { assertAllowedPath, expandHomePath, resolveAllowedPath } from "./roots.js";

const home = homedir();

assert.equal(expandHomePath("~"), home);
assert.equal(expandHomePath("~/personal/pi-on-mcp"), resolve(home, "personal", "pi-on-mcp"));
assert.equal(expandHomePath("~user/project"), "~user/project");
assert.equal(expandHomePath("$HOME/project"), "$HOME/project");

assert.equal(
  assertAllowedPath("~/personal/pi-on-mcp", [join(home, "personal")]),
  resolve(home, "personal", "pi-on-mcp"),
);

assert.equal(
  assertAllowedPath("~/personal/pi-on-mcp", ["~/personal"]),
  resolve(home, "personal", "pi-on-mcp"),
);

assert.equal(
  resolveAllowedPath("~/file.txt", "/workspace", ["/workspace"]),
  resolve("/workspace", "~/file.txt"),
);
