/* Lets tests import app code that uses extensionless imports (as the app's own build does). Run: node --import ./tests/ts-loader.mjs --experimental-strip-types … */
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (error) { if (/^\\.\\.?\\//.test(specifier) && !/\\.[a-z]+$/.test(specifier)) return next(specifier + ".ts", context); throw error; }
}`));
