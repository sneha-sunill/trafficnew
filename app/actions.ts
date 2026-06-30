"use server";

import { processCSVs, detectDetColumns } from "@/lib/processor";
import type { ProcessResult, DetColumnInfo } from "@/lib/processor";
import { extractCsvFromZip } from "@/lib/zip";

async function collectCsvContents(files: File[]): Promise<string[]> {
  const csvContents: string[] = [];
  for (const file of files) {
    if (file.name.toLowerCase().endsWith(".zip")) {
      const extracted = await extractCsvFromZip(file);
      csvContents.push(...extracted);
    } else {
      csvContents.push(await file.text());
    }
  }
  return csvContents;
}

export async function detectColumns(formData: FormData): Promise<DetColumnInfo> {
  const files = formData.getAll("files") as File[];
  if (!files.length) throw new Error("No files provided");
  const csvContents = await collectCsvContents(files);
  return detectDetColumns(csvContents);
}

export async function processTrafficFiles(
  formData: FormData,
  customDetGroups?: Record<string, string[]>
): Promise<ProcessResult> {
  const files = formData.getAll("files") as File[];
  if (!files.length) throw new Error("No files provided");
  const csvContents = await collectCsvContents(files);
  return processCSVs(csvContents, customDetGroups);
}
