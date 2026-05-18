#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { runTraceLabHardening } from "./trace-lab-hardening/scenarios.mjs";

runTraceLabHardening().catch((error) => {
  if (error?.blocker) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
});
