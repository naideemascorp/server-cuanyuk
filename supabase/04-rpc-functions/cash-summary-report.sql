CREATE OR REPLACE FUNCTION cash_summary(
  p_org_id UUID,
  p_group TEXT DEFAULT 'day',
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to TIMESTAMPTZ DEFAULT NULL,
  p_merchant_id UUID DEFAULT NULL,
  p_partner_id UUID DEFAULT NULL
)
RETURNS TABLE (
  bucket TIMESTAMPTZ,
  net_profit BIGINT,
  gross_profit BIGINT,
  cash_in BIGINT,
  cash_out BIGINT,
  pending_funds BIGINT
) AS $$
DECLARE
  bucket_expr TEXT;
BEGIN
  CASE p_group
    WHEN 'all'      THEN bucket_expr := '''1970-01-01''::timestamptz';
    WHEN 'datetime' THEN bucket_expr := 'date_trunc(''hour'', ct.transaction_date)';
    WHEN 'day'      THEN bucket_expr := 'date_trunc(''day'', ct.transaction_date)';
    WHEN 'week'     THEN bucket_expr := 'date_trunc(''week'', ct.transaction_date)';
    WHEN 'month'    THEN bucket_expr := 'date_trunc(''month'', ct.transaction_date)';
    WHEN 'year'     THEN bucket_expr := 'date_trunc(''year'', ct.transaction_date)';
    ELSE                  bucket_expr := 'date_trunc(''day'', ct.transaction_date)';
  END CASE;

  RETURN QUERY EXECUTE format(
    'SELECT
      %s AS bucket,
      SUM((ct.total_amount::bigint * (ct.customer_fee_bps - ct.merchant_fee_bps)::bigint) / 10000) AS net_profit,
      SUM((ct.total_amount::bigint * ct.customer_fee_bps::bigint) / 10000) AS gross_profit,
      SUM(CASE WHEN ct.cash_type = ''CASH_IN'' THEN ct.total_amount ELSE 0 END) AS cash_in,
      SUM(CASE WHEN ct.cash_type = ''CASH_OUT'' THEN ct.total_amount ELSE 0 END) AS cash_out,
      SUM(CASE WHEN ct.status = ''PENDING'' THEN ct.total_amount ELSE 0 END) AS pending_funds
    FROM cash_transactions ct
    WHERE ct.organization_id = $1
      AND ct.status IN (''ACTIVE'', ''PENDING'')
      AND ($2::timestamptz IS NULL OR ct.transaction_date >= $2)
      AND ($3::timestamptz IS NULL OR ct.transaction_date <= $3)
      AND ($4::uuid IS NULL OR ct.merchant_id = $4)
      AND ($5::uuid IS NULL OR ct.partner_id = $5)
    GROUP BY bucket
    ORDER BY bucket DESC
    LIMIT 400',
    bucket_expr
  ) USING p_org_id, p_from, p_to, p_merchant_id, p_partner_id;
END;
$$ LANGUAGE plpgsql STABLE;
