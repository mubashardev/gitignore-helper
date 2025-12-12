/**
 * Cloudflare Worker for Gitignore Helper Activation
 * Checks if the provided version matches the latest allowed version.
 */

const LATEST_VERSION = "0.0.1"; // UPDATE THIS when you release a new version

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/version") {
        return new Response("Not Found", { status: 404 });
    }

    if (request.method !== "GET") {
        return new Response("Method not allowed", { status: 405 });
    }

    return new Response(JSON.stringify({ 
        latestVersion: LATEST_VERSION
    }), {
        headers: { 
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*" 
        }
    });
  },
};
