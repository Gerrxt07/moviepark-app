import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const version = (await readFile(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8")).trim();
    return Response.json(
      { version },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } },
    );
  } catch {
    return Response.json(
      { version: null },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
