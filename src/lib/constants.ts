// ─── Campaign Types ──────────────────────────────────────────────────────────

export type CampaignStatus = "draft" | "active" | "paused" | "closed" | "archived";
export type AutomationMode = "fully_auto" | "human_in_loop";
export type InterviewPersona = "neutral" | "pressure" | "collaborative" | "socratic";
export type ReviewerRole = "lead" | "reviewer" | "observer";
export type PipelineStage = "resume" | "screening_q" | "interview";

export interface ScreeningCriterion {
  id: string;
  label: string;
  weight: number;
  is_mandatory: boolean;
}

export interface RubricDimension {
  id: string;
  name: string;
  weight: number;
  is_mandatory: boolean;
  min_score: number;
  max_score: number;
  sort_order: number;
}

export interface EvaluationRubric {
  id: string;
  campaign_id: string;
  stage: PipelineStage;
  version: number;
  is_active: boolean;
  dimensions: RubricDimension[];
  created_at: string;
  archived_at: string | null;
}

export interface CampaignReviewer {
  id: string;
  user_id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  role: ReviewerRole;
  assigned_at: string;
}

export interface SlaTimer {
  stage: PipelineStage | "applied" | "offer" | "hired";
  time_limit_hours: number;
  alert_threshold_hours: number;
  escalation_threshold_hours: number;
}

export interface PipelineStageCount {
  name: string;
  key: string;
  count: number;
}

export interface Campaign {
  id: string;
  title: string;
  description: string;
  department: string | null;
  positions: number;
  status: CampaignStatus;
  deadline: string | null;
  location: string | null;
  timezone: string | null;
  automation_mode: AutomationMode;
  screening_threshold: number;
  interview_persona: InterviewPersona;
  screening_criteria: ScreeningCriterion[];
  rubrics: EvaluationRubric[];
  reviewers: CampaignReviewer[];
  sla_timers: SlaTimer[];
  pipeline: PipelineStageCount[];
  user_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// ─── Status Config ───────────────────────────────────────────────────────────

export const CAMPAIGN_STATUSES: { value: CampaignStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "closed", label: "Closed" },
  { value: "archived", label: "Archived" },
];

export const STATUS_COLORS: Record<CampaignStatus, string> = {
  draft: "bg-gray-100 text-gray-700",
  active: "bg-green-100 text-green-700",
  paused: "bg-amber-100 text-amber-700",
  closed: "bg-red-100 text-red-700",
  archived: "bg-slate-100 text-slate-500",
};

/** Valid status transitions — key can move to any value in the array */
export const STATUS_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ["active", "archived"],
  active: ["paused", "closed"],
  paused: ["active", "closed"],
  closed: ["archived"],
  archived: [],
};

export const AUTOMATION_MODES: { value: AutomationMode; label: string; description: string }[] = [
  { value: "fully_auto", label: "Fully Automatic", description: "AI handles the entire pipeline autonomously" },
  { value: "human_in_loop", label: "Human-in-the-Loop", description: "Manager reviews and approves at each stage" },
];

export const INTERVIEW_PERSONAS: { value: InterviewPersona; label: string; description: string }[] = [
  { value: "neutral", label: "Neutral", description: "Balanced and professional tone" },
  { value: "pressure", label: "Pressure", description: "Tests composure under challenging questions" },
  { value: "collaborative", label: "Collaborative", description: "Warm, conversational problem-solving style" },
  { value: "socratic", label: "Socratic", description: "Guided questioning to reveal depth of knowledge" },
];

export const PIPELINE_STAGES: { name: string; key: string }[] = [
  { name: "Applied", key: "applied" },
  { name: "Screening", key: "screening" },
  { name: "Interview", key: "interview" },
  { name: "Offer", key: "offer" },
  { name: "Hired", key: "hired" },
];

// ─── Mock Data ───────────────────────────────────────────────────────────────

const MOCK_USER_ID = "user-001";

