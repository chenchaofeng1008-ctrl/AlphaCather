INSERT INTO public_performance_points (
  account_key,
  point_date,
  return_rate,
  benchmark_nasdaq,
  benchmark_sp500
) VALUES
  ('us_stock_public', '2026-01-02', 0.0, 0.0, 0.0),
  ('us_stock_public', '2026-01-15', 1.4, 0.8, 0.5),
  ('us_stock_public', '2026-02-01', 2.8, 2.2, 1.4),
  ('us_stock_public', '2026-02-15', 1.9, 1.6, 1.0),
  ('us_stock_public', '2026-03-01', 4.6, 3.1, 2.2),
  ('us_stock_public', '2026-03-15', 6.2, 4.4, 3.5),
  ('us_stock_public', '2026-04-01', 5.8, 3.7, 3.0),
  ('us_stock_public', '2026-04-15', 8.7, 6.4, 4.9),
  ('us_stock_public', '2026-05-01', 9.5, 7.8, 5.7),
  ('us_stock_public', '2026-05-20', 11.3, 9.1, 6.8)
ON CONFLICT(account_key, point_date) DO UPDATE SET
  return_rate = excluded.return_rate,
  benchmark_nasdaq = excluded.benchmark_nasdaq,
  benchmark_sp500 = excluded.benchmark_sp500;

INSERT INTO public_allocations (
  account_key,
  allocation_date,
  allocation_type,
  label,
  percentage
) VALUES
  ('us_stock_public', '2026-05-20', 'asset', '股票', 62),
  ('us_stock_public', '2026-05-20', 'asset', '现金及货币类', 24),
  ('us_stock_public', '2026-05-20', 'asset', '债券/固收', 14)
ON CONFLICT(account_key, allocation_date, allocation_type, label) DO UPDATE SET
  percentage = excluded.percentage;
