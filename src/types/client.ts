// Client type definitions

export interface Client {
  id: string;
  owner_id: string;
  name: string;
  id_number: string | null;
  address: string | null;
  city: string | null;
  email: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateClientForm {
  name: string;
  id_number?: string;
  address?: string;
  city?: string;
  email?: string;
  notes?: string;
}

export interface UpdateClientForm {
  name?: string;
  id_number?: string;
  address?: string;
  city?: string;
  email?: string;
  notes?: string;
}