export let MOCK_CAMPAIGNS: Campaign[] = [
  {
    id: "camp-001",
    title: "Senior AI Engineer",
    description:
      "We're looking for an experienced AI/ML engineer to lead development of our core screening and interview intelligence systems. You'll work directly with the founding team to design, train, and deploy models that power automated candidate evaluation.\n\nRequirements:\n- 5+ years in ML/AI engineering\n- Experience with LLMs (Claude, GPT) and prompt engineering\n- Strong Python and TypeScript skills\n- Background in NLP, speech processing, or video analysis is a plus",
    department: "Engineering",
    positions: 1,
    status: "active",
    deadline: "2026-05-01",
    location: "Remote",
    timezone: "UTC",
    automation_mode: "human_in_loop",
    screening_threshold: 70,
    interview_persona: "socratic",
    screening_criteria: [
      { id: "sc-001", label: "5+ years ML/AI experience", weight: 0.3, is_mandatory: true },
      { id: "sc-002", label: "LLM and prompt engineering expertise", weight: 0.25, is_mandatory: true },
      { id: "sc-003", label: "Python and TypeScript proficiency", weight: 0.2, is_mandatory: true },
      { id: "sc-004", label: "NLP or speech processing background", weight: 0.15, is_mandatory: false },
      { id: "sc-005", label: "Startup experience", weight: 0.1, is_mandatory: false },
    ],
    rubrics: [
      {
        id: "rub-001",
        campaign_id: "camp-001",
        stage: "resume",
        version: 1,
        is_active: true,
        dimensions: [
          { id: "dim-001", name: "Technical Skills", weight: 0.35, is_mandatory: true, min_score: 0, max_score: 100, sort_order: 1 },
          { id: "dim-002", name: "Relevant Experience", weight: 0.3, is_mandatory: true, min_score: 0, max_score: 100, sort_order: 2 },
          { id: "dim-003", name: "Education", weight: 0.15, is_mandatory: false, min_score: 0, max_score: 100, sort_order: 3 },
          { id: "dim-004", name: "Project Impact", weight: 0.2, is_mandatory: false, min_score: 0, max_score: 100, sort_order: 4 },
        ],
        created_at: "2026-03-01T10:00:00Z",
        archived_at: null,
      },
      {
        id: "rub-002",
        campaign_id: "camp-001",
        stage: "interview",
        version: 1,
        is_active: true,
        dimensions: [
          { id: "dim-005", name: "Problem Solving", weight: 0.3, is_mandatory: true, min_score: 0, max_score: 100, sort_order: 1 },
          { id: "dim-006", name: "System Design", weight: 0.25, is_mandatory: true, min_score: 0, max_score: 100, sort_order: 2 },
          { id: "dim-007", name: "Communication", weight: 0.2, is_mandatory: true, min_score: 0, max_score: 100, sort_order: 3 },
          { id: "dim-008", name: "Cultural Fit", weight: 0.15, is_mandatory: false, min_score: 0, max_score: 100, sort_order: 4 },
          { id: "dim-009", name: "Leadership Potential", weight: 0.1, is_mandatory: false, min_score: 0, max_score: 100, sort_order: 5 },
        ],
        created_at: "2026-03-01T10:00:00Z",
        archived_at: null,
      },
    ],
    reviewers: [
      { id: "rev-001", user_id: "user-002", name: "Sarah Chen", email: "sarah@screenr.ai", avatar_url: null, role: "lead", assigned_at: "2026-03-01T10:00:00Z" },
      { id: "rev-002", user_id: "user-003", name: "Marcus Johnson", email: "marcus@screenr.ai", avatar_url: null, role: "reviewer", assigned_at: "2026-03-02T14:30:00Z" },
    ],
    sla_timers: [
      { stage: "applied", time_limit_hours: 48, alert_threshold_hours: 36, escalation_threshold_hours: 44 },
      { stage: "screening_q", time_limit_hours: 72, alert_threshold_hours: 48, escalation_threshold_hours: 66 },
      { stage: "interview", time_limit_hours: 120, alert_threshold_hours: 96, escalation_threshold_hours: 110 },
    ],
    pipeline: [
      { name: "Applied", key: "applied", count: 42 },
      { name: "Screening", key: "screening", count: 18 },
      { name: "Interview", key: "interview", count: 6 },
      { name: "Offer", key: "offer", count: 2 },
      { name: "Hired", key: "hired", count: 0 },
    ],
    user_id: MOCK_USER_ID,
    created_at: "2026-03-01T10:00:00Z",
    updated_at: "2026-03-15T09:20:00Z",
    deleted_at: null,
  },
  {
    id: "camp-002",
    title: "Product Marketing Manager",
    description:
      "Seeking a creative PMM to own go-to-market strategy for Screenr AI. You'll craft positioning, launch campaigns, and build the brand narrative that brings our AI-powered hiring platform to market.\n\nRequirements:\n- 3+ years in B2B SaaS product marketing\n- Experience with product launches and messaging frameworks\n- Strong writing skills and data-driven mindset\n- HR-tech or AI industry knowledge preferred",
    department: "Marketing",
    positions: 2,
    status: "draft",
    deadline: "2026-06-15",
    location: "San Francisco, CA",
    timezone: "America/Los_Angeles",
    automation_mode: "human_in_loop",
    screening_threshold: 60,
    interview_persona: "collaborative",
    screening_criteria: [
      { id: "sc-006", label: "B2B SaaS marketing experience", weight: 0.3, is_mandatory: true },
      { id: "sc-007", label: "Product launch track record", weight: 0.25, is_mandatory: true },
      { id: "sc-008", label: "Content and copywriting skills", weight: 0.25, is_mandatory: false },
      { id: "sc-009", label: "HR-tech or AI domain knowledge", weight: 0.2, is_mandatory: false },
    ],
    rubrics: [
      {
        id: "rub-003",
        campaign_id: "camp-002",
        stage: "resume",
        version: 1,
        is_active: true,
        dimensions: [
          { id: "dim-010", name: "Marketing Experience", weight: 0.35, is_mandatory: true, min_score: 0, max_score: 100, sort_order: 1 },
          { id: "dim-011", name: "Writing Quality", weight: 0.3, is_mandatory: true, min_score: 0, max_score: 100, sort_order: 2 },
          { id: "dim-012", name: "Industry Knowledge", weight: 0.2, is_mandatory: false, min_score: 0, max_score: 100, sort_order: 3 },
          { id: "dim-013", name: "Portfolio Strength", weight: 0.15, is_mandatory: false, min_score: 0, max_score: 100, sort_order: 4 },
        ],
        created_at: "2026-03-05T14:00:00Z",
        archived_at: null,
      },
    ],
    reviewers: [
      { id: "rev-003", user_id: "user-004", name: "Emily Nguyen", email: "emily@screenr.ai", avatar_url: null, role: "lead", assigned_at: "2026-03-05T14:00:00Z" },
    ],
    sla_timers: [
      { stage: "applied", time_limit_hours: 48, alert_threshold_hours: 36, escalation_threshold_hours: 44 },
      { stage: "screening_q", time_limit_hours: 96, alert_threshold_hours: 72, escalation_threshold_hours: 88 },
    ],
    pipeline: [
      { name: "Applied", key: "applied", count: 0 },
      { name: "Screening", key: "screening", count: 0 },
      { name: "Interview", key: "interview", count: 0 },
      { name: "Offer", key: "offer", count: 0 },
      { name: "Hired", key: "hired", count: 0 },
    ],
    user_id: MOCK_USER_ID,
    created_at: "2026-03-05T14:00:00Z",
    updated_at: "2026-03-05T14:00:00Z",
    deleted_at: null,
  },
  {
    id: "camp-003",
    title: "Full Stack Developer",
    description:
      "Join our core platform team building the next-generation ATS. You'll ship features across the entire stack — from React UIs to PostgreSQL migrations to real-time video infrastructure.\n\nRequirements:\n- 3+ years full-stack experience (React + Node/Next.js)\n- Strong TypeScript and SQL skills\n- Experience with real-time systems (WebSockets, WebRTC) is a plus\n- Comfortable with CI/CD, Docker, and cloud infrastructure",
    department: "Engineering",
    positions: 3,
    status: "active",
    deadline: "2026-04-30",
    location: "New York, NY",
    timezone: "America/New_York",
    automation_mode: "fully_auto",
    screening_threshold: 65,
    interview_persona: "neutral",
    screening_criteria: [
      { id: "sc-010", label: "React and Next.js proficiency", weight: 0.3, is_mandatory: true },
      { id: "sc-011", label: "TypeScript and SQL skills", weight: 0.25, is_mandatory: true },
      { id: "sc-012", label: "Full-stack project ownership", weight: 0.2, is_mandatory: true },
      { id: "sc-013", label: "Real-time systems experience", weight: 0.15, is_mandatory: false },
      { id: "sc-014", label: "DevOps and Docker knowledge", weight: 0.1, is_mandatory: false },
    ],
    rubrics: [
      {
        id: "rub-004",
        campaign_id: "camp-003",
        stage: "resume",
        version: 1,
        is_active: true,
        dimensions: [
          { id: "dim-014", name: "Technical Breadth", weight: 0.3, is_mandatory: true, min_score: 0, max_score: 100, sort_order: 1 },
          { id: "dim-015", name: "Project Complexity", weight: 0.3, is_mandatory: true, min_score: 0, max_score: 100, sort_order: 2 },
          { id: "dim-016", name: "Growth Trajectory", weight: 0.2, is_mandatory: false, min_score: 0, max_score: 100, sort_order: 3 },
          { id: "dim-017", name: "Open Source / Side Projects", weight: 0.2, is_mandatory: false, min_score: 0, max_score: 100, sort_order: 4 },
        ],
        created_at: "2026-03-03T09:00:00Z",
        archived_at: null,
      },
      {
        id: "rub-005",
        campaign_id: "camp-003",
        stage: "screening_q",
        version: 1,
        is_active: true,
        dimensions: [
          { id: "dim-018", name: "Clarity of Thought", weight: 0.3, is_mandatory: true, min_score: 0, max_score: 100, sort_order: 1 },
          { id: "dim-019", name: "Technical Depth", weight: 0.35, is_mandatory: true, min_score: 0, max_score: 100, sort_order: 2 },
          { id: "dim-020", name: "Communication", weight: 0.2, is_mandatory: false, min_score: 0, max_score: 100, sort_order: 3 },
          { id: "dim-021", name: "Enthusiasm", weight: 0.15, is_mandatory: false, min_score: 0, max_score: 100, sort_order: 4 },
        ],
        created_at: "2026-03-03T09:00:00Z",
        archived_at: null,
      },
    ],
    reviewers: [
      { id: "rev-004", user_id: "user-002", name: "Sarah Chen", email: "sarah@screenr.ai", avatar_url: null, role: "lead", assigned_at: "2026-03-03T09:00:00Z" },
      { id: "rev-005", user_id: "user-005", name: "Alex Rivera", email: "alex@screenr.ai", avatar_url: null, role: "reviewer", assigned_at: "2026-03-03T12:00:00Z" },
      { id: "rev-006", user_id: "user-006", name: "Priya Patel", email: "priya@screenr.ai", avatar_url: null, role: "observer", assigned_at: "2026-03-04T08:00:00Z" },
    ],
    sla_timers: [
      { stage: "applied", time_limit_hours: 24, alert_threshold_hours: 18, escalation_threshold_hours: 22 },
      { stage: "screening_q", time_limit_hours: 72, alert_threshold_hours: 48, escalation_threshold_hours: 66 },
      { stage: "interview", time_limit_hours: 96, alert_threshold_hours: 72, escalation_threshold_hours: 88 },
    ],
    pipeline: [
      { name: "Applied", key: "applied", count: 87 },
      { name: "Screening", key: "screening", count: 34 },
      { name: "Interview", key: "interview", count: 12 },
      { name: "Offer", key: "offer", count: 3 },
      { name: "Hired", key: "hired", count: 1 },
    ],
    user_id: MOCK_USER_ID,
    created_at: "2026-03-03T09:00:00Z",
    updated_at: "2026-03-16T11:45:00Z",
    deleted_at: null,
  },
  {
    id: "camp-004",
    title: "Customer Success Representative",
    description:
      "Help our enterprise clients succeed with the Screenr AI platform. You'll onboard new accounts, run training sessions, and serve as the voice of the customer back to product and engineering.\n\nRequirements:\n- 2+ years in customer success or account management\n- Experience in B2B SaaS, ideally HR-tech\n- Strong presentation and communication skills\n- Comfortable with data analysis and reporting",
    department: "Customer Success",
    positions: 5,
    status: "closed",
    deadline: "2026-02-01",
    location: "Remote",
    timezone: "UTC",
    automation_mode: "human_in_loop",
    screening_threshold: 55,
    interview_persona: "collaborative",
    screening_criteria: [
      { id: "sc-015", label: "Customer-facing experience", weight: 0.3, is_mandatory: true },
      { id: "sc-016", label: "B2B SaaS background", weight: 0.25, is_mandatory: true },
      { id: "sc-017", label: "Presentation skills", weight: 0.25, is_mandatory: false },
      { id: "sc-018", label: "Data analysis ability", weight: 0.2, is_mandatory: false },
    ],
    rubrics: [],
    reviewers: [
      { id: "rev-007", user_id: "user-007", name: "Jordan Kim", email: "jordan@screenr.ai", avatar_url: null, role: "lead", assigned_at: "2026-01-10T10:00:00Z" },
    ],
    sla_timers: [
      { stage: "applied", time_limit_hours: 48, alert_threshold_hours: 36, escalation_threshold_hours: 44 },
    ],
    pipeline: [
      { name: "Applied", key: "applied", count: 156 },
      { name: "Screening", key: "screening", count: 63 },
      { name: "Interview", key: "interview", count: 22 },
      { name: "Offer", key: "offer", count: 8 },
      { name: "Hired", key: "hired", count: 5 },
    ],
    user_id: MOCK_USER_ID,
    created_at: "2026-01-10T10:00:00Z",
    updated_at: "2026-02-15T16:00:00Z",
    deleted_at: null,
  },
  {
    id: "camp-005",
    title: "UX Designer",
    description:
      "Design intuitive, accessible experiences for both hiring managers and candidates. You'll own the design system, run user research sessions, and collaborate closely with engineering to ship polished interfaces.\n\nRequirements:\n- 3+ years in product design (B2B SaaS preferred)\n- Strong Figma skills and design system experience\n- User research and usability testing expertise\n- Understanding of accessibility standards (WCAG 2.1 AA)",
    department: "Design",
    positions: 1,
    status: "paused",
    deadline: "2026-05-15",
    location: "Remote",
    timezone: "UTC",
    automation_mode: "human_in_loop",
    screening_threshold: 75,
    interview_persona: "neutral",
    screening_criteria: [
      { id: "sc-019", label: "Product design experience (B2B SaaS)", weight: 0.3, is_mandatory: true },
      { id: "sc-020", label: "Design system expertise", weight: 0.25, is_mandatory: true },
      { id: "sc-021", label: "User research skills", weight: 0.25, is_mandatory: false },
      { id: "sc-022", label: "Accessibility knowledge", weight: 0.2, is_mandatory: false },
    ],
    rubrics: [
      {
        id: "rub-006",
        campaign_id: "camp-005",
        stage: "resume",
        version: 2,
        is_active: true,
        dimensions: [
          { id: "dim-022", name: "Portfolio Quality", weight: 0.4, is_mandatory: true, min_score: 0, max_score: 100, sort_order: 1 },
          { id: "dim-023", name: "Design Process", weight: 0.3, is_mandatory: true, min_score: 0, max_score: 100, sort_order: 2 },
          { id: "dim-024", name: "Industry Fit", weight: 0.15, is_mandatory: false, min_score: 0, max_score: 100, sort_order: 3 },
          { id: "dim-025", name: "Accessibility Focus", weight: 0.15, is_mandatory: false, min_score: 0, max_score: 100, sort_order: 4 },
        ],
        created_at: "2026-03-12T08:00:00Z",
        archived_at: null,
      },
      {
        id: "rub-006-v1",
        campaign_id: "camp-005",
        stage: "resume",
        version: 1,
        is_active: false,
        dimensions: [
          { id: "dim-026", name: "Portfolio Quality", weight: 0.5, is_mandatory: true, min_score: 0, max_score: 100, sort_order: 1 },
          { id: "dim-027", name: "Experience Years", weight: 0.3, is_mandatory: true, min_score: 0, max_score: 100, sort_order: 2 },
          { id: "dim-028", name: "Tools Proficiency", weight: 0.2, is_mandatory: false, min_score: 0, max_score: 100, sort_order: 3 },
        ],
        created_at: "2026-03-08T08:00:00Z",
        archived_at: "2026-03-12T08:00:00Z",
      },
    ],
    reviewers: [
      { id: "rev-008", user_id: "user-004", name: "Emily Nguyen", email: "emily@screenr.ai", avatar_url: null, role: "lead", assigned_at: "2026-03-08T08:00:00Z" },
      { id: "rev-009", user_id: "user-002", name: "Sarah Chen", email: "sarah@screenr.ai", avatar_url: null, role: "reviewer", assigned_at: "2026-03-08T10:00:00Z" },
    ],
    sla_timers: [
      { stage: "applied", time_limit_hours: 48, alert_threshold_hours: 36, escalation_threshold_hours: 44 },
      { stage: "screening_q", time_limit_hours: 72, alert_threshold_hours: 48, escalation_threshold_hours: 66 },
      { stage: "interview", time_limit_hours: 120, alert_threshold_hours: 96, escalation_threshold_hours: 110 },
    ],
    pipeline: [
      { name: "Applied", key: "applied", count: 29 },
      { name: "Screening", key: "screening", count: 11 },
      { name: "Interview", key: "interview", count: 4 },
      { name: "Offer", key: "offer", count: 0 },
      { name: "Hired", key: "hired", count: 0 },
    ],
    user_id: MOCK_USER_ID,
    created_at: "2026-03-08T08:00:00Z",
    updated_at: "2026-03-14T10:30:00Z",
    deleted_at: null,
  },
  {
    id: "camp-006",
    title: "Data Analyst Intern",
    description:
      "Summer internship focused on hiring analytics. You'll build dashboards, analyze pipeline conversion rates, and help the team make data-driven decisions about our screening algorithms.\n\nRequirements:\n- Pursuing a degree in Data Science, Statistics, or related field\n- Proficiency in SQL and Python (pandas, matplotlib)\n- Familiarity with BI tools (Metabase, Looker, or similar)\n- Strong analytical and communication skills",
    department: "Data",
    positions: 2,
    status: "active",
    deadline: "2026-04-15",
    location: "New York, NY",
    timezone: "America/New_York",
    automation_mode: "fully_auto",
    screening_threshold: 50,
    interview_persona: "collaborative",
    screening_criteria: [
      { id: "sc-023", label: "SQL proficiency", weight: 0.3, is_mandatory: true },
      { id: "sc-024", label: "Python data analysis skills", weight: 0.3, is_mandatory: true },
      { id: "sc-025", label: "BI tools familiarity", weight: 0.2, is_mandatory: false },
      { id: "sc-026", label: "Academic performance", weight: 0.2, is_mandatory: false },
    ],
    rubrics: [],
    reviewers: [
      { id: "rev-010", user_id: "user-003", name: "Marcus Johnson", email: "marcus@screenr.ai", avatar_url: null, role: "lead", assigned_at: "2026-03-10T09:00:00Z" },
    ],
    sla_timers: [
      { stage: "applied", time_limit_hours: 24, alert_threshold_hours: 18, escalation_threshold_hours: 22 },
    ],
    pipeline: [
      { name: "Applied", key: "applied", count: 64 },
      { name: "Screening", key: "screening", count: 28 },
      { name: "Interview", key: "interview", count: 8 },
      { name: "Offer", key: "offer", count: 0 },
      { name: "Hired", key: "hired", count: 0 },
    ],
    user_id: MOCK_USER_ID,
    created_at: "2026-03-10T09:00:00Z",
    updated_at: "2026-03-16T15:00:00Z",
    deleted_at: null,
  },
];

// ─── Helper to look up campaigns ─────────────────────────────────────────────

export function getCampaignByIdFromMock(id: string): Campaign | undefined {
  return MOCK_CAMPAIGNS.find((c) => c.id === id && c.deleted_at === null);
}

export function getActiveCampaignsFromMock(): Campaign[] {
  return MOCK_CAMPAIGNS.filter((c) => c.deleted_at === null);
}

export function updateCampaignInMock(id: string, updates: Partial<Campaign>) {
  const index = MOCK_CAMPAIGNS.findIndex((c) => c.id === id);
  if (index !== -1) {
    MOCK_CAMPAIGNS[index] = { ...MOCK_CAMPAIGNS[index], ...updates };
  }
}

export function createCampaignInMock(campaign: Campaign) {
  MOCK_CAMPAIGNS = [campaign, ...MOCK_CAMPAIGNS];
}
