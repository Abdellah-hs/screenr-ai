export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_audit_log: {
        Row: {
          action_taken: string | null
          campaign_id: string
          candidate_id: string | null
          confidence: number | null
          created_at: string
          id: string
          input_snapshot: Json
          model: string
          parsed_score: number | null
          prompt_version: string
          rationale: string | null
          raw_output: string
          rubric_version: string | null
          stage: string
        }
        Insert: {
          action_taken?: string | null
          campaign_id: string
          candidate_id?: string | null
          confidence?: number | null
          created_at?: string
          id?: string
          input_snapshot: Json
          model: string
          parsed_score?: number | null
          prompt_version: string
          rationale?: string | null
          raw_output: string
          rubric_version?: string | null
          stage: string
        }
        Update: {
          action_taken?: string | null
          campaign_id?: string
          candidate_id?: string | null
          confidence?: number | null
          created_at?: string
          id?: string
          input_snapshot?: Json
          model?: string
          parsed_score?: number | null
          prompt_version?: string
          rationale?: string | null
          raw_output?: string
          rubric_version?: string | null
          stage?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_audit_log_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_audit_log_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      application_transitions: {
        Row: {
          actor: string
          application_id: string
          created_at: string
          from_state: Database["public"]["Enums"]["candidate_stage_enum"] | null
          id: string
          rationale: string | null
          to_state: Database["public"]["Enums"]["candidate_stage_enum"]
        }
        Insert: {
          actor: string
          application_id: string
          created_at?: string
          from_state?:
            | Database["public"]["Enums"]["candidate_stage_enum"]
            | null
          id?: string
          rationale?: string | null
          to_state: Database["public"]["Enums"]["candidate_stage_enum"]
        }
        Update: {
          actor?: string
          application_id?: string
          created_at?: string
          from_state?:
            | Database["public"]["Enums"]["candidate_stage_enum"]
            | null
          id?: string
          rationale?: string | null
          to_state?: Database["public"]["Enums"]["candidate_stage_enum"]
        }
        Relationships: [
          {
            foreignKeyName: "application_transitions_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      applications: {
        Row: {
          campaign_id: string
          candidate_id: string
          created_at: string
          id: string
          interview_score: number | null
          parsed_data: Json | null
          rejection_reason: string | null
          resume_score: number | null
          resume_url: string | null
          score_factors: Json | null
          score_rationale: string | null
          scored_at: string | null
          screening_q_score: number | null
          screening_tier:
            | Database["public"]["Enums"]["screening_tier_enum"]
            | null
          status: Database["public"]["Enums"]["candidate_stage_enum"]
          updated_at: string
        }
        Insert: {
          campaign_id: string
          candidate_id: string
          created_at?: string
          id?: string
          interview_score?: number | null
          parsed_data?: Json | null
          rejection_reason?: string | null
          resume_score?: number | null
          resume_url?: string | null
          score_factors?: Json | null
          score_rationale?: string | null
          scored_at?: string | null
          screening_q_score?: number | null
          screening_tier?:
            | Database["public"]["Enums"]["screening_tier_enum"]
            | null
          status?: Database["public"]["Enums"]["candidate_stage_enum"]
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          candidate_id?: string
          created_at?: string
          id?: string
          interview_score?: number | null
          parsed_data?: Json | null
          rejection_reason?: string | null
          resume_score?: number | null
          resume_url?: string | null
          score_factors?: Json | null
          score_rationale?: string | null
          scored_at?: string | null
          screening_q_score?: number | null
          screening_tier?:
            | Database["public"]["Enums"]["screening_tier_enum"]
            | null
          status?: Database["public"]["Enums"]["candidate_stage_enum"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "applications_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_audit_log: {
        Row: {
          action: string
          campaign_id: string
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          new_data: Json | null
          old_data: Json | null
          user_id: string | null
        }
        Insert: {
          action: string
          campaign_id: string
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          user_id?: string | null
        }
        Update: {
          action?: string
          campaign_id?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_audit_log_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_reviewers: {
        Row: {
          assigned_at: string
          campaign_id: string
          id: string
          role: Database["public"]["Enums"]["reviewer_role_enum"]
          user_id: string
        }
        Insert: {
          assigned_at?: string
          campaign_id: string
          id?: string
          role?: Database["public"]["Enums"]["reviewer_role_enum"]
          user_id: string
        }
        Update: {
          assigned_at?: string
          campaign_id?: string
          id?: string
          role?: Database["public"]["Enums"]["reviewer_role_enum"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_reviewers_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          automation_mode: Database["public"]["Enums"]["automation_mode_enum"]
          created_at: string
          deadline: string | null
          deleted_at: string | null
          department: string | null
          description: string
          id: string
          interview_persona: Database["public"]["Enums"]["interview_persona_enum"]
          location: string | null
          positions: number
          screening_criteria: Json
          screening_threshold: number
          status: Database["public"]["Enums"]["campaign_status_enum"]
          timezone: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          automation_mode?: Database["public"]["Enums"]["automation_mode_enum"]
          created_at?: string
          deadline?: string | null
          deleted_at?: string | null
          department?: string | null
          description?: string
          id?: string
          interview_persona?: Database["public"]["Enums"]["interview_persona_enum"]
          location?: string | null
          positions?: number
          screening_criteria?: Json
          screening_threshold?: number
          status?: Database["public"]["Enums"]["campaign_status_enum"]
          timezone?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          automation_mode?: Database["public"]["Enums"]["automation_mode_enum"]
          created_at?: string
          deadline?: string | null
          deleted_at?: string | null
          department?: string | null
          description?: string
          id?: string
          interview_persona?: Database["public"]["Enums"]["interview_persona_enum"]
          location?: string | null
          positions?: number
          screening_criteria?: Json
          screening_threshold?: number
          status?: Database["public"]["Enums"]["campaign_status_enum"]
          timezone?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      candidates: {
        Row: {
          created_at: string
          deleted_at: string | null
          email: string
          first_name: string
          id: string
          last_name: string
          linkedin_url: string | null
          location: string | null
          phone: string | null
          portfolio_url: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          email: string
          first_name: string
          id?: string
          last_name: string
          linkedin_url?: string | null
          location?: string | null
          phone?: string | null
          portfolio_url?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          email?: string
          first_name?: string
          id?: string
          last_name?: string
          linkedin_url?: string | null
          location?: string | null
          phone?: string | null
          portfolio_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      duplicate_review_queue: {
        Row: {
          id: string
          candidate_id: string
          matched_candidate_id: string
          match_signals: Json
          status: string
          reviewer_user_id: string | null
          rationale: string | null
          created_at: string
          updated_at: string
          resolved_at: string | null
        }
        Insert: {
          id?: string
          candidate_id: string
          matched_candidate_id: string
          match_signals?: Json
          status?: string
          reviewer_user_id?: string | null
          rationale?: string | null
          created_at?: string
          updated_at?: string
          resolved_at?: string | null
        }
        Update: {
          id?: string
          candidate_id?: string
          matched_candidate_id?: string
          match_signals?: Json
          status?: string
          reviewer_user_id?: string | null
          rationale?: string | null
          created_at?: string
          updated_at?: string
          resolved_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "duplicate_review_queue_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "duplicate_review_queue_matched_candidate_id_fkey"
            columns: ["matched_candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      evaluation_rubrics: {
        Row: {
          archived_at: string | null
          campaign_id: string
          created_at: string
          id: string
          is_active: boolean
          stage: Database["public"]["Enums"]["pipeline_stage_enum"]
          version: number
        }
        Insert: {
          archived_at?: string | null
          campaign_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          stage: Database["public"]["Enums"]["pipeline_stage_enum"]
          version?: number
        }
        Update: {
          archived_at?: string | null
          campaign_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          stage?: Database["public"]["Enums"]["pipeline_stage_enum"]
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "evaluation_rubrics_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      rubric_dimensions: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          is_mandatory: boolean
          max_score: number
          min_score: number
          name: string
          rubric_id: string
          sort_order: number
          updated_at: string
          weight: number
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_mandatory?: boolean
          max_score?: number
          min_score?: number
          name: string
          rubric_id: string
          sort_order?: number
          updated_at?: string
          weight?: number
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_mandatory?: boolean
          max_score?: number
          min_score?: number
          name?: string
          rubric_id?: string
          sort_order?: number
          updated_at?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "rubric_dimensions_rubric_id_fkey"
            columns: ["rubric_id"]
            isOneToOne: false
            referencedRelation: "evaluation_rubrics"
            referencedColumns: ["id"]
          },
        ]
      }
      screening_criteria: {
        Row: {
          campaign_id: string
          created_at: string
          deleted_at: string | null
          id: string
          is_mandatory: boolean
          label: string
          sort_order: number
          updated_at: string
          weight: number
        }
        Insert: {
          campaign_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_mandatory?: boolean
          label: string
          sort_order?: number
          updated_at?: string
          weight?: number
        }
        Update: {
          campaign_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_mandatory?: boolean
          label?: string
          sort_order?: number
          updated_at?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "screening_criteria_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      screening_question_responses: {
        Row: {
          answers: Json
          application_id: string
          created_at: string
          expires_at: string | null
          id: string
          overall_rationale: string | null
          overall_score: number | null
          responded_at: string | null
          scored_at: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["screening_response_status_enum"]
          updated_at: string
        }
        Insert: {
          answers?: Json
          application_id: string
          created_at?: string
          expires_at?: string | null
          id?: string
          overall_rationale?: string | null
          overall_score?: number | null
          responded_at?: string | null
          scored_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["screening_response_status_enum"]
          updated_at?: string
        }
        Update: {
          answers?: Json
          application_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          overall_rationale?: string | null
          overall_score?: number | null
          responded_at?: string | null
          scored_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["screening_response_status_enum"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "screening_question_responses_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      screening_questions: {
        Row: {
          campaign_id: string
          created_at: string
          id: string
          is_required: boolean
          prompt: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          id?: string
          is_required?: boolean
          prompt: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          id?: string
          is_required?: boolean
          prompt?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "screening_questions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      sla_timers: {
        Row: {
          alert_threshold_hours: number
          campaign_id: string
          created_at: string
          escalation_threshold_hours: number
          id: string
          stage: string
          time_limit_hours: number
          updated_at: string
        }
        Insert: {
          alert_threshold_hours: number
          campaign_id: string
          created_at?: string
          escalation_threshold_hours: number
          id?: string
          stage: string
          time_limit_hours: number
          updated_at?: string
        }
        Update: {
          alert_threshold_hours?: number
          campaign_id?: string
          created_at?: string
          escalation_threshold_hours?: number
          id?: string
          stage?: string
          time_limit_hours?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sla_timers_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      transition_application: {
        Args: {
          p_actor: string
          p_application_id: string
          p_rationale?: string
          p_to_state: Database["public"]["Enums"]["candidate_stage_enum"]
        }
        Returns: undefined
      }
    }
    Enums: {
      automation_mode_enum: "fully_auto" | "human_in_loop"
      campaign_status_enum:
        | "draft"
        | "active"
        | "paused"
        | "closed"
        | "archived"
      candidate_stage_enum:
        | "new"
        | "screening"
        | "screening_q"
        | "interview"
        | "manager_review"
        | "rejected"
        | "hired"
        | "withdrawn"
        | "screening_review_pending"
        | "screening_approved"
        | "screening_sent"
        | "screening_completed"
        | "screening_scored"
        | "interview_scheduling"
        | "interview_scheduled"
        | "interview_completed"
        | "interview_scored"
        | "reference_check"
        | "final_interview_scheduling"
        | "archived"
      interview_persona_enum:
        | "neutral"
        | "pressure"
        | "collaborative"
        | "socratic"
      pipeline_stage_enum: "resume" | "screening_q" | "interview"
      reviewer_role_enum: "lead" | "reviewer" | "observer"
      screening_response_status_enum:
        | "pending"
        | "sent"
        | "responded"
        | "scored"
        | "expired"
      screening_tier_enum: "strong" | "moderate" | "weak" | "no_match"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      automation_mode_enum: ["fully_auto", "human_in_loop"],
      campaign_status_enum: ["draft", "active", "paused", "closed", "archived"],
      candidate_stage_enum: [
        "new",
        "screening",
        "screening_q",
        "interview",
        "manager_review",
        "rejected",
        "hired",
        "withdrawn",
        "screening_review_pending",
        "screening_approved",
        "screening_sent",
        "screening_completed",
        "screening_scored",
        "interview_scheduling",
        "interview_scheduled",
        "interview_completed",
        "interview_scored",
        "reference_check",
        "final_interview_scheduling",
        "archived",
      ],
      interview_persona_enum: [
        "neutral",
        "pressure",
        "collaborative",
        "socratic",
      ],
      pipeline_stage_enum: ["resume", "screening_q", "interview"],
      reviewer_role_enum: ["lead", "reviewer", "observer"],
      screening_response_status_enum: [
        "pending",
        "sent",
        "responded",
        "scored",
        "expired",
      ],
      screening_tier_enum: ["strong", "moderate", "weak", "no_match"],
    },
  },
} as const
