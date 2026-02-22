-- Fix: Allow pending → otp_verified transition for in-app lawyer signing
-- where the "viewed" step is implicit (lawyer sees doc in wizard before signing)
CREATE OR REPLACE FUNCTION validate_signature_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT (
    (OLD.status = 'waiting' AND NEW.status IN ('pending', 'expired', 'revoked')) OR
    (OLD.status = 'pending' AND NEW.status IN ('viewed', 'otp_verified', 'expired', 'revoked')) OR
    (OLD.status = 'viewed' AND NEW.status IN ('otp_verified', 'expired', 'revoked')) OR
    (OLD.status = 'otp_verified' AND NEW.status IN ('signed', 'declined', 'expired', 'revoked')) OR
    (OLD.status IN ('signed', 'declined', 'expired', 'revoked') AND NEW.status = OLD.status)
  ) THEN
    RAISE EXCEPTION 'Invalid signature status transition from % to %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;