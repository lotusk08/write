// The app as it is deployed, on this machine: Vite rebuilds `dist` on every save and `wrangler dev` serves it with
// the Worker, so `/api` — publishing, `?edit=`, sharing — works, which plain `npm run dev` cannot do.
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
