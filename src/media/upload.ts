import fs from "node:fs";
import path from "node:path";

/**
 * Upload a local file to tmpfiles.org and return a direct download URL.
 * Files are automatically deleted after 60 minutes.
 */
export async function uploadToTmpFiles(filePath: string): Promise<string> {
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  const formData = new FormData();
  formData.append("file", new Blob([fileBuffer]), fileName);

  const response = await fetch("https://tmpfiles.org/api/v1/upload", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`tmpfiles.org upload failed: HTTP ${response.status}`);
  }

  const result = (await response.json()) as {
    status: string;
    data?: { url?: string };
  };

  if (result.status !== "success" || !result.data?.url) {
    throw new Error(`tmpfiles.org upload failed: ${JSON.stringify(result)}`);
  }

  // tmpfiles.org returns URLs like https://tmpfiles.org/12345/file.jpg
  // The direct download URL requires /dl/ prefix: https://tmpfiles.org/dl/12345/file.jpg
  const uploadUrl = result.data.url;
  const dlUrl = uploadUrl
    .replace("tmpfiles.org/", "tmpfiles.org/dl/")
    .replace(/^http:\/\//, "https://");

  return dlUrl;
}
