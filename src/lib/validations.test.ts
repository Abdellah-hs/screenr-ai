import { describe, it, expect } from 'vitest';
import {
  uuidSchema,
  campaignFormSchema,
  availabilityRuleSchema,
  parseCampaignFormData,
  applicationStateSchema,
  stageChangeRationaleSchema,
  applyApplicantSchema,
  generateDescriptionSchema,
  socialPostSchema,
} from './validations';

describe('generateDescriptionSchema', () => {
  it('accepts a generate request with just a title', () => {
    const result = generateDescriptionSchema.safeParse({ mode: 'generate', title: 'Backend Engineer' });
    expect(result.success).toBe(true);
  });

  it('rejects a missing/empty title', () => {
    const result = generateDescriptionSchema.safeParse({ mode: 'generate', title: '' });
    expect(result.success).toBe(false);
  });

  it('rejects an improve request with no current draft', () => {
    const result = generateDescriptionSchema.safeParse({ mode: 'improve', title: 'Backend Engineer' });
    expect(result.success).toBe(false);
  });

  it('accepts an improve request that carries a draft', () => {
    const result = generateDescriptionSchema.safeParse({
      mode: 'improve',
      title: 'Backend Engineer',
      currentDraft: 'some existing text',
    });
    expect(result.success).toBe(true);
  });
});

