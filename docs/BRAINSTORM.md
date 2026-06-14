# BRAINSTORM & Design Decisions — Cowork Skill Factory

> Tài liệu này brainstorm **nhiều hướng cho từng mảng** của dự án (kể cả mảng đã có),
> rồi **chọn phương án tối ưu** kèm lý do. Nguyên tắc xuyên suốt: **không hardcode,
> code chạy được trên Ubuntu, phù hợp spec Agent Skills chính thức của Anthropic.**
>
> Nguồn tham chiếu (đã đọc, 2026-06): [Agent Skills Specification](https://agentskills.io/specification),
> [anthropics/skills](https://github.com/anthropics/skills) (đặc biệt `skill-creator`).

---

## 0. Bối cảnh & ràng buộc đã xác minh

| Sự thật | Hệ quả thiết kế |
|---|---|
| Môi trường chạy: **Ubuntu 24.04**, bun 1.3.14, node 24, `claude -p` chạy trực tiếp | Bỏ mọi giả định macOS (`-Users-alice-…`, không có `timeout`…) |
| Profile `ccs:my-api` **không tồn tại** trên máy này | Runner phải **tự fallback** sang `claude`, không hardcode profile |
| Log hiện đọc được là **Claude Code CLI** (`~/.claude/projects`), **không phải** log Cowork app | Nguồn dữ liệu phải **pluggable** (adapter), không nhúng cứng format |
| Log thật của user **chủ yếu tiếng Việt** | Mọi heuristic phụ thuộc cụm tiếng Anh đều hỏng → phải đa ngôn ngữ / LLM-first |
| Một call judge ≈ **$0.23 thật** | Test cấu trúc phải $0 (`--no-judge`); judge chỉ vài episode |
| **SKILL.md spec**: `name` ≤64 `[a-z0-9-]` khớp tên thư mục; `description` ≤1024 (what+when, "pushy"); `compatibility` ≤500 (khai báo môi trường); `scripts/ references/ assets/ evals/evals.json` | Generator phải sinh đúng chuẩn này, không tự chế format |

**Phân định scope session này:**
- ✅ Làm được ngay: refactor portability, redaction, classifier đa ngôn ngữ, clustering ổn định, **skill-gen + Gate 2-A**, test E2E, docs.
- 🔶 Kiến trúc-sẵn nhưng chờ input ngoài: **nguồn Cowork thật** (chờ use-case Vinhomes qua anh Hòa) → làm **adapter** + format giả lập; **Gate 2-B back-test** cần agent chạy task → làm **eval harness scaffold** (`evals.json` + runner), chạy thật khi có dữ liệu nghiệp vụ.
- ⛔ Ngoài tầm code: ký pháp lý/chính sách giám sát (việc của anh Hòa + pháp chế).

---

## 1. Mảng CAPTURE / Nguồn dữ liệu

**Vấn đề:** tên dự án là "Cowork" nhưng đang đọc log Claude Code CLI. Format/vị trí log Cowork (Windows/Desktop app) khác và **chưa có**.

| Hướng | Ưu | Nhược |
|---|---|---|
| A. Tiếp tục bám cứng format Claude Code | Đang chạy | "Sai nguồn", viết lại khi có Cowork |
| B. **Source adapter** — interface `SessionSource` trả về `RawEvent[]` chuẩn hóa; có adapter `claude-code` + adapter `cowork` (cắm sau) | Đổi nguồn = viết 1 adapter, lõi không đổi | Thêm 1 lớp trừu tượng |
| C. Chờ có log Cowork mới làm | Đúng nguồn ngay | Chặn toàn bộ tiến độ |

**→ Chọn B.** Định nghĩa `RawEvent` đã là format trung gian rồi (`types.ts`); chỉ cần tách `discover.ts` thành adapter + chuẩn hóa, và viết `docs/adapters.md` mô tả cách thêm adapter Cowork. Giải quyết "sai nguồn" **về mặt kiến trúc** mà không cần viết lại — đúng như báo cáo nói "sửa nửa ngày, không phải viết lại".

---

## 2. Mảng SEGMENTATION / Lọc nhiễu (mảng đã có — cần sửa)

**Vấn đề:** classifier dùng phrase-list tiếng Anh + tokenizer `[a-z]` → chết trên tiếng Việt (đã chứng minh: "Không…" không khớp `correction`, dấu tiếng Việt bị cắt vụn).

| Hướng | Ưu | Nhược |
|---|---|---|
| A. Dịch phrase-list sang đa ngôn ngữ + tokenizer Unicode `\p{L}` | Rẻ, vẫn $0, deterministic | "Đuổi theo từng ngôn ngữ" — đúng cái user ghét; vẫn brittle |
| B. **LLM-first segmentation**: đưa cả phiên cho LLM cắt episode + gán vai trò 1 lần/phiên | Đúng bản chất (hiểu nghĩa), đa ngôn ngữ tự nhiên | Tốn LLM 1 call/phiên (rẻ hơn judge nhiều) |
| C. **Hybrid 2 lớp**: heuristic *độc-lập-ngôn-ngữ* (interruption marker, paste theo cấu trúc, ack rất ngắn) cho ca dễ; **LLM cho mọi ranh giới new_task/correction/continuation** | Rẻ + đúng; heuristic chỉ giữ phần không cần hiểu nghĩa | Phức tạp vừa |

**→ Chọn C**, và để **A làm fallback $0** khi tắt LLM. Lý do: paste/interruption nhận diện bằng **cấu trúc** (regex log, marker) vốn độc lập ngôn ngữ — giữ lại. Còn phân biệt new_task/correction/continuation **cần hiểu nghĩa** → giao LLM (đã có `--classify-llm`, ta **bật mặc định** + mở rộng phạm vi). Tokenizer vẫn nâng lên Unicode để fallback A không vô dụng. Sửa luôn lỗi "tiếp tục = approval".

---

## 3. Mảng JUDGE / Trust gate (mảng đã có — giữ, gia cố nhẹ)

Đã tốt: rubric neo hành vi người dùng, cache đa thành phần, calibration phân tầng. Brainstorm cải thiện:

| Hướng | Quyết |
|---|---|
| Thêm bộ chấm độc lập (không phải Claude) để phá "Claude chấm Claude" | 🔶 Deferred — cần API provider khác; ghi vào calibration roadmap |
| Persist render để self-consistency không bị lossy | ✅ Rẻ, làm: lưu `rendered` vào DB (đã có content_hash) |
| Bias-anchor mạnh hơn cho `abandoned` vs `failed` | ✅ Tinh chỉnh prompt |

**→** Giữ nguyên lõi, chỉ **persist render** (giúp Gate 2 + calibrate) và tinh chỉnh prompt. Không đập đi xây lại — nó là phần mạnh nhất.

---

## 4. Mảng SKILL-GEN (mới — trọng tâm session này)

**Mục tiêu:** từ cluster đáng codify → sinh **skill folder hợp spec Anthropic**.

| Hướng draft | Ưu | Nhược |
|---|---|---|
| A. Template cứng điền chỗ trống | Deterministic | Hardcode, rỗng, không bắt được sắc thái |
| B. **LLM draft có grounding ở tầng pattern** (theo guidance `skill-creator`) | Đúng tinh thần Anthropic (imperative, giải thích why, tránh overfit) | Cần chống bịa |
| C. LLM tự do | Linh hoạt | Bịa, overfit ví dụ |

**→ Chọn B.** Generator:
1. **Assemble evidence** từ DB (đã redact): `dominant_pattern`, contrast success/fail, `recurring_friction`, `good_practices` gộp, `root_cause` gộp, `risk_flags`, exemplar ids (để cite).
2. **Draft bằng LLM** theo rubric phản chiếu `skill-creator`: description "pushy" (what+when+keywords), body imperative + **giải thích why** (cấm all-caps MUST — Anthropic gọi là cờ vàng), **tổng quát hóa** không chép literal (path/số/repo), khai báo `compatibility` đúng môi trường đích.
3. **Hybrid artifact**: phần cơ học lặp lại → `scripts/`; phần phán đoán → body. (Anthropic: "nếu nhiều lần viết cùng script thì bundle nó".)
4. **Sinh `evals/evals.json`**: 2-3 test prompt thật từ exemplar → handoff cho Gate 2-B.

Output = **thư mục skill đúng chuẩn**: `out/skills/<name>/{SKILL.md, scripts/, references/, evals/evals.json, meta.json}`.

---

## 5. Mảng GATE 2 / Nghiệm thu skill (mới — tầng tĩnh làm ngay, back-test scaffold)

Đã chốt với user: **tiered, sinh cả 3 dạng**. 3 dạng artifact → 3 cơ chế Gate 2-B khác nhau (script=unit-test, skill=back-test outcome, sop=human-adopt).

**Tier A (tĩnh, $0, dùng chung — LÀM NGAY):**
1. **Frontmatter hợp lệ** theo spec (name regex+≤64+khớp dir, desc 1-1024, compatibility ≤500). Reuse được `skills-ref validate` về sau.
2. **Grounding**: mọi citation phải truy về exemplar/friction có thật trong cluster.
3. **Anti-hardcode/leakage**: quét body tìm path tuyệt đối, secret (qua redact patterns), số/token quá cụ thể → cảnh báo. *(Chính là giá trị "không hardcode" của user, áp cho cả output.)*
4. **Non-triviality**: `dominant_pattern` <2 bước hoặc body quá ngắn → reject (skill rỗng vô giá trị).
5. **Safety**: cấm malware/exploit (theo spec Anthropic); thao tác nguy hiểm phải nằm trong guardrail.

**Tier B (đắt, theo dữ liệu thật — SCAFFOLD):** `evals/evals.json` + một runner `bun run src/skilleval.ts` chạy *with-skill vs no-skill baseline*, chấm bằng assertion khách quan. Chạy thật khi có dữ liệu nghiệp vụ Vinhomes.

**→** Tier A chặn rác trước khi tốn tiền; chỉ skill qua Tier A mới đáng đem back-test. Giống y triết lý Gate 1 nhiều tầng.

---

## 6. Mảng MULTI-MACHINE / Hội tụ dữ liệu nhiều người (deferred — chốt hướng)

**Vấn đề:** nhiều nhân viên cùng làm 1 quy trình trên nhiều máy → gộp thế nào?

| Hướng | Ghi chú |
|---|---|
| A. Gộp thô tất cả episode vào 1 DB | Mất ngữ cảnh người/máy; lẫn lộn |
| B. **Mỗi máy 1 DB → merge theo cluster, giữ `source_machine`/`actor_id`** | Cluster xuyên-người tăng N (phá small-N!), vẫn truy nguồn được |
| C. Cross-session `task_key` (đã chừa nullable trong schema) | Liên kết task xuyên phiên/người |

**→ Chọn B+C** (deferred): thêm cột `actor_id`/`source` (schema đã mở sẵn `task_key`), merge ở tầng mine. **Đây là lời giải cho small-N**: gộp nhiều người làm cùng quy trình → cluster đủ dày để tin. Cần khi có >1 nguồn thật.

---

## 7. Mảng DASHBOARD / Báo cáo lãnh đạo (một phần làm được rẻ)

4 dashboard kỳ vọng: skills+tốc độ cá nhân, utilization, năng suất, tuân thủ. Brainstorm cái **rẻ & trong tầm dữ liệu sẵn có**:

| Dashboard | Khả thi từ dữ liệu hiện có? |
|---|---|
| Năng suất (phút/việc, lặp/phát sinh) | 🔶 Một phần — đã có `duration_s`; thêm `actor_id` + phân loại lặp |
| Skills & tốc độ cá nhân | 🔶 Cần `actor_id` (rẻ — thêm trường định danh) |
| Utilization (giờ/ngày dùng AI) | ⛔ Cần nguồn telemetry máy — ngoài hệ này |
| Tuân thủ quy trình | ⛔ Phụ thuộc: cần có quy trình chuẩn trước (chính là skill ta sinh ra) |

**→** Session này: **không xây dashboard UI** (long lanh nhưng không phải lõi). Thay vào: đảm bảo dữ liệu nền **có sẵn trường** (`actor_id`, phân loại lặp) để dashboard cắm sau. Report markdown hiện có là bản nháp đủ dùng để demo.

---

## 8. Mảng PRIVACY / Redaction (làm ngay — Rủi ro #1 trong báo cáo)

**Vấn đề:** secret/API/pass/path cá nhân lọt vào output ("bản bàn giao sạch" hóa ra bẩn).

| Hướng | Quyết |
|---|---|
| Redact ở cuối (trước khi ghi report) | ❌ Muộn — dữ liệu đã vào DB/LLM |
| **Redact ngay khi ingest**, trước khi vào DB và trước mọi LLM call | ✅ Đúng thiết kế: "chạy đầu tiên, ngay trên máy" |

**→ Chọn redact-first.** `src/redact.ts` (regex secret/PII/path, mở rộng từ `SECRET_PATTERNS` có sẵn trong mine.ts) áp tại 2 chốt: (1) khi render/đưa text cho LLM; (2) khi ghi artifact/report. Ghi log số lượng đã che (minh bạch, không im lặng).

---

## 9. Mảng PORTABILITY / Runner (làm ngay — chặn cả việc chạy)

**→** `discover.ts`: thay exclude hardcode `-Users-alice-Documents` bằng **heuristic chung** (bucket không có project segment / có cấu hình `EXCLUDE_BUCKETS`). `runner.ts`: nếu `ccs env <profile>` fail → **tự fallback `claude`** + cảnh báo, thay vì ném lỗi chặn cả pipeline. Bỏ giả định macOS trong docs.

---

## 10. Thứ tự thực thi session này (ưu tiên theo phụ thuộc)

1. **Portability + runner** (không có cái này thì không chạy được gì) ← chặn
2. **Redaction** (Rủi ro #1, mọi thứ sau phụ thuộc) ← chặn an toàn
3. **Classifier đa ngôn ngữ** (chất lượng nhãn — nuôi mọi tầng sau)
4. **Clustering ổn định** (hết dao động "0 skill")
5. **Skill-gen + Gate 2-A** (trọng tâm — "ra skill thật")
6. **Test E2E thật** trên log Ubuntu (cấu trúc $0 + 2-3 judge + sinh ≥1 skill hợp spec)
7. **Docs** (README/plan/DATA_FORMAT phản ánh hiện trạng)

Mỗi mục: code chạy được, không hardcode, test trước khi tick xong.
