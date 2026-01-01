export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]

export interface Database {
    public: {
        Tables: {
            orders: {
                Row: {
                    id: number
                    order_id: number | null
                    number: string | null
                    status: string | null
                    event_type: string | null
                    event_field: string | null
                    created_at: string | null
                    updated_at: string | null
                    phone: string | null
                    totalsumm: number | null
                    raw_payload: Json | null
                }
                Insert: {
                    id: number
                    order_id?: number | null
                    number?: string | null
                    status?: string | null
                    event_type?: string | null
                    event_field?: string | null
                    created_at?: string | null
                    updated_at?: string | null
                    phone?: string | null
                    totalsumm?: number | null
                    raw_payload?: Json | null
                }
            }
            sync_state: {
                Row: {
                    key: string
                    value: string
                    updated_at: string
                }
            }
        }
    }
}