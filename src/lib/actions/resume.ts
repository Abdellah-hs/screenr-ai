// @ts-nocheck
"use server";

import { createClient } from "@/lib/supabase/server";
import { PDFParse } from "pdf-parse";

export async function uploadResume(formData: FormData): Promise<{
  resume_url: string;
  resume_text: string;
}> {
  const file = formData.get("resume") as File;
  if (!file || file.size === 0) throw new Error("No file provided");
  
  // Extract text from PDF
  let resumeText = "";
  if (file.type === "application/pdf") {
    const buffer = Buffer.from(await file.arrayBuffer());
    const parser = new PDFParse({ data: buffer });
    const parsed = await parser.getText();
    resumeText = parsed.text;
  }
  
  return {
    resume_url: `mock-url-${Date.now()}`,
    resume_text: resumeText,
  };


}
