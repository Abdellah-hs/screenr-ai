import { describe, it, expect } from 'vitest';
import {
  uuidSchema,
  campaignFormSchema,
  screeningAnswerSubmissionSchema,
  parseCampaignFormData,
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

  it('rejects an unknown status value', () => {
    const result = campaignFormSchema.safeParse({ ...validCampaign, status: 'on_fire' });
    expect(result.success).toBe(false);
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
    expect(result.screeningCriteria).toEqual([]);
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
    fd.set('screening_criteria_json', 'not json');
    fd.set('rubrics_json', '{"wrong": "shape"}');
    const result = parseCampaignFormData(fd);
    expect(result.screeningCriteria).toEqual([]);
    expect(result.rubrics).toEqual([]);
  });
});
