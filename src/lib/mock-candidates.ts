import type { Candidate } from "./constants";

// ─── Mock Candidates ────────────────────────────────────────────────────────

export const MOCK_CANDIDATES: Candidate[] = [
  // ── camp-001: Senior AI Engineer ──
  {
    id: "cand-001",
    campaign_id: "camp-001",
    name: "Aisha Patel",
    email: "aisha.patel@gmail.com",
    phone: "+1-415-555-0101",
    current_title: "Senior ML Engineer",
    current_company: "DeepMind",
    stage: "interview",
    scores: [
      {
        stage: "resume",
        overall: 88,
        tier: "strong",
        ai_summary: "Exceptional ML background with 7 years of experience. Strong publication record in NLP and hands-on LLM deployment experience at DeepMind. PhD in Computer Science from Stanford.",
        factors: [
          { name: "Technical Skills", weight: 0.35, score: 92 },
          { name: "Relevant Experience", weight: 0.3, score: 90 },
          { name: "Education", weight: 0.15, score: 95 },
          { name: "Project Impact", weight: 0.2, score: 78 },
        ],
        scored_at: "2026-03-02T10:00:00Z",
      },
      {
        stage: "screening",
        overall: 82,
        ai_summary: "Demonstrated deep understanding of transformer architectures and prompt engineering. Clearly articulated approach to building evaluation pipelines. Strong communicator.",
        factors: [
          { name: "5+ years ML/AI experience", weight: 0.3, score: 90 },
          { name: "LLM and prompt engineering", weight: 0.25, score: 85 },
          { name: "Python and TypeScript", weight: 0.2, score: 78 },
          { name: "NLP background", weight: 0.15, score: 88 },
          { name: "Startup experience", weight: 0.1, score: 55 },
        ],
        scored_at: "2026-03-05T14:00:00Z",
      },
    ],
    resume: {
      skills: ["Python", "PyTorch", "TensorFlow", "LLMs", "NLP", "Prompt Engineering", "TypeScript", "Docker"],
      experience_years: 7,
      education: "PhD Computer Science, Stanford University",
    },
    applied_at: "2026-03-01T14:30:00Z",
    updated_at: "2026-03-10T09:00:00Z",
  },
  {
    id: "cand-002",
    campaign_id: "camp-001",
    name: "James Chen",
    email: "james.chen@outlook.com",
    phone: "+1-650-555-0202",
    current_title: "AI Research Lead",
    current_company: "OpenAI",
    stage: "offer",
    scores: [
      {
        stage: "resume",
        overall: 92,
        tier: "strong",
        ai_summary: "Outstanding candidate with 9 years in AI/ML. Led multiple production LLM systems at OpenAI. Published 15+ papers. Perfect fit for the technical requirements.",
        factors: [
          { name: "Technical Skills", weight: 0.35, score: 95 },
          { name: "Relevant Experience", weight: 0.3, score: 94 },
          { name: "Education", weight: 0.15, score: 88 },
          { name: "Project Impact", weight: 0.2, score: 90 },
        ],
        scored_at: "2026-03-01T18:00:00Z",
      },
      {
        stage: "screening",
        overall: 88,
        ai_summary: "Gave highly detailed responses about model fine-tuning and RLHF techniques. Showed strong system design thinking for scalable ML pipelines.",
        factors: [
          { name: "5+ years ML/AI experience", weight: 0.3, score: 95 },
          { name: "LLM and prompt engineering", weight: 0.25, score: 92 },
          { name: "Python and TypeScript", weight: 0.2, score: 82 },
          { name: "NLP background", weight: 0.15, score: 90 },
          { name: "Startup experience", weight: 0.1, score: 70 },
        ],
        scored_at: "2026-03-04T11:00:00Z",
      },
      {
        stage: "interview",
        overall: 85,
        ai_summary: "Excellent problem-solving demonstrated in live coding. Strong system design for ML infrastructure. Very collaborative communication style. Clear leadership qualities.",
        factors: [
          { name: "Problem Solving", weight: 0.3, score: 88 },
          { name: "System Design", weight: 0.25, score: 90 },
          { name: "Communication", weight: 0.2, score: 82 },
          { name: "Cultural Fit", weight: 0.15, score: 80 },
          { name: "Leadership Potential", weight: 0.1, score: 85 },
        ],
        scored_at: "2026-03-08T16:00:00Z",
      },
    ],
    resume: {
      skills: ["Python", "C++", "LLMs", "RLHF", "Distributed Systems", "Kubernetes", "TypeScript"],
      experience_years: 9,
      education: "MS Computer Science, MIT",
    },
    applied_at: "2026-03-01T10:15:00Z",
    updated_at: "2026-03-12T10:00:00Z",
  },
  {
    id: "cand-006",
    campaign_id: "camp-001",
    name: "Marcus Williams",
    email: "marcus.w@hotmail.com",
    phone: "+1-310-555-0606",
    current_title: "Junior Developer",
    current_company: "Freelance",
    stage: "rejected",
    scores: [
      {
        stage: "resume",
        overall: 35,
        tier: "weak",
        ai_summary: "Only 2 years of experience, primarily in web development. No ML/AI background. Does not meet the mandatory requirement of 5+ years ML experience.",
        factors: [
          { name: "Technical Skills", weight: 0.35, score: 30 },
          { name: "Relevant Experience", weight: 0.3, score: 20 },
          { name: "Education", weight: 0.15, score: 55 },
          { name: "Project Impact", weight: 0.2, score: 40 },
        ],
        scored_at: "2026-03-03T15:00:00Z",
      },
    ],
    resume: {
      skills: ["JavaScript", "React", "Node.js", "CSS", "HTML"],
      experience_years: 2,
      education: "Bootcamp, General Assembly",
    },
    applied_at: "2026-03-02T20:00:00Z",
    updated_at: "2026-03-03T16:00:00Z",
  },

  // ── camp-003: Full Stack Developer ──
  {
    id: "cand-019",
    campaign_id: "camp-003",
    name: "Sophie Martinez",
    email: "sophie.m@gmail.com",
    phone: "+1-347-555-1919",
    current_title: "Full Stack Engineer",
    current_company: "Vercel",
    stage: "offer",
    scores: [
      {
        stage: "resume",
        overall: 89,
        tier: "strong",
        ai_summary: "Outstanding full-stack profile. Works at Vercel on Next.js tooling — directly relevant. 5 years experience with React, Node.js, and TypeScript. Active open-source contributor.",
        factors: [
          { name: "Technical Breadth", weight: 0.3, score: 92 },
          { name: "Project Complexity", weight: 0.3, score: 90 },
          { name: "Growth Trajectory", weight: 0.2, score: 88 },
          { name: "Open Source / Side Projects", weight: 0.2, score: 85 },
        ],
        scored_at: "2026-03-04T10:00:00Z",
      },
      {
        stage: "screening",
        overall: 86,
        ai_summary: "Clear, structured thinking demonstrated throughout. Deep technical knowledge of Next.js internals and React server components. Excellent communication and genuine enthusiasm.",
        factors: [
          { name: "Clarity of Thought", weight: 0.3, score: 88 },
          { name: "Technical Depth", weight: 0.35, score: 90 },
          { name: "Communication", weight: 0.2, score: 82 },
          { name: "Enthusiasm", weight: 0.15, score: 80 },
        ],
        scored_at: "2026-03-08T11:00:00Z",
      },
      {
        stage: "interview",
        overall: 84,
        ai_summary: "Strong live coding performance. Built a real-time feature with WebSockets cleanly. Good system design thinking. Would be an excellent addition to the platform team.",
        factors: [
          { name: "Problem Solving", weight: 0.3, score: 86 },
          { name: "System Design", weight: 0.25, score: 88 },
          { name: "Communication", weight: 0.2, score: 80 },
          { name: "Cultural Fit", weight: 0.15, score: 82 },
          { name: "Leadership Potential", weight: 0.1, score: 78 },
        ],
        scored_at: "2026-03-12T14:00:00Z",
      },
    ],
    resume: {
      skills: ["TypeScript", "React", "Next.js", "Node.js", "PostgreSQL", "Prisma", "Tailwind CSS", "WebSockets"],
      experience_years: 5,
      education: "BS Software Engineering, Columbia University",
    },
    applied_at: "2026-03-03T12:00:00Z",
    updated_at: "2026-03-14T10:00:00Z",
  },
  {
    id: "cand-022",
    campaign_id: "camp-003",
    name: "Carlos Ruiz",
    email: "carlos.ruiz@gmail.com",
    phone: "+1-718-555-2222",
    current_title: "Software Engineer",
    current_company: "Notion",
    stage: "screening",
    scores: [
      {
        stage: "resume",
        overall: 76,
        tier: "strong",
        ai_summary: "Good full-stack skills with 4 years at Notion. Strong React and TypeScript. Good database experience. Has built collaborative real-time features.",
        factors: [
          { name: "Technical Breadth", weight: 0.3, score: 78 },
          { name: "Project Complexity", weight: 0.3, score: 75 },
          { name: "Growth Trajectory", weight: 0.2, score: 80 },
          { name: "Open Source / Side Projects", weight: 0.2, score: 72 },
        ],
        scored_at: "2026-03-06T10:00:00Z",
      },
    ],
    resume: {
      skills: ["TypeScript", "React", "Node.js", "PostgreSQL", "Redis", "WebSockets", "AWS"],
      experience_years: 4,
      education: "BS Computer Science, UNAM Mexico",
    },
    applied_at: "2026-03-05T11:00:00Z",
    updated_at: "2026-03-08T10:00:00Z",
  },
  {
    id: "cand-025",
    campaign_id: "camp-003",
    name: "Emma Wilson",
    email: "emma.w@icloud.com",
    phone: "+1-917-555-2525",
    current_title: "Full Stack Developer",
    current_company: "Airbnb",
    stage: "hired",
    scores: [
      {
        stage: "resume",
        overall: 91,
        tier: "strong",
        ai_summary: "Exceptional full-stack developer with 6 years at Airbnb. Led migration to Next.js. Deep experience with real-time features and video infrastructure. Perfect match.",
        factors: [
          { name: "Technical Breadth", weight: 0.3, score: 94 },
          { name: "Project Complexity", weight: 0.3, score: 92 },
          { name: "Growth Trajectory", weight: 0.2, score: 88 },
          { name: "Open Source / Side Projects", weight: 0.2, score: 90 },
        ],
        scored_at: "2026-03-04T08:00:00Z",
      },
      {
        stage: "screening",
        overall: 90,
        ai_summary: "Exceptionally clear communicator. Deep understanding of full-stack architecture. Showed impressive knowledge of WebRTC and real-time data synchronization.",
        factors: [
          { name: "Clarity of Thought", weight: 0.3, score: 92 },
          { name: "Technical Depth", weight: 0.35, score: 92 },
          { name: "Communication", weight: 0.2, score: 88 },
          { name: "Enthusiasm", weight: 0.15, score: 85 },
        ],
        scored_at: "2026-03-07T14:00:00Z",
      },
      {
        stage: "interview",
        overall: 88,
        ai_summary: "Outstanding interview performance. Built a real-time collaborative feature in the live coding session. Excellent system design and communication. Strong hire recommendation.",
        factors: [
          { name: "Problem Solving", weight: 0.3, score: 90 },
          { name: "System Design", weight: 0.25, score: 92 },
          { name: "Communication", weight: 0.2, score: 86 },
          { name: "Cultural Fit", weight: 0.15, score: 85 },
          { name: "Leadership Potential", weight: 0.1, score: 82 },
        ],
        scored_at: "2026-03-11T15:00:00Z",
      },
    ],
    resume: {
      skills: ["TypeScript", "React", "Next.js", "Node.js", "PostgreSQL", "WebRTC", "Docker", "Kubernetes", "CI/CD"],
      experience_years: 6,
      education: "MS Software Engineering, Stanford University",
    },
    applied_at: "2026-03-03T10:00:00Z",
    updated_at: "2026-03-16T10:00:00Z",
  },
];

// ─── Candidate Helpers ──────────────────────────────────────────────────────

export function getCandidatesByCampaign(campaignId: string): Candidate[] {
  return MOCK_CANDIDATES.filter((c) => c.campaign_id === campaignId);
}

export function getCandidateByIdFromMock(id: string): Candidate | undefined {
  return MOCK_CANDIDATES.find((c) => c.id === id);
}

export function updateCandidateInMock(id: string, updates: Partial<Candidate>) {
  const index = MOCK_CANDIDATES.findIndex((c) => c.id === id);
  if (index !== -1) {
    MOCK_CANDIDATES[index] = { ...MOCK_CANDIDATES[index], ...updates };
  }
}
