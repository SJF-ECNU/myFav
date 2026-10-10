# Why
Real probes identify collects/list HTTP403 while member pagination succeeds. Sync redundantly checks folders before collectDouyin repeats the same bound-owner check.

# What Changes
Eliminate only redundant pre-sync folder verification; preserve collectDouyin owner/name/member/count validation and all detail preparation checks. Separate folder and member diagnostic stages.

# Impact
Douyin sync and diagnostics. No retry, captcha bypass or pause-policy weakening. This reduces unnecessary requests without asserting a proven platform rate-limit threshold.
