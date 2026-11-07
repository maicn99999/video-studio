// Vòng 1: mỗi AI phân tích ĐỘC LẬP (không thấy kết quả của nhau). Tạo 2 item -> node HTTP gọi song song.
const s = $('Bắt đầu phiên').first().json;
if (s.cancelled) throw new Error('Phiên đã bị hủy trước khi bắt đầu');
const state = { sessionId: s.id, title: s.title, input: s.input, participants: s.participants, rounds: {}, calls: [] };

const task = `---
## NHIỆM VỤ — VÒNG 1: PHÂN TÍCH ĐỘC LẬP
Hãy tự phân tích vấn đề trên và đề xuất phương án tốt nhất của bạn. Trình bày theo đúng cấu trúc:
## 1. Tóm tắt phương án (3–5 câu)
## 2. Phân tích vấn đề & nguyên nhân gốc
## 3. Giải pháp đề xuất (các bước cụ thể, theo thứ tự ưu tiên)
## 4. Lập luận & bằng chứng
## 5. Giả định chính
## 6. Rủi ro & cách giảm thiểu
## 7. Chi phí / nguồn lực ước tính
## 8. Chỉ số đo lường thành công (KPI)`;

return ['A', 'B'].map((side) => ({
  json: {
    state,
    ...llmRequest(state, {
      round: 1, role: side, stage: 'analysis',
      system: debaterSystem(side, state.participants[side].label),
      prompt: `${problemBlock(state.input)}\n${task}`,
    }),
  },
}));
