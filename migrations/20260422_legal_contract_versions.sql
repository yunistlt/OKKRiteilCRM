-- История версий для legal_contract_reviews
CREATE TABLE IF NOT EXISTS public.legal_contract_review_versions (
    id BIGSERIAL PRIMARY KEY,
    review_id BIGINT NOT NULL REFERENCES public.legal_contract_reviews(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    file_url TEXT,
    extracted_text TEXT,
    extracted_data JSONB,
    risk_score VARCHAR(16),
    analysis_status TEXT,
    analysis_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_by UUID REFERENCES public.profiles(id)
);
CREATE INDEX IF NOT EXISTS idx_legal_contract_review_versions_review_id ON public.legal_contract_review_versions(review_id);
CREATE INDEX IF NOT EXISTS idx_legal_contract_review_versions_version_number ON public.legal_contract_review_versions(review_id, version_number);
