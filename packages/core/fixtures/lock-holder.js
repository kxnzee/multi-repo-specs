/** @fileoverview Child process deliberately terminated while holding a persistence lock. */

import process from "node:process";
import { setInterval } from "node:timers";
import { FailClosedLock } from "@openspec-orch/core";

await new FailClosedLock().run(process.argv[2], async () => {
  setInterval(() => {}, 1000);
  process.send("locked");
  await new Promise(() => {});
});
