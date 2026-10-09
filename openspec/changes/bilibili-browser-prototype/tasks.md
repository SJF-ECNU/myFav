## 1. Implementation
- [x] 1.1 Add isolated persistent browser login and status commands
- [x] 1.2 Add complete favorite folder and resource pagination, private local storage
- [x] 1.3 Document commands and credential boundaries

## 2. Verification
- [x] 2.1 Test pagination, duplicates, count mismatch and failed-write preservation
- [x] 2.2 Launch real CloakBrowser and verify manual login
- [ ] 2.3 Reopen profile and read real favorite pages (private folder if present)

实测：status 重启登录复用通过；sync 因数量不一致失败，随后诊断 HTTP 412。2.3 未完成，不归档变更。

## 3. User scope refinement
- [x] 3.1 Select an exact named folder, default myFav; missing/duplicate fails
- [x] 3.2 Use member-ID pages and batched details with missing metadata preserved
- [x] 3.3 Run eight tests and real myFav sync: one folder, one member, details available

2.3 的重启与实际读取已通过；所选夹只有1条，真实多页与私有读取子项尚未验证，不把模拟证据当作实测。全量读取已被用户收窄范围替代。
