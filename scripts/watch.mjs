import { execFileSync, spawn } from "node:child_process";
import process from "node:process";

execFileSync("npx", ["vite", "build"], { stdio: "inherit" });

const children = [
  spawn("npx", ["vite", "build", "--watch"], { stdio: "inherit" }),
  spawn("npx", ["wrangler", "dev"], { stdio: "inherit" }),
];
const stop = () => children.forEach((child) => child.kill("SIGTERM"));
for (const child of children) {
  child.on("exit", (code) => {
    stop();
    process.exitCode = code ?? 0;
  });
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
