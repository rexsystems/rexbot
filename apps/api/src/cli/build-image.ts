// Builds the QEMU computer image from the command line: pnpm --filter api build-image
import "../env.js";
import { computers } from "../computer.js";

const info = computers.templateInfo();
for (const problem of info.host.problems) console.warn(`warning: ${problem}`);
const state = computers.buildTemplate(process.env.REX_QEMU_BASE_IMAGE_URL);
let printed = 0;
const timer = setInterval(() => {
  for (; printed < state.log.length; printed++) console.log(state.log[printed]);
  if (state.running) return;
  clearInterval(timer);
  if (state.error) { console.error(state.error); process.exit(1); }
  process.exit(0);
}, 500);
