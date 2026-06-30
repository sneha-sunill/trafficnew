import JSZip from "jszip";

const MAX_ZIP_INPUT_BYTES = 50 * 1024 * 1024;   // 50 MB compressed
const MAX_EXTRACTED_BYTES = 200 * 1024 * 1024;  // 200 MB uncompressed
const MAX_CSV_COUNT = 500;
// Ratio of total extracted bytes to compressed zip size beyond which we consider it a zip bomb
const MAX_COMPRESSION_RATIO = 500;

export async function extractCsvFromZip(file: File): Promise<string[]> {
  if (file.size > MAX_ZIP_INPUT_BYTES) {
    throw new Error(
      `ZIP file is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max allowed: ${MAX_ZIP_INPUT_BYTES / 1024 / 1024} MB.`
    );
  }

  const buffer = await file.arrayBuffer();

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new Error("Invalid or corrupt ZIP file.");
  }

  const allEntries = Object.entries(zip.files).filter(([, entry]) => !entry.dir);

  // Reject nested ZIPs before decompressing anything
  for (const [name] of allEntries) {
    if (name.toLowerCase().endsWith(".zip")) {
      throw new Error("Nested ZIP files are not allowed.");
    }
  }

  const csvEntries = allEntries.filter(([name]) => {
    const baseName = name.split("/").pop() ?? "";
    return name.toLowerCase().endsWith(".csv") && !baseName.startsWith(".");
  });

  if (csvEntries.length === 0) {
    throw new Error("No CSV files found inside the ZIP.");
  }

  if (csvEntries.length > MAX_CSV_COUNT) {
    throw new Error(
      `ZIP contains too many CSV files (${csvEntries.length}). Max allowed: ${MAX_CSV_COUNT}.`
    );
  }

  const csvContents: string[] = [];
  let totalExtractedBytes = 0;

  for (const [, entry] of csvEntries) {
    const content = await entry.async("string");
    totalExtractedBytes += content.length;

    if (totalExtractedBytes > MAX_EXTRACTED_BYTES) {
      throw new Error(
        `ZIP contents exceed ${MAX_EXTRACTED_BYTES / 1024 / 1024} MB when extracted. Possible zip bomb — aborting.`
      );
    }

    csvContents.push(content);
  }

  // Final compression-ratio check across the whole archive
  if (file.size > 0 && totalExtractedBytes / file.size > MAX_COMPRESSION_RATIO) {
    throw new Error(
      `Suspicious compression ratio (${Math.round(totalExtractedBytes / file.size)}:1). Possible zip bomb — aborting.`
    );
  }

  return csvContents;
}
