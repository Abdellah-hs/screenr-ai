📅  Screenr AI | Weekly Changelog – March 9–15, 2026

✨ Features

• **Supabase Authentication Setup**: Integrated Supabase Auth for user sign-up, login, and session management across the platform.
• **Campaign Creation Form**: Built the campaign creation UI allowing hiring managers to define job title, description, department, number of positions, and status (draft/active/paused/closed).
• **Campaign Dashboard**: Developed the main campaigns dashboard displaying all hiring campaigns with status badges, filtering, and sorting capabilities.
• **Campaign Detail View**: Implemented the individual campaign detail page showing campaign settings, pipeline overview, and candidate count.

🛠️ Improvements

• **Database Schema Enhancements**: Extended the campaigns table with additional fields for deadline, location/timezone preferences, and custom screening criteria (JSONB).
• **RLS Policy Refinement**: Updated Row Level Security policies to scope campaign access per authenticated user and support team-based visibility.
• **Project Configuration**: Pinned Node.js engine version and configured release-please for automated changelog generation on main branch pushes.
