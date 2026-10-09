import {
  randomBytes,
  scrypt as callbackScrypt,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(callbackScrypt);
export async function hashPassword(value) {
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(value, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt}$${hash.toString("hex")}`;
}
export async function verifyPassword(value, stored) {
  if (typeof value !== "string" || value.length > 128) return false;
  const [type, salt, encoded] = String(stored || "").split("$");
  if (type !== "scrypt" || !salt || !/^[a-f0-9]{128}$/.test(encoded || ""))
    return false;
  const hash = await scrypt(value, salt, 64, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(hash, Buffer.from(encoded, "hex"));
}
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export const sessionToken = () => randomBytes(32).toString("hex");
// Кабинет и сервер на разных доменах, поэтому сессия передаётся заголовком,
// а не cookie.
export function readBearer(headers) {
  const s = String(headers.authorization || "").match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  return s || null;
}
