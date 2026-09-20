export interface User {
  user_id: number;
  email: string | null;
  balance: number;
  free_generations: number;
  total_generations: number;
  can_review_media: boolean;
}

export interface ReviewGeneration {
  id: number | null;
  user: {
    email: string | null;
    telegram_username: string | null;
    telegram_id: number | null;
  };
  prompt: string;
  metadata_available: boolean;
  pair_key: string;
  source_url: string;
  result_url: string;
  created_at: string;
  completed_at: string | null;
}

export interface ReviewGenerationPage {
  items: ReviewGeneration[];
  has_more: boolean;
  next_page: number | null;
}

export interface Generation {
  id: number;
  status: "processing" | "completed" | "failed";
  prompt: string;
  source_file_id: string | null;
  result_file_id: string | null;
  cost: number;
  is_free: number;
  created_at: string;
  completed_at: string | null;
}

export interface GenerationStatus {
  status: "processing" | "completed" | "failed";
  result_url: string | null;
}

export interface AuthResponse {
  token: string;
  expires_at: string;
  user: User;
}
