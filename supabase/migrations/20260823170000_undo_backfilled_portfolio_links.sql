-- ============================================================================
-- Undo the portfolio links written by the 2026-08-23 contact-link backfill
-- ============================================================================
-- The backfill's first version chose the portfolio as "the first URL in the
-- document that is not on a denylist". On a real CV that is almost never the
-- candidate's own site: it is an employer's homepage, a university's, or the
-- link printed on a course certificate. The run wrote 42 such values, and on
-- the candidate file they render as a row labelled "Portfolio" — a claim
-- about the person that the person never made, which is the exact failure
-- the harvest exists to avoid.
--
-- findPortfolio has since been narrowed to links the document labels as
-- personal, or that sit in the contact block, with the CV's own employers and
-- schools excluded by domain. This clears what the loose version wrote.
--
-- Scoped to the exact (application, value) pairs from that run's own report,
-- so a portfolio already on file — or one a candidate typed on the apply
-- form — cannot be caught by it. The GitHub links from the same run are left
-- alone on purpose: github.com/<user> is an unambiguous shape and those
-- values are correct.
WITH backfilled(application_id, wrote) AS (VALUES
  ('12150626-e9b0-4fbe-8c30-d6f5e883b425'::uuid, 'https://learn.deeplearning.ai/courses/agentic-ai/information'),
  ('ee6eec30-014e-49e8-bbde-5daa421a9c9a'::uuid, 'https://learn.deeplearning.ai/courses/agentic-ai/information'),
  ('d387c574-cc31-4358-89eb-18eab25c2c97'::uuid, 'https://learn.deeplearning.ai/courses/agentic-ai/information'),
  ('d54faba2-2a0c-4210-b8c6-69bad34425cb'::uuid, 'https://cgi.ma/'),
  ('e515bb8f-a091-4136-8302-4530caa3b885'::uuid, 'https://cgi.ma/'),
  ('02cbe67f-fb21-4888-91f6-7310aa076134'::uuid, 'https://cgi.ma/'),
  ('c116b059-766a-46f3-9a08-3549e2b70f61'::uuid, 'https://cgi.ma/'),
  ('8e6ca85d-e689-4dd0-b5e2-2c731a2147e4'::uuid, 'https://cgi.ma/'),
  ('8a715bad-d311-4d8f-b9aa-1692b56ff295'::uuid, 'https://learn.deeplearning.ai/courses/agentic-ai/information'),
  ('2a907300-5b29-4f66-b297-313e9ebfae9c'::uuid, 'https://cgi.ma/'),
  ('55c3ee5d-cae1-4937-9213-0371e684d4fe'::uuid, 'https://cgi.ma/'),
  ('7720601c-8be0-4180-90f6-b34cc25fac06'::uuid, 'https://cgi.ma/'),
  ('01f09cf2-e631-4ef6-913d-95e25aeaec88'::uuid, 'https://www.uir.ac.ma/en'),
  ('20defdf5-a5f2-4155-a7f6-862f33e75654'::uuid, 'https://cgi.ma/'),
  ('63b1a249-b841-4f5a-bbc1-62d9a41b4224'::uuid, 'https://cgi.ma/'),
  ('33018319-1723-49e6-a51e-20565726ca6d'::uuid, 'https://cgi.ma/'),
  ('cde87385-fced-4399-8be5-e2a91e01e2da'::uuid, 'https://cgi.ma/'),
  ('60788e9a-dc98-4496-b2e5-8d7efb88d991'::uuid, 'https://cgi.ma/'),
  ('65a6289c-73ca-4ba0-9236-6fb1f5620033'::uuid, 'https://cgi.ma/'),
  ('94aadb66-9a9f-40b9-aedf-af980f1adf91'::uuid, 'https://cgi.ma/'),
  ('f34e10e0-914b-4602-962b-44415e1f5a06'::uuid, 'https://cgi.ma/'),
  ('95059a4d-b091-45a1-8426-96c6f50f25cb'::uuid, 'https://cgi.ma/'),
  ('faf63562-deb6-4986-a12b-1849c9efc02f'::uuid, 'https://cgi.ma/'),
  ('a0d7e26c-e47a-47b6-ae63-daa544a34f02'::uuid, 'https://cgi.ma/'),
  ('ec5ed242-2658-46e8-86df-b4f8eab745a0'::uuid, 'https://cgi.ma/'),
  ('a13cce00-2db5-436c-8202-898142d74e4c'::uuid, 'https://cgi.ma/'),
  ('8a75e0f4-47e3-4e27-acac-f58fdc992aeb'::uuid, 'https://cgi.ma/'),
  ('b46579ed-fe49-4ece-b888-b9321c1c1fc0'::uuid, 'https://cgi.ma/'),
  ('e9de07b4-2e12-4557-ad27-06f5d7810616'::uuid, 'https://cgi.ma/'),
  ('3d1711b8-e9ea-4501-8ded-4a7dbc547fb9'::uuid, 'https://cgi.ma/'),
  ('cab3b96c-35be-4836-9808-d8e0e003f9eb'::uuid, 'https://cgi.ma/'),
  ('430f50b2-9735-476f-9968-bbcde1bf4569'::uuid, 'https://cgi.ma/'),
  ('7193e4b3-a91e-456c-9b37-23c4b588daf3'::uuid, 'https://cgi.ma/'),
  ('1168922a-b065-4b9a-84e0-c1131e0e969d'::uuid, 'https://cgi.ma/'),
  ('5811eed9-5ced-4204-a489-2d5e2c429594'::uuid, 'https://cgi.ma/'),
  ('b0447b9a-1d9e-4dec-932b-70908dbc6080'::uuid, 'https://cgi.ma/'),
  ('e3c71ced-e154-4158-b2bb-284b13daa1ba'::uuid, 'https://cgi.ma/'),
  ('8aeb7e74-c116-4860-b99c-1d990b8ebd91'::uuid, 'https://cgi.ma/'),
  ('22d5b965-9775-46e0-b07b-713a3271b7e7'::uuid, 'https://cgi.ma/'),
  ('6077e6e7-38f9-4341-8703-6cb80c778433'::uuid, 'https://cgi.ma/'),
  ('9e06636a-5046-4ff2-8275-0ad7d01dd7aa'::uuid, 'https://cgi.ma/'),
  ('719feca6-47e0-48a2-bf20-6c2d28c9cb4e'::uuid, 'https://cgi.ma/')
)
UPDATE public.applications AS a
SET parsed_data = jsonb_set(a.parsed_data, '{portfolio_url}', 'null'::jsonb),
    updated_at = now()
