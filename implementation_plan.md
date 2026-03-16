# Build Screenr AI Changelog Features (March 9–15)

Implement all features from the weekly changelog: Supabase Auth, Campaign Dashboard, Campaign Creation Form, Campaign Detail View, DB schema enhancements, and RLS policy refinement.

## Proposed Changes

### Database Layer

#### [NEW] [20260310000000_extend_campaigns.sql](file:///c:/Users/hasna/OneDrive/Desktop/screenr-ai/supabase/migrations/20260310000000_extend_campaigns.sql)
- Add columns: `deadline`, `location`, `timezone`, `screening_criteria` (JSONB), `user_id` (UUID, FK to `auth.users`)
- Update RLS policies to scope by `auth.uid() = user_id`
- Add policy for `INSERT`, `SELECT`, `UPDATE`, `DELETE` scoped to the campaign owner

#### [MODIFY] [database.types.ts](file:///c:/Users/hasna/OneDrive/Desktop/screenr-ai/src/types/database.types.ts)
- Add new fields to the `campaigns` Row/Insert/Update types to match the extended schema

---

### Supabase Auth

#### [NEW] [supabase/client.ts](file:///c:/Users/hasna/OneDrive/Desktop/screenr-ai/src/lib/supabase/client.ts)
- Browser-side Supabase client using `createBrowserClient` from `@supabase/ssr`

#### [NEW] [supabase/server.ts](file:///c:/Users/hasna/OneDrive/Desktop/screenr-ai/src/lib/supabase/server.ts)
- Server-side Supabase client using `createServerClient` from `@supabase/ssr` with cookie handling

#### [NEW] [middleware.ts](file:///c:/Users/hasna/OneDrive/Desktop/screenr-ai/src/middleware.ts)
- Next.js middleware to refresh auth sessions and protect `/campaigns/*` routes
- Redirect unauthenticated users to `/login`

#### [NEW] [login/page.tsx](file:///c:/Users/hasna/OneDrive/Desktop/screenr-ai/src/app/login/page.tsx)
- Email + password login form with Supabase Auth sign-in
- Link to signup, error handling, redirect to `/campaigns` on success

#### [NEW] [signup/page.tsx](file:///c:/Users/hasna/OneDrive/Desktop/screenr-ai/src/app/signup/page.tsx)
- Email + password signup form with Supabase Auth sign-up
- Link to login, error handling

#### [NEW] [auth/callback/route.ts](file:///c:/Users/hasna/OneDrive/Desktop/screenr-ai/src/app/auth/callback/route.ts)
- OAuth/email confirmation callback handler

---

### UI Shell & Design

#### [MODIFY] [globals.css](file:///c:/Users/hasna/OneDrive/Desktop/screenr-ai/src/app/globals.css)
- Define a professional dark-mode-first design system with color tokens, typography, and utility classes for the dashboard

#### [MODIFY] [layout.tsx](file:///c:/Users/hasna/OneDrive/Desktop/screenr-ai/src/app/layout.tsx)
- Fix duplicate `title` property, update metadata
- Use Inter font from Google Fonts for a premium feel

#### [NEW] [Navbar.tsx](file:///c:/Users/hasna/OneDrive/Desktop/screenr-ai/src/components/Navbar.tsx)
- Top navigation bar with logo, nav links, and user session controls (sign out button)

#### [NEW] [Sidebar.tsx](file:///c:/Users/hasna/OneDrive/Desktop/screenr-ai/src/components/Sidebar.tsx)
- Dashboard sidebar with navigation: Campaigns, Settings (placeholder)

#### [NEW] [layout.tsx](file:///c:/Users/hasna/OneDrive/Desktop/screenr-ai/src/app/(dashboard)/layout.tsx)
- Dashboard layout wrapper with Navbar + Sidebar for all `/campaigns/*` routes

---

### Campaign Dashboard

#### [NEW] [page.tsx](file:///c:/Users/hasna/OneDrive/Desktop/screenr-ai/src/app/(dashboard)/campaigns/page.tsx)
- Server component that fetches all campaigns for the current user
- Renders campaign cards/table with status badges (draft/active/paused/closed)
- Client-side filtering by status and sorting by date/title
- "New Campaign" button linking to `/campaigns/new`

---

### Campaign Creation Form

#### [NEW] [page.tsx](file:///c:/Users/hasna/OneDrive/Desktop/screenr-ai/src/app/(dashboard)/campaigns/new/page.tsx)
- Client component with form for: title, description (textarea), department, positions, status, deadline, location
- Form validation (title + description required)
- Server action to insert into Supabase and redirect to the new campaign's detail page

#### [NEW] [campaigns.ts](file:///c:/Users/hasna/OneDrive/Desktop/screenr-ai/src/lib/actions/campaigns.ts)
- `createCampaign` server action
- `getCampaigns` server action
- `getCampaignById` server action

---

### Campaign Detail View

#### [NEW] [page.tsx](file:///c:/Users/hasna/OneDrive/Desktop/screenr-ai/src/app/(dashboard)/campaigns/[id]/page.tsx)
- Server component that fetches a single campaign by ID
- Displays all campaign fields in a clean layout
- Pipeline stage overview (placeholder cards for future stages)
- "Edit" button (placeholder for future edit functionality)

---

## Verification Plan

### Build Check
- Run `npx next build` in the project root — must complete with zero errors

### Browser Tests
1. **Auth Flow**: Navigate to `/campaigns` → verify redirect to `/login` → sign up → verify redirect to `/campaigns` dashboard
2. **Campaign Creation**: Click "New Campaign" → fill form → submit → verify redirect to detail page with correct data
3. **Campaign Dashboard**: Return to `/campaigns` → verify the new campaign appears with correct status badge
4. **Campaign Detail**: Click a campaign → verify all fields are displayed correctly
