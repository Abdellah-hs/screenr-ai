import { describe, it, expect } from 'vitest';
import {
  uuidSchema,
  campaignFormSchema,
  availabilityRuleSchema,
  screeningAnswerSubmissionSchema,
  parseCampaignFormData,
  applicationStateSchema,
  stageChangeRationaleSchema,
} from './validations';

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
    deadline: null,
    location: 'Remote',
    automation_mode: 'human_in_loop' as const,
    screening_threshold: 70,
    interview_persona: 'neutral' as const,
    application_email: 'careers+eng@company.com',
    interview_slot_minutes: null,
    interview_timezone: null,
    interview_booking_horizon_days: 14,
  };

  it('accepts a fully valid campaign', () => {
    const result = campaignFormSchema.safeParse(validCampaign);
    expect(result.success).toBe(true);
  });

  it('accepts a valid application_email (plus-alias)', () => {
    const result = campaignFormSchema.safeParse({
      ...validCampaign,
      application_email: 'careers+eng@company.com',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a malformed application_email', () => {
    const result = campaignFormSchema.safeParse({
      ...validCampaign,
      application_email: 'not-an-email',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a campaign with no application_email (now required)', () => {
    const result = campaignFormSchema.safeParse({
      ...validCampaign,
      application_email: '',
    });
    expect(result.success).toBe(false);
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

describe('screeningAnswerSubmissionSchema', () => {
  const validSubmission = {
    token: 'a'.repeat(32),
    answers: [
      {
        question_id: '550e8400-e29b-41d4-a716-446655440000',
        answer_text: 'This is my answer.',
      },
    ],
  };

  it('accepts a valid submission', () => {
    const result = screeningAnswerSubmissionSchema.safeParse(validSubmission);
    expect(result.success).toBe(true);
  });

  it('rejects an empty answers array', () => {
    const result = screeningAnswerSubmissionSchema.safeParse({
      ...validSubmission,
      answers: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an answer with a non-UUID question_id', () => {
    const result = screeningAnswerSubmissionSchema.safeParse({
      ...validSubmission,
      answers: [{ question_id: 'nope', answer_text: 'hi' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a submission with a short token', () => {
    const result = screeningAnswerSubmissionSchema.safeParse({
      ...validSubmission,
      token: 'short',
    });
    expect(result.success).toBe(false);
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
    fd.set('screening_threshold', '70');
    fd.set('interview_persona', 'neutral');
    fd.set('application_email', 'careers+eng@company.com');
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

  it('defaults positions to 1 when NaN', () => {
    const fd = buildFormData({ positions: 'abc' });
    const result = parseCampaignFormData(fd);
    expect(result.positions).toBe(1);
  });

  it('returns empty arrays when JSON fields are malformed', () => {
    const fd = buildFormData();
    fd.set('rubrics_json', '{"wrong": "shape"}');
    const result = parseCampaignFormData(fd);
    expect(result.rubrics).toEqual([]);
  });

  it('trims and keeps a provided application_email', () => {
    const fd = buildFormData({ application_email: '  careers+eng@company.com  ' });
    const result = parseCampaignFormData(fd);
    expect(result.application_email).toBe('careers+eng@company.com');
  });

  it('rejects a form with a missing application_email (now required)', () => {
    const fd = buildFormData();
    fd.delete('application_email');
    expect(() => parseCampaignFormData(fd)).toThrow();
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
