import { hashPassword } from "../lib/auth.js";
let value = "";
for await (const chunk of process.stdin) value += chunk;
value = value.replace(/\r?\n$/, "");
if (value.length < 12 || value.length > 128) {
  console.error("Send a 12–128 character password through stdin.");
  process.exit(1);
}
console.log(await hashPassword(value));
