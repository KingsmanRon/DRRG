/**
 * Hand-maintained Supabase Database types for tables and RPCs this app uses.
 * Keep in sync with supabase/migrations when signatures change.
 * (Regenerate later with `npx supabase gen types typescript` when linked.)
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type StaffRole = "doctor" | "staff";
export type PatientIdentityType = "sa_id" | "passport" | "foreign_document" | "none";
export type PatientStatus = "active" | "archived";
export type SignatureType = "typed_name" | "drawn_signature";
export type DuplicateReviewStatus = "flagged" | "not_duplicate" | "merged";

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          user_id: string;
          display_name: string;
          role: StaffRole;
          active: boolean;
          practice_number: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          display_name: string;
          role: StaffRole;
          active?: boolean;
          practice_number?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          display_name?: string;
          role?: StaffRole;
          active?: boolean;
          practice_number?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      patients: {
        Row: {
          id: string;
          file_number: string;
          first_names: string;
          surname: string;
          date_of_birth: string;
          identity_type: PatientIdentityType;
          identity_number: string | null;
          identity_country: string | null;
          no_identity_reason: string | null;
          phone: string | null;
          phone_normalized: string | null;
          email: string | null;
          residential_address: string | null;
          no_contact_reason: string | null;
          status: PatientStatus;
          archived_at: string | null;
          merged_into: string | null;
          created_by: string;
          updated_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          file_number?: string;
          first_names: string;
          surname: string;
          date_of_birth: string;
          identity_type: PatientIdentityType;
          identity_number?: string | null;
          identity_country?: string | null;
          no_identity_reason?: string | null;
          phone?: string | null;
          email?: string | null;
          residential_address?: string | null;
          no_contact_reason?: string | null;
          status?: PatientStatus;
          archived_at?: string | null;
          merged_into?: string | null;
          created_by: string;
          updated_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          file_number?: string;
          first_names?: string;
          surname?: string;
          date_of_birth?: string;
          identity_type?: PatientIdentityType;
          identity_number?: string | null;
          identity_country?: string | null;
          no_identity_reason?: string | null;
          phone?: string | null;
          email?: string | null;
          residential_address?: string | null;
          no_contact_reason?: string | null;
          status?: PatientStatus;
          archived_at?: string | null;
          merged_into?: string | null;
          created_by?: string;
          updated_by?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      duplicate_reviews: {
        Row: {
          id: string;
          patient_id: string;
          candidate_patient_id: string;
          review_reason: string;
          reviewed_by: string;
          reviewed_at: string;
          status: DuplicateReviewStatus;
          resolved_by: string | null;
          resolved_at: string | null;
          resolution_reason: string | null;
          resolved_fingerprint: string | null;
        };
        Insert: {
          id?: string;
          patient_id: string;
          candidate_patient_id: string;
          review_reason: string;
          reviewed_by: string;
          reviewed_at?: string;
          status?: DuplicateReviewStatus;
          resolved_by?: string | null;
          resolved_at?: string | null;
          resolution_reason?: string | null;
          resolved_fingerprint?: string | null;
        };
        Update: {
          id?: string;
          patient_id?: string;
          candidate_patient_id?: string;
          review_reason?: string;
          reviewed_by?: string;
          reviewed_at?: string;
          status?: DuplicateReviewStatus;
          resolved_by?: string | null;
          resolved_at?: string | null;
          resolution_reason?: string | null;
          resolved_fingerprint?: string | null;
        };
        Relationships: [];
      };
      audit_events: {
        Row: {
          id: number;
          actor_user_id: string;
          action: string;
          patient_id: string;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: number;
          actor_user_id: string;
          action: string;
          patient_id: string;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: number;
          actor_user_id?: string;
          action?: string;
          patient_id?: string;
          metadata?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      search_patients: {
        Args: {
          p_query?: string;
          p_limit?: number;
          p_offset?: number;
          p_sort?: string;
          p_dir?: string;
          p_scope?: string;
        };
        Returns: Json;
      };
      find_possible_duplicates: {
        Args: {
          p_first_names: string;
          p_surname: string;
          p_date_of_birth: string;
          p_phone: string;
          p_limit?: number;
          p_email?: string | null;
          p_address?: string | null;
        };
        Returns: {
          id: string;
          file_number: string;
          first_names: string;
          surname: string;
          date_of_birth: string;
          phone: string;
          identity_type: PatientIdentityType;
          identity_last4: string | null;
          status: PatientStatus;
          match_score: number;
          match_tier: string;
          match_reasons: string[];
        }[];
      };
      onboard_patient: {
        Args: {
          p_patient: Json;
          p_consent: Json;
          p_duplicate_candidate_ids?: string[];
          p_duplicate_review_reason?: string;
        };
        Returns: { patient_id: string; file_number: string }[];
      };
      update_patient: {
        Args: {
          p_id: string;
          p_patient: Json;
        };
        Returns: { patient_id: string; file_number: string }[];
      };
      merge_patients: {
        Args: {
          p_survivor_id: string;
          p_source_id: string;
        };
        Returns: { patient_id: string; file_number: string; fields_copied: string[] }[];
      };
      resolve_duplicate: {
        Args: {
          p_patient_id: string;
          p_candidate_id: string;
          p_reason: string;
        };
        Returns: number;
      };
      archive_patient: {
        Args: {
          p_id: string;
          p_reason: string;
        };
        Returns: { patient_id: string; file_number: string }[];
      };
      restore_patient: {
        Args: {
          p_id: string;
        };
        Returns: { patient_id: string; file_number: string }[];
      };
      list_duplicate_reviews: {
        Args: Record<string, never>;
        Returns: {
          review_id: string;
          reviewed_at: string;
          review_reason: string;
          match_score: number;
          match_tier: string;
          match_reasons: string[];
          identity_match: boolean;
          patient: Json;
          candidate: Json;
        }[];
      };
    };
    Enums: {
      staff_role: StaffRole;
      patient_identity_type: PatientIdentityType;
      patient_status: PatientStatus;
      signature_type: SignatureType;
      duplicate_review_status: DuplicateReviewStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};
