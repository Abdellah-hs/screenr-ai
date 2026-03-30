"use server";

import { createClient } from "@/lib/supabase/server";
import { google } from "googleapis";
import { revalidatePath } from "next/cache";
import OpenAI from "openai";
// @ts-expect-error - bypassing the buggy index.js of pdf-parse that reads test files
import pdf from "pdf-parse/lib/pdf-parse.js";
import { randomUUID } from "crypto";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Extracts structured candidate data from raw PDF text using OpenAI
 */
async function extractResumeData(pdfText: string) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You are an expert ATS (Applicant Tracking System) parser. Extract the candidate's core information from the provided resume text. Return a clean, precise JSON response.",
      },
      {
        role: "user",
        content: `Extract information from this resume:\n\n${pdfText}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "resume_extraction",
        schema: {
          type: "object",
          properties: {
            first_name: { type: "string" },
            last_name: { type: "string" },
            email: { type: "string" },
            phone: { type: "string" },
            location: { type: "string" },
            linkedin_url: { type: "string" },
            portfolio_url: { type: "string" },
            skills: { type: "array", items: { type: "string" } },
            experience: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  company: { type: "string" },
                  title: { type: "string" },
                  duration: { type: "string" },
                  description: { type: "string" }
                },
                required: ["company", "title", "duration", "description"],
                additionalProperties: false
              }
            },
            education: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  institution: { type: "string" },
                  degree: { type: "string" },
                  graduation_year: { type: "string" }
                },
                required: ["institution", "degree", "graduation_year"],
                additionalProperties: false
              }
            }
          },
          required: [
            "first_name", 
            "last_name", 
            "email", 
            "phone", 
            "location", 
            "linkedin_url", 
            "portfolio_url", 
            "skills", 
            "experience", 
            "education"
          ],
          additionalProperties: false
        },
        strict: true
      }
    },
    temperature: 0.1,
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error("Failed to parse resume with OpenAI");
  
  return JSON.parse(content);
}

/**
 * Validates or initializes a simple Google OAuth2 client.
 * Note: For local testing, you need GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN in .env.local
 */
function getGmailClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Missing Google API credentials in .env.local: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN");
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId, 
    clientSecret, 
    "https://developers.google.com/oauthplayground"
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  return google.gmail({ version: "v1", auth: oauth2Client });
}

/**
 * Action to trigger syncing of resumes from a Gmail inbox
 */
export async function syncResumesFromGmail(campaignId: string) {
  try {
    const supabase = await createClient();
    
    // Auth guard
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error("Unauthorized");
    }

    const gmail = getGmailClient();
    
    // Find up to 5 recent unread emails with PDF attachments
    const res = await gmail.users.messages.list({
      userId: "me",
      q: "is:unread has:attachment filename:pdf",
      maxResults: 5,
    });

    const messages = res.data.messages || [];
    if (messages.length === 0) {
      return { success: true, count: 0, message: "No new unread resumes found in Gmail." };
    }

    let processedCount = 0;

    for (const msg of messages) {
      // Get the full message
      const msgData = await gmail.users.messages.get({
        userId: "me",
        id: msg.id!,
      });

      const parts = msgData.data.payload?.parts || [];
      const pdfParts = parts.filter(p => p.mimeType === "application/pdf" && p.filename);
      
      for (const part of pdfParts) {
        if (!part.body?.attachmentId) continue;

        // Fetch attachment data
        const attachment = await gmail.users.messages.attachments.get({
          userId: "me",
          messageId: msg.id!,
          id: part.body.attachmentId,
        });

        if (!attachment.data.data) continue;

        // Convert base64 attachment to buffer
        const fileBuffer = Buffer.from(attachment.data.data, "base64");
        
        // 1. Upload to Supabase Storage
        const fileName = `${campaignId}/${randomUUID()}-${part.filename}`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("resumes")
          .upload(fileName, fileBuffer, { contentType: "application/pdf" });

        if (uploadError) throw uploadError;

        // 2. Parse PDF to Text locally
        const parsedPdf = await pdf(fileBuffer);
        const textContent = parsedPdf.text;

        // 3. Extract JSON out of text using OpenAI
        const structuredData = await extractResumeData(textContent);

        // 4. Insert Candidate Record
        let candidateId: string;
        
        const { data: existingCandidate } = await supabase
          .from("candidates")
          .select("id")
          .eq("email", structuredData.email)
          .single();

        if (existingCandidate) {
          candidateId = existingCandidate.id;
          // Update details
          await supabase.from("candidates").update({
            first_name: structuredData.first_name,
            last_name: structuredData.last_name,
            phone: structuredData.phone || null,
            linkedin_url: structuredData.linkedin_url || null,
            portfolio_url: structuredData.portfolio_url || null,
            location: structuredData.location || null,
            updated_at: new Date().toISOString()
          }).eq("id", candidateId);
        } else {
          // Insert new
          candidateId = randomUUID();
          const { error: insertError } = await supabase
            .from("candidates")
            .insert({
              id: candidateId,
              first_name: structuredData.first_name,
              last_name: structuredData.last_name,
              email: structuredData.email,
              phone: structuredData.phone || null,
              linkedin_url: structuredData.linkedin_url || null,
              portfolio_url: structuredData.portfolio_url || null,
              location: structuredData.location || null,
            });

          if (insertError) throw insertError;
        }

        const resumeUrl = supabase.storage.from("resumes").getPublicUrl(fileName).data.publicUrl;

        // 5. Create Application link
        const { data: existingApp } = await supabase
          .from("applications")
          .select("id")
          .eq("candidate_id", candidateId)
          .eq("campaign_id", campaignId)
          .single();

        if (!existingApp) {
          await supabase.from("applications").insert({
            candidate_id: candidateId,
            campaign_id: campaignId,
            status: "new",
            resume_url: resumeUrl,
            parsed_data: structuredData,
          });
        }

        // Log to AI Audit Log
        await supabase.from("ai_audit_log").insert({
          campaign_id: campaignId,
          candidate_id: candidateId,
          stage: "resume_parsing",
          model: "gpt-4o-mini",
          prompt_version: "v1_structured_outputs",
          input_snapshot: { text_length: textContent.length, filename: part.filename },
          raw_output: JSON.stringify(structuredData),
          action_taken: "parsed_and_created_profile",
        });

        processedCount++;
      }

      // Mark the email as READ so we don't process it again
      await gmail.users.messages.modify({
        userId: "me",
        id: msg.id!,
        requestBody: {
          removeLabelIds: ["UNREAD"],
        },
      });
    }

    revalidatePath(`/campaigns/${campaignId}`);
    return { success: true, count: processedCount, message: `Successfully synced ${processedCount} resume(s) from Gmail.` };

  } catch (error) {
    console.error("Gmail Sync Error:", error);
    throw new Error(error instanceof Error ? error.message : "Failed to sync resumes from Gmail");
  }
}

// ─── Regular Fetch Functions ──────────────────────────────────────────────

export async function getCandidatesByCampaignId(campaignId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("applications")
    .select(`
      id,
      status,
      resume_score,
      screening_q_score,
      interview_score,
      parsed_data,
      created_at,
      resume_url,
      campaign_id,
      candidates (
        id,
        first_name,
        last_name,
        email,
        phone,
        location
      )
    `)
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching candidates:", error);
    return [];
  }
  
  return data.map((app: any) => ({
    id: app.id, // we map application ID as candidate trace ID here
    campaign_id: app.campaign_id,
    name: `${app.candidates.first_name} ${app.candidates.last_name}`,
    email: app.candidates.email,
    phone: app.candidates.phone,
    current_title: app.parsed_data?.experience?.[0]?.title || null,
    current_company: app.parsed_data?.experience?.[0]?.company || null,
    stage: app.status === "new" ? "applied" : app.status,
    scores: [
      // Mocking or mapping CandidateScore objects
      ...(app.resume_score ? [{
        stage: "resume",
        overall: Number(app.resume_score),
        ai_summary: "Parsed from resume",
        factors: [],
        scored_at: app.created_at
      }] : [])
    ] as any[],
    applied_at: app.created_at,
    resume_url: app.resume_url || ""
  })) as any[];
}

export async function getCandidateById(applicationId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("applications")
    .select(`
      id,
      status,
      resume_score,
      screening_q_score,
      interview_score,
      parsed_data,
      created_at,
      resume_url,
      campaign_id,
      candidates (
        id,
        first_name,
        last_name,
        email,
        phone,
        location,
        linkedin_url,
        portfolio_url
      )
    `)
    .eq("id", applicationId)
    .single();

  if (error || !data) {
    console.error("Error fetching candidate:", error);
    return null;
  }

  // Same mapping as getCandidatesByCampaignId
  const candidateRecord = data.candidates as any;
  const parsed = data.parsed_data as any;

  return {
    id: data.id,
    campaign_id: data.campaign_id,
    name: `${candidateRecord.first_name} ${candidateRecord.last_name}`,
    email: candidateRecord.email,
    phone: candidateRecord.phone,
    current_title: parsed?.experience?.[0]?.title || null,
    current_company: parsed?.experience?.[0]?.company || null,
    stage: data.status === "new" ? "applied" : data.status,
    scores: [
      ...(data.resume_score ? [{
        stage: "resume",
        overall: Number(data.resume_score),
        ai_summary: "Parsed from resume",
        factors: [],
        scored_at: data.created_at
      }] : [])
    ],
    applied_at: data.created_at,
    resume_url: data.resume_url || "",
    // Add missing resume object for UI
    resume: {
      skills: parsed?.skills || [],
      experience_years: parsed?.experience?.length || 0,
      education: parsed?.education?.[0]?.institution || "Unknown"
    },
    parsed_data: parsed,
    linkedin_url: candidateRecord.linkedin_url,
    portfolio_url: candidateRecord.portfolio_url
  } as any;
}

export async function updateCandidateStage(applicationId: string, stage: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("applications")
    .update({ status: stage as any, updated_at: new Date().toISOString() })
    .eq("id", applicationId);
    
  if (error) throw error;
}
