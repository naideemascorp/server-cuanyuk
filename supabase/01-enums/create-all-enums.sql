DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'record_status') THEN
    CREATE TYPE record_status AS ENUM ('ACTIVE', 'INACTIVE', 'PENDING', 'DELETED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_kind') THEN
    CREATE TYPE payment_kind AS ENUM ('LINK', 'QRIS');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cash_type') THEN
    CREATE TYPE cash_type AS ENUM ('CASH_IN', 'CASH_OUT');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('USER', 'SUPER');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_importance') THEN
    CREATE TYPE notification_importance AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_template_key') THEN
    CREATE TYPE notification_template_key AS ENUM ('WELCOME');
  END IF;
END $$;
