import { getStore } from "@netlify/blobs";
import { createApi } from "../../lib/api.mjs";

let handle;

export default async (req) => {
  handle ??= createApi({
    getStore: (name) => getStore({ name, consistency: "strong" }),
    password: process.env.ADMIN_PASSWORD,
  });
  return handle(req);
};

export const config = { path: "/api/*" };
