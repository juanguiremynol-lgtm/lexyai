import { create } from "https://deno.land/x/djwt@v3.0.2/mod.ts";
const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(Deno.args[0]), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
console.log(await create({ alg: "HS256", typ: "JWT" }, { role: Deno.args[1], iss: "itest", exp: 4102444800 }, key));
