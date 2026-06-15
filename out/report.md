# Cowork Workflow Miner — Report

_Generated: 2026-06-15T03:01:30.334Z_

## Corpus

- Sessions: **72**
- Episodes: **112**
- Judged episodes (success/partial/failed/abandoned): **13**
- Overall success rate: **62%** (of judged)
- Task clusters: **16**

> **Confidence caveat.** This report is _exemplar-driven, not statistical_.
> The corpus is small (N≈112 episodes), clusters are often thin, and
> outcomes are self-graded by an LLM judge — a bias bounded by a user-behaviour-anchored
> rubric and stratified calibration, but not eliminated. Treat clusters as leads to
> investigate (with cited exemplar episodes), not as proven win-rates. `qa_only`
> episodes are excluded from success-rate denominators.

## Task clusters (sufficient evidence)

_No cluster yet meets the ≥3 episodes AND ≥3 judged bar._

## Insufficient evidence

_These clusters have <3 episodes or <3 judged outcomes. Components are computed best-effort but should not be over-interpreted._

- **code question** — 3 ep / 2 sess, success 0%, friction 0, rec: none
- **feature** — 2 ep / 2 sess, success 50%, friction 1.5, rec: none
  - good exemplar: `9667a265-c3fb-43b6-80db-8a79027267d9#3` : Commit và push trước. Thực hiện đầy đủ 3 và 4. (telemetry là gì?) (sub-agent tiering theo bước+claude code hook chốt chấ _(outcome: success, friction: 0)_
  - bad exemplar: `ff5fa6fe-0a8a-479e-8b59-f86dee097344#1` : Model chỉ được dùng là gemma-4-31b-it cho mọi thứ. Bỏ resolution framework có phù hợp không, hay là bỏ những cái quá cụ  _(outcome: partial, friction: 3)_
- **browser automation information retrieval** — 1 ep / 1 sess, success 100%, friction 0, rec: none
  - good exemplar: `43255f21-d342-4b0e-b8c1-2f4fd77d364c#0` : Vào mail (trình duyệt brave) tóm tắt 10 email mới nhất chi tiết _(outcome: success, friction: 0)_
- **prompt engineering investigation** — 1 ep / 1 sess, success 100%, friction 1, rec: none
  - good exemplar: `ff5fa6fe-0a8a-479e-8b59-f86dee097344#4` : Đưa tôi alpha mà AL đã gen cho tôi thấy _(outcome: success, friction: 1)_
- **feature implementation design qa** — 1 ep / 1 sess, success 100%, friction 0, rec: none
  - good exemplar: `ff5fa6fe-0a8a-479e-8b59-f86dee097344#6` : Có, nên index tự động. _(outcome: success, friction: 0)_
- **document editing feasibility analysis** — 1 ep / 1 sess, success 100%, friction 0, rec: none
  - good exemplar: `9667a265-c3fb-43b6-80db-8a79027267d9#0` : Kiểm tra ClaudeCowork và feasibility_report,...nghiên cứu _(outcome: success, friction: 0)_
- **research integration** — 1 ep / 1 sess, success 100%, friction 0, rec: none
  - good exemplar: `9667a265-c3fb-43b6-80db-8a79027267d9#1` : Hiện tại đã chuyển sang máy host là Window. Nghiên cứu lưu trữ window về claude cowork và claude desktop, cli. Chú ý cow _(outcome: success, friction: 0)_
- **endtoend pipeline run feature verification** — 1 ep / 1 sess, success 100%, friction 0, rec: none
  - good exemplar: `9667a265-c3fb-43b6-80db-8a79027267d9#2` : Mở metabase ở đâu _(outcome: success, friction: 0)_
- **data cleaning report generation** — 1 ep / 1 sess, success 100%, friction 0, rec: none
  - good exemplar: `942a5465-8cfd-4cf4-9c09-ae7b6ff8179b#0` : Mình có file competitor_prices.csv trong thư mục Downloads — bảng giá đối thủ bất động sản do đồng nghiệp gửi, dữ liệu k _(outcome: success, friction: 0)_
- **web research** — 1 ep / 1 sess, success 0%, friction 0, rec: none
  - bad exemplar: `4bff37d8-9834-41c7-9db0-304a90294c99#0` : mở web và nghiên cứu thị trường vinhomes trong tháng này chi tiết _(outcome: abandoned, friction: 0)_
- **market research information request** — 1 ep / 1 sess, success 0%, friction 0, rec: none
- **competitive research browser automation** — 1 ep / 1 sess, success 0%, friction 0, rec: none
  - bad exemplar: `65a3d9d3-16c0-4cc2-8660-69f0bc8ebbfe#0` : "Vào website của Masterise Homes, Ecopark và Capitaland, chụp màn hình trang bảng giá hiện tại của từng dự án tại Hà Nội _(outcome: partial, friction: 0)_
- **diagnostic investigation** — 1 ep / 1 sess, success 0%, friction 1, rec: none
  - bad exemplar: `ff5fa6fe-0a8a-479e-8b59-f86dee097344#0` : Kiểm tra hệ thống, các nội dung prompt yaml,... tại sao các alpha sinh ra khá rập khuôn, quy trình agentic khá kém hiệu  _(outcome: qa_only, friction: 1)_
- **prompt analysis testharness debugging** — 1 ep / 1 sess, success 0%, friction 1, rec: none
  - bad exemplar: `ff5fa6fe-0a8a-479e-8b59-f86dee097344#3` : validate_syntax_local không cần thiết, lỗi syntax gần đây rất ít xảy ra do gemma-4 tuân thủ luật. diagnose_simulation_re _(outcome: partial, friction: 1)_
- **documentation update feature config** — 1 ep / 1 sess, success 0%, friction 4, rec: none
  - bad exemplar: `9667a265-c3fb-43b6-80db-8a79027267d9#4` : Cập nhật toàn bộ docs, md, ... cho dễ hiểu, tường minh, ngắn gọn, đầy đủ, chính xác nhất có thể cho người đọc. Bỏ file b _(outcome: partial, friction: 4)_
- **greeting** — 1 ep / 1 sess, success 0%, friction 0, rec: none
