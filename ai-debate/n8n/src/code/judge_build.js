// Trọng tài Gemini đánh giá "mù" (không biết bên nào là GPT/Claude) bằng tiêu chí định lượng.
const state = $input.first().json.state;
const R = state.rounds;
const criteriaList = state.input.criteria.map((c, i) => `${i + 1}. "${c.name}" — trọng số ${c.weight}${c.description ? ` — ${c.description}` : ''}`).join('\n');
const system = [
  'Bạn là TRỌNG TÀI ĐỘC LẬP, công tâm, chuyên đánh giá các phương án giải quyết vấn đề.',
  'Bạn KHÔNG biết danh tính hai bên tranh luận; chỉ đánh giá nội dung.',
  'Nguyên tắc: dựa trên chất lượng lập luận, bằng chứng, tính khả thi, mức độ đáp ứng mục tiêu và ràng buộc; không thiên vị theo độ dài hay văn phong;',
  'chấm điểm PHƯƠNG ÁN CUỐI CÙNG (Vòng 3) của mỗi bên, có xét cách mỗi bên xử lý phản biện ở Vòng 2.',
  'Bạn có thể chọn A, chọn B, hoặc COMBINE (kết hợp) — nếu kết hợp, nói rõ lấy phần nào từ mỗi bên.',
  'Phải nêu trung thực các bất đồng CHƯA được giải quyết và cách phân xử chúng (cần dữ liệu/thử nghiệm gì).',
  'Chỉ trả về MỘT JSON object hợp lệ, không thêm bất kỳ chữ nào ngoài JSON, không dùng ``` . Mọi giá trị chuỗi viết bằng tiếng Việt.',
].join('\n');
const prompt = `${problemBlock(state.input)}
---
# HỒ SƠ TRANH LUẬN

## VÒNG 1 — PHÂN TÍCH ĐỘC LẬP
### Phương án A (Vòng 1)
${clip(R['1'].A, 16000)}

### Phương án B (Vòng 1)
${clip(R['1'].B, 16000)}

## VÒNG 2 — PHẢN BIỆN CHÉO
### Bên A phản biện Bên B
${clip(R['2'].A, 14000)}

### Bên B phản biện Bên A
${clip(R['2'].B, 14000)}

## VÒNG 3 — PHƯƠNG ÁN CUỐI CÙNG
### Phương án cuối cùng của A
${clip(R['3'].A)}

### Phương án cuối cùng của B
${clip(R['3'].B)}

---
# YÊU CẦU CHẤM ĐIỂM
Chấm mỗi bên theo TỪNG tiêu chí dưới đây, thang 0–10 (cho phép số lẻ .5), dùng ĐÚNG tên tiêu chí:
${criteriaList}

Lưu ý: KHÔNG tự tính điểm tổng — hệ thống sẽ tự tính điểm có trọng số.
Bảng so sánh "comparison" cần 5–8 khía cạnh. "actionPlan" cần 4–10 bước cụ thể cho giải pháp cuối cùng. "risks" cần 3–8 rủi ro.

Trả về JSON đúng schema sau:
${JUDGE_SCHEMA_HINT}`;
return [{ json: { state, ...llmRequest(state, { round: 4, role: 'judge', stage: 'judge', system, prompt }) } }];
