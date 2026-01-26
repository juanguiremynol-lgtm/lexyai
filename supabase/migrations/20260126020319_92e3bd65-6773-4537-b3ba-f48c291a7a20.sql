-- Enable pgcrypto extension for gen_random_bytes() used in voucher token generation
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;