export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      companies: {
        Row: {
          business_type: Database["public"]["Enums"]["business_type"];
          country: string | null;
          created_at: string;
          created_by: string | null;
          document_expiry_warning_days: number;
          fleet_size: Database["public"]["Enums"]["fleet_size"] | null;
          id: string;
          name: string;
          terminology: Database["public"]["Enums"]["terminology"];
          updated_at: string;
        };
        Insert: {
          business_type?: Database["public"]["Enums"]["business_type"];
          country?: string | null;
          created_at?: string;
          created_by?: string | null;
          document_expiry_warning_days?: number;
          fleet_size?: Database["public"]["Enums"]["fleet_size"] | null;
          id?: string;
          name: string;
          terminology?: Database["public"]["Enums"]["terminology"];
          updated_at?: string;
        };
        Update: {
          business_type?: Database["public"]["Enums"]["business_type"];
          country?: string | null;
          created_at?: string;
          created_by?: string | null;
          document_expiry_warning_days?: number;
          fleet_size?: Database["public"]["Enums"]["fleet_size"] | null;
          id?: string;
          name?: string;
          terminology?: Database["public"]["Enums"]["terminology"];
          updated_at?: string;
        };
        Relationships: [];
      };
      company_members: {
        Row: {
          company_id: string;
          created_at: string;
          id: string;
          user_id: string;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          id?: string;
          user_id: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "company_members_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      customers: {
        Row: {
          address: string | null;
          company_id: string;
          contact_person: string | null;
          created_at: string;
          email: string | null;
          id: string;
          name: string;
          notes: string | null;
          phone: string | null;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          company_id: string;
          contact_person?: string | null;
          created_at?: string;
          email?: string | null;
          id?: string;
          name: string;
          notes?: string | null;
          phone?: string | null;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          company_id?: string;
          contact_person?: string | null;
          created_at?: string;
          email?: string | null;
          id?: string;
          name?: string;
          notes?: string | null;
          phone?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customers_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      documents: {
        Row: {
          company_id: string;
          created_at: string;
          document_type: string;
          expiry_date: string | null;
          file_url: string | null;
          id: string;
          issue_date: string | null;
          name: string;
          notes: string | null;
          owner_id: string;
          owner_type: Database["public"]["Enums"]["document_owner_type"];
          updated_at: string;
          uploaded_by: string | null;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          document_type: string;
          expiry_date?: string | null;
          file_url?: string | null;
          id?: string;
          issue_date?: string | null;
          name: string;
          notes?: string | null;
          owner_id: string;
          owner_type: Database["public"]["Enums"]["document_owner_type"];
          updated_at?: string;
          uploaded_by?: string | null;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          document_type?: string;
          expiry_date?: string | null;
          file_url?: string | null;
          id?: string;
          issue_date?: string | null;
          name?: string;
          notes?: string | null;
          owner_id?: string;
          owner_type?: Database["public"]["Enums"]["document_owner_type"];
          updated_at?: string;
          uploaded_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "documents_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      drivers: {
        Row: {
          assigned_vehicle_id: string | null;
          company_id: string;
          created_at: string;
          emergency_contact_name: string | null;
          emergency_contact_phone: string | null;
          employee_ref: string | null;
          full_name: string;
          id: string;
          licence_class: string | null;
          licence_expiry: string | null;
          licence_number: string | null;
          notes: string | null;
          phone: string | null;
          status: Database["public"]["Enums"]["driver_status"];
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          assigned_vehicle_id?: string | null;
          company_id: string;
          created_at?: string;
          emergency_contact_name?: string | null;
          emergency_contact_phone?: string | null;
          employee_ref?: string | null;
          full_name: string;
          id?: string;
          licence_class?: string | null;
          licence_expiry?: string | null;
          licence_number?: string | null;
          notes?: string | null;
          phone?: string | null;
          status?: Database["public"]["Enums"]["driver_status"];
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          assigned_vehicle_id?: string | null;
          company_id?: string;
          created_at?: string;
          emergency_contact_name?: string | null;
          emergency_contact_phone?: string | null;
          employee_ref?: string | null;
          full_name?: string;
          id?: string;
          licence_class?: string | null;
          licence_expiry?: string | null;
          licence_number?: string | null;
          notes?: string | null;
          phone?: string | null;
          status?: Database["public"]["Enums"]["driver_status"];
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "drivers_assigned_vehicle_fk";
            columns: ["assigned_vehicle_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "drivers_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      incidents: {
        Row: {
          company_id: string;
          created_at: string;
          description: string;
          driver_id: string | null;
          id: string;
          incident_type: Database["public"]["Enums"]["incident_type"];
          job_id: string | null;
          location: string | null;
          occurred_at: string;
          photo_urls: string[] | null;
          reported_by: string | null;
          resolution_notes: string | null;
          resolved_at: string | null;
          severity: Database["public"]["Enums"]["incident_severity"];
          status: Database["public"]["Enums"]["incident_status"];
          updated_at: string;
          vehicle_id: string | null;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          description: string;
          driver_id?: string | null;
          id?: string;
          incident_type?: Database["public"]["Enums"]["incident_type"];
          job_id?: string | null;
          location?: string | null;
          occurred_at?: string;
          photo_urls?: string[] | null;
          reported_by?: string | null;
          resolution_notes?: string | null;
          resolved_at?: string | null;
          severity?: Database["public"]["Enums"]["incident_severity"];
          status?: Database["public"]["Enums"]["incident_status"];
          updated_at?: string;
          vehicle_id?: string | null;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          description?: string;
          driver_id?: string | null;
          id?: string;
          incident_type?: Database["public"]["Enums"]["incident_type"];
          job_id?: string | null;
          location?: string | null;
          occurred_at?: string;
          photo_urls?: string[] | null;
          reported_by?: string | null;
          resolution_notes?: string | null;
          resolved_at?: string | null;
          severity?: Database["public"]["Enums"]["incident_severity"];
          status?: Database["public"]["Enums"]["incident_status"];
          updated_at?: string;
          vehicle_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "incidents_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "incidents_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "incidents_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "incidents_vehicle_id_fkey";
            columns: ["vehicle_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id"];
          },
        ];
      };
      job_events: {
        Row: {
          actor_id: string | null;
          company_id: string;
          created_at: string;
          event_type: string;
          id: string;
          job_id: string;
          message: string | null;
          metadata: Json | null;
        };
        Insert: {
          actor_id?: string | null;
          company_id: string;
          created_at?: string;
          event_type: string;
          id?: string;
          job_id: string;
          message?: string | null;
          metadata?: Json | null;
        };
        Update: {
          actor_id?: string | null;
          company_id?: string;
          created_at?: string;
          event_type?: string;
          id?: string;
          job_id?: string;
          message?: string | null;
          metadata?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "job_events_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_events_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      job_proofs: {
        Row: {
          company_id: string;
          completed_at: string;
          created_at: string;
          created_by: string | null;
          driver_id: string | null;
          id: string;
          job_id: string;
          notes: string | null;
          photo_url: string | null;
          recipient_name: string;
          signature_url: string | null;
        };
        Insert: {
          company_id: string;
          completed_at?: string;
          created_at?: string;
          created_by?: string | null;
          driver_id?: string | null;
          id?: string;
          job_id: string;
          notes?: string | null;
          photo_url?: string | null;
          recipient_name: string;
          signature_url?: string | null;
        };
        Update: {
          company_id?: string;
          completed_at?: string;
          created_at?: string;
          created_by?: string | null;
          driver_id?: string | null;
          id?: string;
          job_id?: string;
          notes?: string | null;
          photo_url?: string | null;
          recipient_name?: string;
          signature_url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "job_proofs_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_proofs_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_proofs_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      jobs: {
        Row: {
          accepted_at: string | null;
          arrived_at: string | null;
          company_id: string;
          completed_at: string | null;
          created_at: string;
          created_by: string | null;
          customer_id: string | null;
          description: string | null;
          driver_id: string | null;
          dropoff_location: string | null;
          failed_at: string | null;
          failure_reason: string | null;
          id: string;
          notes: string | null;
          pickup_location: string | null;
          priority: Database["public"]["Enums"]["job_priority"];
          proof_lat: number | null;
          proof_lng: number | null;
          proof_notes: string | null;
          proof_photo_url: string | null;
          proof_recipient_name: string | null;
          proof_signature_url: string | null;
          reference: string;
          scheduled_at: string | null;
          started_at: string | null;
          status: Database["public"]["Enums"]["job_status"];
          updated_at: string;
          vehicle_id: string | null;
        };
        Insert: {
          accepted_at?: string | null;
          arrived_at?: string | null;
          company_id: string;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          description?: string | null;
          driver_id?: string | null;
          dropoff_location?: string | null;
          failed_at?: string | null;
          failure_reason?: string | null;
          id?: string;
          notes?: string | null;
          pickup_location?: string | null;
          priority?: Database["public"]["Enums"]["job_priority"];
          proof_lat?: number | null;
          proof_lng?: number | null;
          proof_notes?: string | null;
          proof_photo_url?: string | null;
          proof_recipient_name?: string | null;
          proof_signature_url?: string | null;
          reference?: string;
          scheduled_at?: string | null;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["job_status"];
          updated_at?: string;
          vehicle_id?: string | null;
        };
        Update: {
          accepted_at?: string | null;
          arrived_at?: string | null;
          company_id?: string;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          description?: string | null;
          driver_id?: string | null;
          dropoff_location?: string | null;
          failed_at?: string | null;
          failure_reason?: string | null;
          id?: string;
          notes?: string | null;
          pickup_location?: string | null;
          priority?: Database["public"]["Enums"]["job_priority"];
          proof_lat?: number | null;
          proof_lng?: number | null;
          proof_notes?: string | null;
          proof_photo_url?: string | null;
          proof_recipient_name?: string | null;
          proof_signature_url?: string | null;
          reference?: string;
          scheduled_at?: string | null;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["job_status"];
          updated_at?: string;
          vehicle_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "jobs_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_vehicle_id_fkey";
            columns: ["vehicle_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id"];
          },
        ];
      };
      maintenance: {
        Row: {
          company_id: string;
          completed_at: string | null;
          cost: number | null;
          created_at: string;
          created_by: string | null;
          description: string | null;
          due_odometer: number | null;
          id: string;
          invoice_url: string | null;
          maintenance_type: Database["public"]["Enums"]["maintenance_type"];
          notes: string | null;
          scheduled_date: string | null;
          started_at: string | null;
          status: Database["public"]["Enums"]["maintenance_status"];
          title: string;
          updated_at: string;
          vehicle_id: string;
        };
        Insert: {
          company_id: string;
          completed_at?: string | null;
          cost?: number | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          due_odometer?: number | null;
          id?: string;
          invoice_url?: string | null;
          maintenance_type?: Database["public"]["Enums"]["maintenance_type"];
          notes?: string | null;
          scheduled_date?: string | null;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["maintenance_status"];
          title: string;
          updated_at?: string;
          vehicle_id: string;
        };
        Update: {
          company_id?: string;
          completed_at?: string | null;
          cost?: number | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          due_odometer?: number | null;
          id?: string;
          invoice_url?: string | null;
          maintenance_type?: Database["public"]["Enums"]["maintenance_type"];
          notes?: string | null;
          scheduled_date?: string | null;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["maintenance_status"];
          title?: string;
          updated_at?: string;
          vehicle_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "maintenance_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "maintenance_vehicle_id_fkey";
            columns: ["vehicle_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          body: string | null;
          company_id: string;
          created_at: string;
          id: string;
          link_path: string | null;
          notification_type: Database["public"]["Enums"]["notification_type"];
          read_at: string | null;
          title: string;
          user_id: string;
        };
        Insert: {
          body?: string | null;
          company_id: string;
          created_at?: string;
          id?: string;
          link_path?: string | null;
          notification_type: Database["public"]["Enums"]["notification_type"];
          read_at?: string | null;
          title: string;
          user_id: string;
        };
        Update: {
          body?: string | null;
          company_id?: string;
          created_at?: string;
          id?: string;
          link_path?: string | null;
          notification_type?: Database["public"]["Enums"]["notification_type"];
          read_at?: string | null;
          title?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          active_company_id: string | null;
          avatar_url: string | null;
          created_at: string;
          full_name: string | null;
          id: string;
          phone: string | null;
          updated_at: string;
        };
        Insert: {
          active_company_id?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          full_name?: string | null;
          id: string;
          phone?: string | null;
          updated_at?: string;
        };
        Update: {
          active_company_id?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          full_name?: string | null;
          id?: string;
          phone?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          company_id: string;
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_roles_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      vehicles: {
        Row: {
          assigned_driver_id: string | null;
          company_id: string;
          created_at: string;
          id: string;
          insurance_expiry: string | null;
          licence_expiry: string | null;
          make: string | null;
          model: string | null;
          notes: string | null;
          odometer: number | null;
          registration: string;
          status: Database["public"]["Enums"]["vehicle_status"];
          updated_at: string;
          vehicle_type: Database["public"]["Enums"]["vehicle_type"];
          vin: string | null;
          year: number | null;
        };
        Insert: {
          assigned_driver_id?: string | null;
          company_id: string;
          created_at?: string;
          id?: string;
          insurance_expiry?: string | null;
          licence_expiry?: string | null;
          make?: string | null;
          model?: string | null;
          notes?: string | null;
          odometer?: number | null;
          registration: string;
          status?: Database["public"]["Enums"]["vehicle_status"];
          updated_at?: string;
          vehicle_type?: Database["public"]["Enums"]["vehicle_type"];
          vin?: string | null;
          year?: number | null;
        };
        Update: {
          assigned_driver_id?: string | null;
          company_id?: string;
          created_at?: string;
          id?: string;
          insurance_expiry?: string | null;
          licence_expiry?: string | null;
          make?: string | null;
          model?: string | null;
          notes?: string | null;
          odometer?: number | null;
          registration?: string;
          status?: Database["public"]["Enums"]["vehicle_status"];
          updated_at?: string;
          vehicle_type?: Database["public"]["Enums"]["vehicle_type"];
          vin?: string | null;
          year?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "vehicles_assigned_driver_id_fkey";
            columns: ["assigned_driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vehicles_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      has_any_role: {
        Args: {
          _company_id: string;
          _roles: Database["public"]["Enums"]["app_role"][];
        };
        Returns: boolean;
      };
      has_role: {
        Args: {
          _company_id: string;
          _role: Database["public"]["Enums"]["app_role"];
        };
        Returns: boolean;
      };
      is_company_member: { Args: { _company_id: string }; Returns: boolean };
      assign_job_with_conflict_check: {
        Args: {
          _job_id: string;
          _driver_id: string;
          _vehicle_id: string;
          _admin_override?: boolean;
        };
        Returns: Json;
      };
      current_driver_id: { Args: { _company_id: string }; Returns: string };
      driver_fail_job: {
        Args: { _job_id: string; _reason: string; _notes?: string | null };
        Returns: Database["public"]["Tables"]["jobs"]["Row"];
      };
      driver_transition_job: {
        Args: {
          _job_id: string;
          _action: string;
          _device_installation_id?: string | null;
          _app_version?: string | null;
          _device_platform?: string | null;
          _location_permission_state?: string | null;
        };
        Returns: Database["public"]["Tables"]["jobs"]["Row"];
      };
      ingest_tracking_telemetry: {
        Args: { _batch: Json };
        Returns: Json;
      };
      driver_update_job_notes: {
        Args: { _job_id: string; _notes: string };
        Returns: Database["public"]["Tables"]["jobs"]["Row"];
      };
      submit_job_proof: {
        Args: {
          _job_id: string;
          _recipient_name: string;
          _notes?: string | null;
          _photo_url?: string | null;
          _signature_url?: string | null;
        };
        Returns: Database["public"]["Tables"]["jobs"]["Row"];
      };
      is_driver_relevant_job: { Args: { _job_id: string }; Returns: boolean };
      job_assignment_conflicts: {
        Args: {
          _company_id: string;
          _job_id: string;
          _driver_id?: string | null;
          _vehicle_id?: string | null;
        };
        Returns: Json;
      };
      log_job_event: {
        Args: {
          _company_id: string;
          _job_id: string;
          _event_type: string;
          _message?: string | null;
          _metadata?: Json | null;
        };
        Returns: string;
      };
    };
    Enums: {
      app_role: "admin" | "fleet_manager" | "dispatcher" | "driver" | "viewer";
      business_type:
        | "logistics"
        | "trucking"
        | "courier"
        | "food_delivery"
        | "last_mile"
        | "fuel_petroleum"
        | "passenger_transport"
        | "other";
      document_owner_type: "company" | "vehicle" | "driver";
      driver_status: "available" | "on_trip" | "off_duty" | "suspended";
      fleet_size: "1-5" | "6-20" | "21-50" | "51-100" | "100+";
      incident_severity: "low" | "medium" | "high" | "critical";
      incident_status: "open" | "investigating" | "resolved";
      incident_type:
        | "accident"
        | "breakdown"
        | "vehicle_damage"
        | "delivery_issue"
        | "driver_issue"
        | "customer_issue"
        | "safety_issue"
        | "other";
      job_priority: "low" | "normal" | "high" | "critical";
      job_status:
        | "unassigned"
        | "assigned"
        | "accepted"
        | "in_progress"
        | "arrived"
        | "completed"
        | "failed"
        | "cancelled";
      maintenance_status: "reported" | "scheduled" | "in_progress" | "completed";
      maintenance_type:
        | "service"
        | "repair"
        | "inspection"
        | "tyres"
        | "brakes"
        | "engine"
        | "electrical"
        | "other";
      notification_type:
        | "job_assigned"
        | "job_accepted"
        | "job_started"
        | "job_delayed"
        | "job_completed"
        | "job_failed"
        | "incident_reported"
        | "incident_critical"
        | "maintenance_overdue"
        | "document_expiring"
        | "document_expired";
      terminology: "trips" | "jobs" | "deliveries" | "loads" | "orders";
      vehicle_status: "available" | "in_use" | "maintenance" | "out_of_service";
      vehicle_type: "truck" | "van" | "car" | "motorcycle" | "bus" | "tanker" | "other";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "fleet_manager", "dispatcher", "driver", "viewer"],
      business_type: [
        "logistics",
        "trucking",
        "courier",
        "food_delivery",
        "last_mile",
        "fuel_petroleum",
        "passenger_transport",
        "other",
      ],
      document_owner_type: ["company", "vehicle", "driver"],
      driver_status: ["available", "on_trip", "off_duty", "suspended"],
      fleet_size: ["1-5", "6-20", "21-50", "51-100", "100+"],
      incident_severity: ["low", "medium", "high", "critical"],
      incident_status: ["open", "investigating", "resolved"],
      incident_type: [
        "accident",
        "breakdown",
        "vehicle_damage",
        "delivery_issue",
        "driver_issue",
        "customer_issue",
        "safety_issue",
        "other",
      ],
      job_priority: ["low", "normal", "high", "critical"],
      job_status: [
        "unassigned",
        "assigned",
        "accepted",
        "in_progress",
        "arrived",
        "completed",
        "failed",
        "cancelled",
      ],
      maintenance_status: ["reported", "scheduled", "in_progress", "completed"],
      maintenance_type: [
        "service",
        "repair",
        "inspection",
        "tyres",
        "brakes",
        "engine",
        "electrical",
        "other",
      ],
      notification_type: [
        "job_assigned",
        "job_accepted",
        "job_started",
        "job_delayed",
        "job_completed",
        "job_failed",
        "incident_reported",
        "incident_critical",
        "maintenance_overdue",
        "document_expiring",
        "document_expired",
      ],
      terminology: ["trips", "jobs", "deliveries", "loads", "orders"],
      vehicle_status: ["available", "in_use", "maintenance", "out_of_service"],
      vehicle_type: ["truck", "van", "car", "motorcycle", "bus", "tanker", "other"],
    },
  },
} as const;
