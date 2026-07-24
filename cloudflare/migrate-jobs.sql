-- 给已有 D1 补列（可重复执行会报错则忽略）
ALTER TABLE jobs ADD COLUMN mime TEXT;
ALTER TABLE jobs ADD COLUMN file_b64 TEXT;