describe('socialPostSchema', () => {
  const valid = { title: 'Backend Engineer', description: 'Build APIs.' };

  it('accepts a minimal title + description', () => {
    expect(socialPostSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects an empty title or description', () => {
    expect(socialPostSchema.safeParse({ ...valid, title: '' }).success).toBe(false);
    expect(socialPostSchema.safeParse({ ...valid, description: '' }).success).toBe(false);
  });

  it('rejects an unknown tone', () => {
    expect(socialPostSchema.safeParse({ ...valid, tone: 'sarcastic' }).success).toBe(false);
  });
});

describe('uuidSchema', () => {
  it('accepts a valid v4 UUID', () => {
    const result = uuidSchema.safeParse('550e8400-e29b-41d4-a716-446655440000');
    expect(result.success).toBe(true);
  });

  it('rejects a non-UUID string', () => {
    const result = uuidSchema.safeParse('not-a-uuid');
    expect(result.success).toBe(false);
  });

  it('rejects an empty string', () => {
    const result = uuidSchema.safeParse('');
    expect(result.success).toBe(false);
  });

  it('rejects a non-string value', () => {
    const result = uuidSchema.safeParse(12345);
    expect(result.success).toBe(false);
  });
});

describe('campaignFormSchema', () => {
  const validCampaign = {
    title: 'Senior Engineer',
    description: 'We are hiring a senior engineer.',
    department: 'Engineering',
    positions: 2,
    status: 'draft' as const,
    accepting_applications: true,
    deadline: null,
    deadline_enforced: false,
    location: 'Remote',
    automation_mode: 'human_in_loop' as const,
    resume_threshold: 70,
    screening_threshold: 70,
    interview_persona: 'neutral' as const,
    interview_slot_minutes: null,
    interview_timezone: null,
    interview_booking_horizon_days: 14,
  };

  it('accepts a fully valid campaign', () => {
    const result = campaignFormSchema.safeParse(validCampaign);
    expect(result.success).toBe(true);
  });

  it('rejects a campaign with an empty title', () => {
    const result = campaignFormSchema.safeParse({ ...validCampaign, title: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a title longer than 200 characters', () => {
    const result = campaignFormSchema.safeParse({
      ...validCampaign,
      title: 'x'.repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it('rejects zero or negative positions', () => {
    const zero = campaignFormSchema.safeParse({ ...validCampaign, positions: 0 });
    const negative = campaignFormSchema.safeParse({ ...validCampaign, positions: -1 });
    expect(zero.success).toBe(false);
    expect(negative.success).toBe(false);
  });

  it('rejects a screening_threshold outside 0-100', () => {
    const tooHigh = campaignFormSchema.safeParse({ ...validCampaign, screening_threshold: 101 });
    const negative = campaignFormSchema.safeParse({ ...validCampaign, screening_threshold: -1 });
    expect(tooHigh.success).toBe(false);
    expect(negative.success).toBe(false);
  });

  it('rejects a resume_threshold outside 0-100', () => {
    const tooHigh = campaignFormSchema.safeParse({ ...validCampaign, resume_threshold: 101 });
    const negative = campaignFormSchema.safeParse({ ...validCampaign, resume_threshold: -1 });
    expect(tooHigh.success).toBe(false);
    expect(negative.success).toBe(false);
  });

  it('requires resume_threshold — the CV bar is not optional', () => {
    const withoutResumeBar: Record<string, unknown> = { ...validCampaign };
    delete withoutResumeBar.resume_threshold;
    expect(campaignFormSchema.safeParse(withoutResumeBar).success).toBe(false);
  });

  it('rejects an unknown status value', () => {
    const result = campaignFormSchema.safeParse({ ...validCampaign, status: 'on_fire' });
    expect(result.success).toBe(false);
  });

  it('rejects interview_slot_minutes outside 5-240', () => {
    const tooShort = campaignFormSchema.safeParse({ ...validCampaign, interview_slot_minutes: 4 });
    const tooLong = campaignFormSchema.safeParse({ ...validCampaign, interview_slot_minutes: 241 });
    expect(tooShort.success).toBe(false);
    expect(tooLong.success).toBe(false);
  });

  it('rejects an interview_booking_horizon_days outside 1-90', () => {
    const zero = campaignFormSchema.safeParse({ ...validCampaign, interview_booking_horizon_days: 0 });
    const tooFar = campaignFormSchema.safeParse({ ...validCampaign, interview_booking_horizon_days: 91 });
    expect(zero.success).toBe(false);
    expect(tooFar.success).toBe(false);
  });
});

describe('availabilityRuleSchema', () => {
  const validRule = { weekday: 1, start_minute: 9 * 60, end_minute: 17 * 60 };

  it('accepts a valid weekly rule', () => {
    expect(availabilityRuleSchema.safeParse(validRule).success).toBe(true);
  });

  it('rejects an end time at or before the start time', () => {
    const equal = availabilityRuleSchema.safeParse({ ...validRule, end_minute: validRule.start_minute });
    const before = availabilityRuleSchema.safeParse({ ...validRule, start_minute: 600, end_minute: 540 });
    expect(equal.success).toBe(false);
    expect(before.success).toBe(false);
  });

  it('rejects a weekday outside 0-6', () => {
    expect(availabilityRuleSchema.safeParse({ ...validRule, weekday: 7 }).success).toBe(false);
    expect(availabilityRuleSchema.safeParse({ ...validRule, weekday: -1 }).success).toBe(false);
  });

  it('rejects minutes outside the 0-1440 day', () => {
    expect(availabilityRuleSchema.safeParse({ ...validRule, start_minute: -1 }).success).toBe(false);
    expect(availabilityRuleSchema.safeParse({ ...validRule, end_minute: 1441 }).success).toBe(false);
  });
});

describe('parseCampaignFormData', () => {
  function buildFormData(overrides: Record<string, string> = {}): FormData {
    const fd = new FormData();
    fd.set('title', 'Senior Engineer');
    fd.set('description', 'Hiring a senior engineer.');
    fd.set('positions', '2');
    fd.set('status', 'draft');
    fd.set('automation_mode', 'human_in_loop');
    fd.set('resume_threshold', '70');
    fd.set('screening_threshold', '70');
    fd.set('interview_persona', 'neutral');
    for (const [key, value] of Object.entries(overrides)) {
      fd.set(key, value);
    }
    return fd;
  }

  it('parses a minimal valid form', () => {
    const fd = buildFormData();
    const result = parseCampaignFormData(fd);
    expect(result.title).toBe('Senior Engineer');
    expect(result.positions).toBe(2);
    expect(result.rubrics).toEqual([]);
  });

  it('clamps screening_threshold above 100 down to 100', () => {
    const fd = buildFormData({ screening_threshold: '500' });
    const result = parseCampaignFormData(fd);
    expect(result.screening_threshold).toBe(100);
  });

  it('clamps negative screening_threshold up to 0', () => {
    const fd = buildFormData({ screening_threshold: '-20' });
    const result = parseCampaignFormData(fd);
    expect(result.screening_threshold).toBe(0);
  });

  it('clamps resume_threshold to 0-100 independently of the screening bar', () => {
    const fd = buildFormData({ resume_threshold: '500', screening_threshold: '40' });
    const result = parseCampaignFormData(fd);
    expect(result.resume_threshold).toBe(100);
    expect(result.screening_threshold).toBe(40);
  });

  it('keeps the two bars separate — each field lands on its own column', () => {
    const fd = buildFormData({ resume_threshold: '55', screening_threshold: '80' });
    const result = parseCampaignFormData(fd);
    expect(result.resume_threshold).toBe(55);
    expect(result.screening_threshold).toBe(80);
  });

  it('defaults both thresholds to 70 when the fields are missing', () => {
    const fd = buildFormData();
    fd.delete('resume_threshold');
    fd.delete('screening_threshold');
    const result = parseCampaignFormData(fd);
    expect(result.resume_threshold).toBe(70);
    expect(result.screening_threshold).toBe(70);
  });

  it('defaults positions to 1 when NaN', () => {
    const fd = buildFormData({ positions: 'abc' });
    const result = parseCampaignFormData(fd);
    expect(result.positions).toBe(1);
  });

  it('decodes the "active_no_intake" status option to active + intake closed', () => {
    const fd = buildFormData({ status: 'active_no_intake' });
    const result = parseCampaignFormData(fd);
    expect(result.status).toBe('active');
    expect(result.accepting_applications).toBe(false);
  });

  it('decodes a plain "active" status option to active + intake open', () => {
    const fd = buildFormData({ status: 'active' });
    const result = parseCampaignFormData(fd);
    expect(result.status).toBe('active');
    expect(result.accepting_applications).toBe(true);
  });

  it('reads deadline_enforced=true from the "true" radio option', () => {
    const fd = buildFormData({ deadline_enforced: 'true' });
    const result = parseCampaignFormData(fd);
    expect(result.deadline_enforced).toBe(true);
  });

  it('reads deadline_enforced=false from the "false" radio option', () => {
    const fd = buildFormData({ deadline_enforced: 'false' });
    const result = parseCampaignFormData(fd);
    expect(result.deadline_enforced).toBe(false);
  });

  it('defaults deadline_enforced to false when the field is absent', () => {
    const fd = buildFormData();
    const result = parseCampaignFormData(fd);
    expect(result.deadline_enforced).toBe(false);
  });

  it('returns empty arrays when JSON fields are malformed', () => {
    const fd = buildFormData();
    fd.set('rubrics_json', '{"wrong": "shape"}');
    const result = parseCampaignFormData(fd);
    expect(result.rubrics).toEqual([]);
  });

  it('parses screening questions staged on the create form', () => {
    const fd = buildFormData({
      screening_questions_json: JSON.stringify([
        { prompt: 'Describe a system you scaled past its first design.' },
        { prompt: 'What made you look outside your current role?' },
      ]),
    });

    const result = parseCampaignFormData(fd);

    expect(result.screeningQuestions).toEqual([
      { prompt: 'Describe a system you scaled past its first design.' },
      { prompt: 'What made you look outside your current role?' },
    ]);
  });

  /**
   * `null`, not `[]`. An edit form that does not carry the field is saying
   * "I do not manage questions", which must leave the stored set alone; an
   * empty array is the recruiter having removed the last one. A parser that
   * returned `[]` for both would let any caller that forgets the field wipe a
   * campaign's whole question set.
   */
  it('reports the screening question field as absent rather than empty', () => {
    const fd = buildFormData();
    const result = parseCampaignFormData(fd);
    expect(result.screeningQuestions).toBeNull();
  });

  // An empty set is legal at creation: a recruiter without a job description
  // yet cannot generate questions, and blocking creation on that is worse than
  // the "no questions yet" banner the campaign page already shows.
  it('accepts an explicitly empty screening question set', () => {
    const fd = buildFormData({ screening_questions_json: '[]' });
    const result = parseCampaignFormData(fd);
    expect(result.screeningQuestions).toEqual([]);
  });

  it('drops a screening question set whose prompts are too short', () => {
    const fd = buildFormData({
      screening_questions_json: JSON.stringify([{ prompt: 'why?' }]),
    });

    const result = parseCampaignFormData(fd);

    expect(result.screeningQuestions).toEqual([]);
  });

  it('parses availability rules and the scalar interview-config fields', () => {
    const fd = buildFormData({
      interview_slot_minutes: '45',
      interview_timezone: '  Africa/Casablanca  ',
      interview_booking_horizon_days: '21',
      availability_rules_json: JSON.stringify([
        { weekday: 1, start_minute: 540, end_minute: 1020 },
      ]),
    });
    const result = parseCampaignFormData(fd);
    expect(result.interview_slot_minutes).toBe(45);
    expect(result.interview_timezone).toBe('Africa/Casablanca');
    expect(result.interview_booking_horizon_days).toBe(21);
    expect(result.availabilityRules).toEqual([
      { weekday: 1, start_minute: 540, end_minute: 1020 },
    ]);
  });

  it('defaults the interview-config fields when absent', () => {
    const fd = buildFormData();
    const result = parseCampaignFormData(fd);
    expect(result.interview_slot_minutes).toBeNull();
    expect(result.interview_timezone).toBeNull();
    expect(result.interview_booking_horizon_days).toBe(14);
    expect(result.availabilityRules).toEqual([]);
  });

  it('drops malformed availability rules (e.g. end before start)', () => {
    const fd = buildFormData({
      availability_rules_json: JSON.stringify([
        { weekday: 1, start_minute: 600, end_minute: 540 },
      ]),
    });
    const result = parseCampaignFormData(fd);
    expect(result.availabilityRules).toEqual([]);
  });
});

describe('applicationStateSchema', () => {
  it('accepts a canonical pipeline state', () => {
    expect(applicationStateSchema.safeParse('screening_approved').success).toBe(true);
  });

  it('accepts a failure state', () => {
    expect(applicationStateSchema.safeParse('processing_failed').success).toBe(true);
  });

  it('rejects a retired legacy value', () => {
    expect(applicationStateSchema.safeParse('screening_q').success).toBe(false);
  });

  it('rejects a coarse CandidateStage value', () => {
    expect(applicationStateSchema.safeParse('applied').success).toBe(false);
  });

  it('rejects an unknown value', () => {
    expect(applicationStateSchema.safeParse('banana').success).toBe(false);
  });
});

describe('stageChangeRationaleSchema', () => {
  it('accepts a non-empty reason', () => {
    const result = stageChangeRationaleSchema.safeParse('Strong interview, advancing.');
    expect(result.success).toBe(true);
  });

  it('trims surrounding whitespace', () => {
    const result = stageChangeRationaleSchema.safeParse('  advancing  ');
    expect(result.success && result.data).toBe('advancing');
  });

  it('rejects an empty string', () => {
    expect(stageChangeRationaleSchema.safeParse('').success).toBe(false);
  });

  it('rejects a whitespace-only string', () => {
    expect(stageChangeRationaleSchema.safeParse('   ').success).toBe(false);
  });
});

describe('applyApplicantSchema', () => {
  const valid = {
    first_name: 'Alice',
    last_name: 'Smith',
    email: 'alice@example.com',
  };

  it('accepts a complete applicant identity', () => {
    const result = applyApplicantSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('trims names and lowercases the email', () => {
    const result = applyApplicantSchema.safeParse({
      first_name: '  Alice ',
      last_name: ' Smith ',
      email: ' Alice@Example.COM ',
    });

    expect(result.success && result.data).toEqual({ ...valid, linkedin: null, website: null });
  });

  it('rejects an empty first name', () => {
    const result = applyApplicantSchema.safeParse({ ...valid, first_name: '  ' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty last name', () => {
    const result = applyApplicantSchema.safeParse({ ...valid, last_name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed email address', () => {
    const result = applyApplicantSchema.safeParse({ ...valid, email: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('rejects an over-long name', () => {
    const result = applyApplicantSchema.safeParse({ ...valid, first_name: 'a'.repeat(101) });
    expect(result.success).toBe(false);
  });
});

describe('applyApplicantSchema profile links', () => {
  const base = { first_name: 'Alice', last_name: 'Smith', email: 'alice@example.com' };

  it('normalizes a bare LinkedIn handle to a full profile URL', () => {
    const result = applyApplicantSchema.safeParse({ ...base, linkedin: 'in/alice-smith' });
    expect(result.success && result.data.linkedin).toBe('https://www.linkedin.com/in/alice-smith');
  });

  it('accepts a pasted full LinkedIn URL without doubling the host', () => {
    const result = applyApplicantSchema.safeParse({
      ...base,
      linkedin: 'https://www.linkedin.com/in/alice-smith',
    });
    expect(result.success && result.data.linkedin).toBe('https://www.linkedin.com/in/alice-smith');
  });

  it('normalizes a personal site to https', () => {
    const result = applyApplicantSchema.safeParse({ ...base, website: 'alice.dev' });
    expect(result.success && result.data.website).toBe('https://alice.dev');
  });

  it('keeps an already-https personal site intact', () => {
    const result = applyApplicantSchema.safeParse({ ...base, website: 'https://alice.dev' });
    expect(result.success && result.data.website).toBe('https://alice.dev');
  });

  it('turns blank or omitted links into null', () => {
    const result = applyApplicantSchema.safeParse({ ...base, linkedin: '  ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.linkedin).toBeNull();
      expect(result.data.website).toBeNull();
    }
  });

  it('rejects a website that is not a plausible address', () => {
    const result = applyApplicantSchema.safeParse({ ...base, website: 'not a website' });
    expect(result.success).toBe(false);
  });
});
