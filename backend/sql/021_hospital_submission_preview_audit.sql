-- 记录医院上传账号在提交审核前查看原始数据预览的行为。

ALTER TABLE hospital_upload_events
DROP CONSTRAINT IF EXISTS ck_hospital_upload_event_type;

ALTER TABLE hospital_upload_events
ADD CONSTRAINT ck_hospital_upload_event_type CHECK (event_type IN (
    'uploaded',
    'validation_failed',
    'submitted',
    'cancelled',
    'rejected',
    'approved',
    'preview_downloaded',
    'review_preview_viewed',
    'review_preview_downloaded',
    'submission_preview_viewed',
    'imported',
    'import_failed'
));