FROM backfilled b
WHERE a.id = b.application_id
  AND a.parsed_data->>'portfolio_url' = b.wrote;

WITH backfilled(application_id, wrote) AS (VALUES
  ('12150626-e9b0-4fbe-8c30-d6f5e883b425'::uuid, 'https://learn.deeplearning.ai/courses/agentic-ai/information'),
  ('ee6eec30-014e-49e8-bbde-5daa421a9c9a'::uuid, 'https://learn.deeplearning.ai/courses/agentic-ai/information'),
  ('d387c574-cc31-4358-89eb-18eab25c2c97'::uuid, 'https://learn.deeplearning.ai/courses/agentic-ai/information'),
  ('d54faba2-2a0c-4210-b8c6-69bad34425cb'::uuid, 'https://cgi.ma/'),
  ('e515bb8f-a091-4136-8302-4530caa3b885'::uuid, 'https://cgi.ma/'),
  ('02cbe67f-fb21-4888-91f6-7310aa076134'::uuid, 'https://cgi.ma/'),
  ('c116b059-766a-46f3-9a08-3549e2b70f61'::uuid, 'https://cgi.ma/'),
  ('8e6ca85d-e689-4dd0-b5e2-2c731a2147e4'::uuid, 'https://cgi.ma/'),
  ('8a715bad-d311-4d8f-b9aa-1692b56ff295'::uuid, 'https://learn.deeplearning.ai/courses/agentic-ai/information'),
  ('2a907300-5b29-4f66-b297-313e9ebfae9c'::uuid, 'https://cgi.ma/'),
  ('55c3ee5d-cae1-4937-9213-0371e684d4fe'::uuid, 'https://cgi.ma/'),
  ('7720601c-8be0-4180-90f6-b34cc25fac06'::uuid, 'https://cgi.ma/'),
  ('01f09cf2-e631-4ef6-913d-95e25aeaec88'::uuid, 'https://www.uir.ac.ma/en'),
  ('20defdf5-a5f2-4155-a7f6-862f33e75654'::uuid, 'https://cgi.ma/'),
  ('63b1a249-b841-4f5a-bbc1-62d9a41b4224'::uuid, 'https://cgi.ma/'),
  ('33018319-1723-49e6-a51e-20565726ca6d'::uuid, 'https://cgi.ma/'),
  ('cde87385-fced-4399-8be5-e2a91e01e2da'::uuid, 'https://cgi.ma/'),
  ('60788e9a-dc98-4496-b2e5-8d7efb88d991'::uuid, 'https://cgi.ma/'),
  ('65a6289c-73ca-4ba0-9236-6fb1f5620033'::uuid, 'https://cgi.ma/'),
  ('94aadb66-9a9f-40b9-aedf-af980f1adf91'::uuid, 'https://cgi.ma/'),
  ('f34e10e0-914b-4602-962b-44415e1f5a06'::uuid, 'https://cgi.ma/'),
  ('95059a4d-b091-45a1-8426-96c6f50f25cb'::uuid, 'https://cgi.ma/'),
  ('faf63562-deb6-4986-a12b-1849c9efc02f'::uuid, 'https://cgi.ma/'),
  ('a0d7e26c-e47a-47b6-ae63-daa544a34f02'::uuid, 'https://cgi.ma/'),
  ('ec5ed242-2658-46e8-86df-b4f8eab745a0'::uuid, 'https://cgi.ma/'),
  ('a13cce00-2db5-436c-8202-898142d74e4c'::uuid, 'https://cgi.ma/'),
  ('8a75e0f4-47e3-4e27-acac-f58fdc992aeb'::uuid, 'https://cgi.ma/'),
  ('b46579ed-fe49-4ece-b888-b9321c1c1fc0'::uuid, 'https://cgi.ma/'),
  ('e9de07b4-2e12-4557-ad27-06f5d7810616'::uuid, 'https://cgi.ma/'),
  ('3d1711b8-e9ea-4501-8ded-4a7dbc547fb9'::uuid, 'https://cgi.ma/'),
  ('cab3b96c-35be-4836-9808-d8e0e003f9eb'::uuid, 'https://cgi.ma/'),
  ('430f50b2-9735-476f-9968-bbcde1bf4569'::uuid, 'https://cgi.ma/'),
  ('7193e4b3-a91e-456c-9b37-23c4b588daf3'::uuid, 'https://cgi.ma/'),
  ('1168922a-b065-4b9a-84e0-c1131e0e969d'::uuid, 'https://cgi.ma/'),
  ('5811eed9-5ced-4204-a489-2d5e2c429594'::uuid, 'https://cgi.ma/'),
  ('b0447b9a-1d9e-4dec-932b-70908dbc6080'::uuid, 'https://cgi.ma/'),
  ('e3c71ced-e154-4158-b2bb-284b13daa1ba'::uuid, 'https://cgi.ma/'),
  ('8aeb7e74-c116-4860-b99c-1d990b8ebd91'::uuid, 'https://cgi.ma/'),
  ('22d5b965-9775-46e0-b07b-713a3271b7e7'::uuid, 'https://cgi.ma/'),
  ('6077e6e7-38f9-4341-8703-6cb80c778433'::uuid, 'https://cgi.ma/'),
  ('9e06636a-5046-4ff2-8275-0ad7d01dd7aa'::uuid, 'https://cgi.ma/'),
  ('719feca6-47e0-48a2-bf20-6c2d28c9cb4e'::uuid, 'https://cgi.ma/')
)
UPDATE public.candidates AS c
SET portfolio_url = NULL
FROM backfilled b
JOIN public.applications a ON a.id = b.application_id
WHERE c.id = a.candidate_id
  AND c.portfolio_url = b.wrote;
