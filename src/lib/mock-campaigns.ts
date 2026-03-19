import type { Campaign } from "./constants";

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
];

// ─── Helpers ────────────────────────────────────────────────────────────────

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
