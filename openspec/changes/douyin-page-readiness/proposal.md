# Why
Same-session probe: DOM-visible early service folder fetch returns403, native favorites and folder XHR return200, late identical service fetch returns200. Cookie and signature fields exist in the failed request. DOM visibility is insufficient readiness.

# What Changes
Wait for successful native own-favorites response before returning openDouyin. No fixed sleep, request replay, fabricated signature, bypass or denial retry. Preserve all existing pause and ownership checks.

# Impact
Douyin browser readiness and targeted tests. Missing native response fails closed without falsely attributing a platform HTTP refusal.
