import { NextResponse } from "next/server";
import { BOOKS } from "@/lib/books";
import { SPORTS } from "@/lib/books/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ books: BOOKS, sports: SPORTS });
}
