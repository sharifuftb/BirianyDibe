import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface User {
  id: string;
  name: string;
  avatar?: string;
}

export interface Post {
  id: string;
  user_id: string;
  user_name: string;
  place_name: string;
  description: string;
  lat: number;
  lng: number;
  distribution_time: string;
  created_at: string;
  true_votes: number;
  false_votes: number;
}

export interface VoteUpdate {
  post_id: string;
  true_votes: number;
  false_votes: number;
}
