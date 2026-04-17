import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export type ResumeExperience = {
  company: string;
  title: string;
  duration: string;
  description: string;
};

export type ResumeEducation = {
  institution: string;
  degree: string;
  graduation_year: string;
};

export type ParsedResumeData = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  location: string;
  linkedin_url: string;
  portfolio_url: string;
  skills: string[];
  experience: ResumeExperience[];
  education: ResumeEducation[];
};

/**
 * Extracts structured candidate data from raw PDF text using OpenAI
 */
export async function extractResumeData(pdfText: string): Promise<ParsedResumeData> {
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

  return JSON.parse(content) as ParsedResumeData;
}
